import crypto from 'crypto';
import { promisify } from 'util';
import { z } from 'zod';
import { config } from '../config';
import { query } from '../db/pool';
import { sendAccountEmail } from './mailer';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'member';
  email_verified: boolean;
  created_at: string;
  last_login_at: string | null;
  password_changed_at: string | null;
}

const USER_COLS = `u.id, u.name, u.email, u.role, (u.email_verified_at IS NOT NULL) AS email_verified,
  u.created_at, u.last_login_at, u.password_changed_at`;

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

const email = z.string().trim().toLowerCase().email().max(255);
const newPassword = z.string().min(8).max(200);

export const registerSchema = z.object({ name: z.string().trim().min(2).max(120), email, password: newPassword });
export const loginSchema = z.object({ email, password: z.string().min(1).max(200) });
export const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email,
  // required only when the e-mail address changes
  current_password: z.string().max(200).optional(),
});
export const changePasswordSchema = z.object({ current_password: z.string().min(1).max(200), new_password: newPassword });
export const forgotSchema = z.object({ email });
export const resetSchema = z.object({ token: z.string().min(10).max(200), password: newPassword });
export const tokenSchema = z.object({ token: z.string().min(10).max(200) });

// ---------- passwords (scrypt, no extra dependency) ----------

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// A throwaway hash so unknown e-mails take as long as wrong passwords (no user enumeration by timing)
let dummyHash: Promise<string> | null = null;

