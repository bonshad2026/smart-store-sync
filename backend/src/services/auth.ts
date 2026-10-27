import crypto from 'crypto';
import { promisify } from 'util';
import { z } from 'zod';
import { config } from '../config';
import { query } from '../db/pool';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'member';
  created_at: string;
  last_login_at: string | null;
}

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(8).max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(1).max(200),
});

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

// A fixed hash so unknown e-mails take as long as wrong passwords (no user enumeration by timing)
let dummyHash: Promise<string> | null = null;

// ---------- sessions (opaque bearer tokens; only their SHA-256 is stored) ----------

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

async function createSession(userId: number, userAgent: string) {
  const token = crypto.randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO auth_sessions (user_id, token_hash, user_agent, expires_at)
     VALUES ($1, $2, $3, NOW() + make_interval(days => $4))`,
    [userId, sha256(token), userAgent.slice(0, 255), config.auth.sessionDays],
  );
  return token;
}

/** Returns the user that owns a valid (not expired) token, and refreshes its last-use time */
export async function userFromToken(token: string): Promise<User | null> {
  const rows = await query<User>(
    `UPDATE auth_sessions s SET last_used_at = NOW()
       FROM users u
      WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.id = s.user_id
      RETURNING u.id, u.name, u.email, u.role, u.created_at, u.last_login_at`,
    [sha256(token)],
  );
  return rows[0] || null;
}

export async function revokeSession(token: string) {
  await query(`DELETE FROM auth_sessions WHERE token_hash = $1`, [sha256(token)]);
}

// ---------- register / login ----------

export async function authStatus() {
  const [{ n }] = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users`);
  return { has_users: n > 0, registration_open: n === 0 || config.auth.allowRegistration };
}

export async function register(input: z.infer<typeof registerSchema>, userAgent: string) {
  const { has_users, registration_open } = await authStatus();
  if (!registration_open) throw httpError(403, 'ثبت‌نام کاربر جدید غیرفعال است؛ با مدیر فروشگاه تماس بگیرید');
  const exists = await query(`SELECT 1 FROM users WHERE LOWER(email) = $1`, [input.email]);
  if (exists.length) throw httpError(409, 'این ایمیل قبلاً ثبت شده است');
  // The very first account manages the store
  const role = has_users ? 'member' : 'admin';
  const [user] = await query<User>(
    `INSERT INTO users (name, email, password_hash, role, last_login_at) VALUES ($1, $2, $3, $4, NOW())
     RETURNING id, name, email, role, created_at, last_login_at`,
    [input.name, input.email, await hashPassword(input.password), role],
  );
  return { user, token: await createSession(user.id, userAgent) };
}

export async function login(input: z.infer<typeof loginSchema>, userAgent: string) {
  const rows = await query<User & { password_hash: string }>(
    `SELECT id, name, email, role, created_at, last_login_at, password_hash FROM users WHERE LOWER(email) = $1`,
    [input.email],
  );
  const found = rows[0];
  dummyHash ??= hashPassword(crypto.randomBytes(16).toString('hex'));
  const ok = await verifyPassword(input.password, found?.password_hash || (await dummyHash));
  if (!found || !ok) throw httpError(401, 'ایمیل یا رمز عبور اشتباه است');
  await query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [found.id]);
  await query(`DELETE FROM auth_sessions WHERE expires_at < NOW()`);
  const { password_hash: _ph, ...user } = found;
  return { user, token: await createSession(user.id, userAgent) };
}

// ---------- brute-force protection (in-memory, per IP) ----------

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
const failures = new Map<string, { count: number; first: number }>();

export function assertNotThrottled(ip: string) {
  const f = failures.get(ip);
  if (f && Date.now() - f.first > WINDOW_MS) failures.delete(ip);
  else if (f && f.count >= MAX_FAILURES) throw httpError(429, 'تلاش‌های ناموفق زیاد بود؛ چند دقیقه بعد دوباره امتحان کنید');
}

export function recordFailure(ip: string) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.first > WINDOW_MS) failures.set(ip, { count: 1, first: Date.now() });
  else f.count += 1;
}

export const clearFailures = (ip: string) => failures.delete(ip);