async function checkPassword(userId: number, password: string) {
  const [row] = await query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
  if (!row || !(await verifyPassword(password, row.password_hash))) throw httpError(400, 'رمز عبور فعلی اشتباه است');
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');

// ---------- sessions (opaque token in an HttpOnly cookie; only its SHA-256 is stored) ----------

export interface SessionInfo {
  id: number;
  user_agent: string;
  ip: string;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  current: boolean;
}

async function createSession(userId: number, userAgent: string, ip: string) {
  const token = randomToken();
  await query(
    `INSERT INTO auth_sessions (user_id, token_hash, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + make_interval(days => $5))`,
    [userId, sha256(token), userAgent.slice(0, 255), ip.slice(0, 64), config.auth.sessionDays],
  );
  return token;
}

// last_used_at is refreshed at most this often, so most requests only read
const TOUCH_AFTER_MS = 5 * 60 * 1000;

/** Resolves a session token to its user (null when unknown or expired) */
export async function sessionFromToken(token: string): Promise<{ user: User; sessionId: number } | null> {
  const rows = await query<User & { session_id: number; last_used_at: string }>(
    `SELECT ${USER_COLS}, s.id AS session_id, s.last_used_at
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
    [sha256(token)],
  );
  const row = rows[0];
  if (!row) return null;
  if (Date.now() - new Date(row.last_used_at).getTime() > TOUCH_AFTER_MS) {
    query(`UPDATE auth_sessions SET last_used_at = NOW() WHERE id = $1`, [row.session_id]).catch(() => undefined);
  }
  const { session_id, last_used_at: _lu, ...user } = row;
  return { user, sessionId: session_id };
}

export async function revokeSession(token: string) {
  await query(`DELETE FROM auth_sessions WHERE token_hash = $1`, [sha256(token)]);
}

export async function listSessions(userId: number, currentId: number): Promise<SessionInfo[]> {
  return query<SessionInfo>(
    `SELECT id, user_agent, ip, created_at, last_used_at, expires_at, (id = $2) AS current
       FROM auth_sessions WHERE user_id = $1 AND expires_at > NOW()
      ORDER BY (id = $2) DESC, last_used_at DESC`,
    [userId, currentId],
  );
}

export async function revokeSessionById(userId: number, id: number) {
  const rows = await query(`DELETE FROM auth_sessions WHERE id = $1 AND user_id = $2 RETURNING id`, [id, userId]);
  if (!rows.length) throw httpError(404, 'نشست یافت نشد');
}

export async function revokeOtherSessions(userId: number, currentId: number) {
  const rows = await query(`DELETE FROM auth_sessions WHERE user_id = $1 AND id <> $2 RETURNING id`, [userId, currentId]);
  return rows.length;
}

// ---------- one-time e-mail links ----------

type TokenKind = 'verify_email' | 'reset_password';
const TOKEN_HOURS: Record<TokenKind, number> = { verify_email: 48, reset_password: 1 };

async function issueToken(userId: number, kind: TokenKind, address: string) {
  // a new link invalidates the previous unused ones of the same kind
  await query(`DELETE FROM auth_tokens WHERE user_id = $1 AND kind = $2 AND used_at IS NULL`, [userId, kind]);
  const token = randomToken();
  await query(
    `INSERT INTO auth_tokens (user_id, kind, token_hash, email, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + make_interval(hours => $5))`,
    [userId, kind, sha256(token), address, TOKEN_HOURS[kind]],
  );
  return token;
}

/** Marks a link as used and returns its owner; throws when it is unknown, used or expired */
async function consumeToken(token: string, kind: TokenKind) {
  const rows = await query<{ user_id: number; email: string }>(
    `UPDATE auth_tokens SET used_at = NOW()
      WHERE token_hash = $1 AND kind = $2 AND used_at IS NULL AND expires_at > NOW()
      RETURNING user_id, email`,
    [sha256(token), kind],
  );
  if (!rows.length) throw httpError(400, 'این لینک نامعتبر است یا منقضی شده است');
  return rows[0];
}

const link = (route: string, token: string) => `${config.appUrl}/#/${route}?token=${encodeURIComponent(token)}`;

export async function sendVerification(user: Pick<User, 'id' | 'name' | 'email'>) {
  const token = await issueToken(user.id, 'verify_email', user.email);
  await sendAccountEmail(
    user.email,
    'تأیید ایمیل — فروشگاه‌یار',
    `${user.name} عزیز، برای فعال شدن حساب خود در فروشگاه‌یار، ایمیل خود را تأیید کنید.`,
    { label: 'تأیید ایمیل', url: link('verify-email', token) },
  );
}

export async function verifyEmail(token: string) {
  const { user_id, email: address } = await consumeToken(token, 'verify_email');
  // the link only counts for the address it was sent to (the user may have changed e-mail since)
  const rows = await query(
    `UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = $1 AND LOWER(email) = LOWER($2) RETURNING id`,
    [user_id, address],
  );
  if (!rows.length) throw httpError(400, 'این لینک برای ایمیل فعلی حساب نیست');
}

// ---------- register / login ----------

export async function authStatus() {
  const [{ n }] = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users`);
  return { has_users: n > 0, registration_open: n === 0 || config.auth.allowRegistration };
}

async function getUser(id: number): Promise<User> {
  const [user] = await query<User>(`SELECT ${USER_COLS} FROM users u WHERE u.id = $1`, [id]);
  return user;
}

const emailTaken = async (address: string, exceptId = 0) =>
  (await query(`SELECT 1 FROM users WHERE LOWER(email) = $1 AND id <> $2`, [address, exceptId])).length > 0;

export async function register(input: z.infer<typeof registerSchema>, userAgent: string, ip: string) {
  const { has_users, registration_open } = await authStatus();
  if (!registration_open) throw httpError(403, 'ثبت‌نام کاربر جدید غیرفعال است؛ با مدیر فروشگاه تماس بگیرید');
  if (await emailTaken(input.email)) throw httpError(409, 'این ایمیل قبلاً ثبت شده است');
  // The very first account manages the store
  const role = has_users ? 'member' : 'admin';
  const [{ id }] = await query<{ id: number }>(
    `INSERT INTO users (name, email, password_hash, role, last_login_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id`,
    [input.name, input.email, await hashPassword(input.password), role],
  );
  const user = await getUser(id);
  await sendVerification(user).catch((e) => console.error('verification e-mail failed:', e.message));
  return { user, token: await createSession(user.id, userAgent, ip) };
}

export async function login(input: z.infer<typeof loginSchema>, userAgent: string, ip: string) {
  const rows = await query<{ id: number; password_hash: string }>(`SELECT id, password_hash FROM users WHERE LOWER(email) = $1`, [input.email]);
  const found = rows[0];
  dummyHash ??= hashPassword(randomToken());
  const ok = await verifyPassword(input.password, found?.password_hash || (await dummyHash));
  if (!found || !ok) throw httpError(401, 'ایمیل یا رمز عبور اشتباه است');
  await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [found.id]);
  return { user: await getUser(found.id), token: await createSession(found.id, userAgent, ip) };
}

// ---------- password reset ----------

/** Always succeeds silently, so the form can't be used to find out which e-mails have accounts */
export async function requestPasswordReset(address: string) {
  const [user] = await query<{ id: number; name: string; email: string }>(`SELECT id, name, email FROM users WHERE LOWER(email) = $1`, [address]);
  if (!user) return;
  const token = await issueToken(user.id, 'reset_password', user.email);
  await sendAccountEmail(
    user.email,
    'بازیابی رمز عبور — فروشگاه‌یار',
    `${user.name} عزیز، درخواست تغییر رمز عبور حساب شما در فروشگاه‌یار ثبت شد.`,
    { label: 'انتخاب رمز جدید', url: link('reset-password', token) },
    'اگر شما این درخواست را نداده‌اید، این ایمیل را نادیده بگیرید.',
  ).catch((e) => console.error('reset e-mail failed:', e.message));
}

export async function resetPassword(token: string, password: string) {
  const { user_id, email: address } = await consumeToken(token, 'reset_password');
  await query(
    `UPDATE users SET password_hash = $2, password_changed_at = NOW(),
       -- the reset link proves the user owns this address
       email_verified_at = CASE WHEN LOWER(email) = LOWER($3) THEN COALESCE(email_verified_at, NOW()) ELSE email_verified_at END
     WHERE id = $1`,
    [user_id, await hashPassword(password), address],
  );
  // sign out everywhere: whoever knew the old password loses access
  await query(`DELETE FROM auth_sessions WHERE user_id = $1`, [user_id]);
  await query(`DELETE FROM auth_tokens WHERE user_id = $1 AND kind = 'reset_password'`, [user_id]);
}

// ---------- profile ----------

export async function updateProfile(userId: number, input: z.infer<typeof profileSchema>) {
  const current = await getUser(userId);
  const emailChanged = input.email !== current.email.toLowerCase();
  if (emailChanged) {
    if (!input.current_password) throw httpError(400, 'برای تغییر ایمیل، رمز عبور فعلی را وارد کنید');
    await checkPassword(userId, input.current_password);
    if (await emailTaken(input.email, userId)) throw httpError(409, 'این ایمیل قبلاً ثبت شده است');
  }
  await query(
    `UPDATE users SET name = $2, email = $3, email_verified_at = CASE WHEN $4 THEN NULL ELSE email_verified_at END WHERE id = $1`,
    [userId, input.name, input.email, emailChanged],
  );
  const user = await getUser(userId);
  if (emailChanged) await sendVerification(user).catch((e) => console.error('verification e-mail failed:', e.message));
  return user;
}

export async function changePassword(userId: number, sessionId: number, input: z.infer<typeof changePasswordSchema>) {
  await checkPassword(userId, input.current_password);
  await query(`UPDATE users SET password_hash = $2, password_changed_at = NOW() WHERE id = $1`, [userId, await hashPassword(input.new_password)]);
  // keep this device signed in, sign out all others
  return { revoked: await revokeOtherSessions(userId, sessionId) };
}

// ---------- housekeeping ----------

/** Deletes never-verified accounts after UNVERIFIED_TTL_DAYS, plus expired sessions and links */
export async function cleanupAuth() {
  const removed = await query<{ email: string }>(
    `DELETE FROM users
      WHERE email_verified_at IS NULL AND role <> 'admin'
        AND created_at < NOW() - make_interval(days => $1)
      RETURNING email`,
    [config.auth.unverifiedTtlDays],
  );
  await query(`DELETE FROM auth_sessions WHERE expires_at < NOW()`);
  await query(`DELETE FROM auth_tokens WHERE expires_at < NOW() - INTERVAL '1 day'`);
  return removed.length;
}

// ---------- brute-force protection (in-memory, per key) ----------

const WINDOW_MS = 15 * 60 * 1000;
const hits = new Map<string, { count: number; first: number }>();

const current = (key: string) => {
  const h = hits.get(key);
  if (h && Date.now() - h.first > WINDOW_MS) {
    hits.delete(key);
    return undefined;
  }
  return h;
};

/** Throws 429 once `key` has been recorded `max` times in the last 15 minutes */
export function assertNotThrottled(key: string, max: number) {
  if ((current(key)?.count || 0) >= max) throw httpError(429, 'تعداد تلاش‌ها زیاد بود؛ چند دقیقه بعد دوباره امتحان کنید');
}

export function recordAttempt(key: string) {
  const h = current(key);
  if (!h) hits.set(key, { count: 1, first: Date.now() });
  else h.count += 1;
}

export const clearAttempts = (key: string) => hits.delete(key);

/** Test helper: forget all recorded attempts */
export const resetThrottling = () => hits.clear();
