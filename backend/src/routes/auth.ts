import { CookieOptions, NextFunction, Request, Response, Router } from 'express';
import { config } from '../config';
import {
  assertNotThrottled, authStatus, changePassword, changePasswordSchema, clearAttempts, forgotSchema, listSessions, login,
  loginSchema, profileSchema, recordAttempt, register, registerSchema, requestPasswordReset, resetPassword, resetSchema,
  revokeOtherSessions, revokeSession, revokeSessionById, sendVerification, sessionFromToken, tokenSchema, updateProfile,
  User, verifyEmail,
} from '../services/auth';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
      sessionId?: number;
    }
  }
}

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

// ---------- session cookie ----------

const COOKIE = 'sss_session';
const cookieOptions = (): CookieOptions => ({
  httpOnly: true, // not readable by JavaScript, so XSS can't steal it
  sameSite: 'lax', // not sent on cross-site POST/PUT/DELETE (CSRF)
  secure: config.appUrl.startsWith('https://'),
  path: '/',
  maxAge: config.auth.sessionDays * 24 * 60 * 60 * 1000,
});

function readCookie(req: Request, name: string) {
  for (const part of (req.header('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

const setSessionCookie = (res: Response, token: string) => res.cookie(COOKIE, token, cookieOptions());
const clearSessionCookie = (res: Response) => res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });

const clientIp = (req: Request) => (req.ip || req.socket.remoteAddress || '').replace(/^::ffff:/, '');
const userAgent = (req: Request) => req.header('user-agent') || '';

// ---------- middleware (mounted on /api in index.ts) ----------

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence in depth (on top of SameSite=Lax): a state-changing request that carries the
 * session cookie must come from the dashboard's own origin.
 */
export function sameOrigin(req: Request, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method) || !readCookie(req, COOKIE)) return next();
  const source = req.header('origin') || req.header('referer');
  if (!source) return next(); // non-browser client
  let host = '';
  try {
    host = new URL(source).host;
  } catch {
    /* invalid header */
  }
  if (host && (host === req.header('host') || host === new URL(config.appUrl).host)) return next();
  res.status(403).json({ error: 'درخواست از مبدأ نامعتبر رد شد' });
}

/** Attaches req.user / req.sessionId when the session cookie is valid; never rejects */
export async function loadSession(req: Request, res: Response, next: NextFunction) {
  const token = readCookie(req, COOKIE);
  if (!token) return next();
  try {
    const s = await sessionFromToken(token);
    if (s) {
      req.user = s.user;
      req.sessionId = s.sessionId;
    } else clearSessionCookie(res);
    next();
  } catch (err) {
    next(err);
  }
}

// Reachable without logging in
const PUBLIC = new Set([
  '/health', '/auth/status', '/auth/register', '/auth/login', '/auth/logout', '/auth/me',
  '/auth/verify-email', '/auth/forgot-password', '/auth/reset-password',
  '/instagram/callback', // Instagram sends the browser back here; the one-time state identifies the user
]);

/**
 * Guards /api: a logged-in user with a verified e-mail, or (for n8n and scripts) the shared
 * API_KEY in the x-api-key header. Unverified users can only use their own /auth/* endpoints.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (PUBLIC.has(req.path)) return next();
  if (!req.user) {
    if (config.apiKey && req.header('x-api-key') === config.apiKey) return next();
    return res.status(401).json({ error: 'برای ادامه وارد حساب کاربری شوید', code: 'unauthenticated' });
  }
  if (!req.user.email_verified && !req.path.startsWith('/auth/')) {
    return res.status(403).json({ error: 'ابتدا ایمیل خود را تأیید کنید', code: 'unverified' });
  }
  next();
}

const me = (req: Request) => {
  if (!req.user || !req.sessionId) throw Object.assign(new Error('برای ادامه وارد حساب کاربری شوید'), { status: 401 });
  return { user: req.user, sessionId: req.sessionId };
};

// ---------- routes (/api/auth) ----------

export const auth = Router();

auth.get('/status', h(async (_req, res) => {
  res.json(await authStatus());
}));

auth.post('/register', h(async (req, res) => {
  const ip = clientIp(req);
  assertNotThrottled(`register:${ip}`, 10);
  recordAttempt(`register:${ip}`);
  const { user, token } = await register(registerSchema.parse(req.body), userAgent(req), ip);
  setSessionCookie(res, token);
  res.status(201).json({ user });
}));

auth.post('/login', h(async (req, res) => {
  const key = `login:${clientIp(req)}`;
  assertNotThrottled(key, 10);
  try {
    const { user, token } = await login(loginSchema.parse(req.body), userAgent(req), clientIp(req));
    clearAttempts(key);
    setSessionCookie(res, token);
    res.json({ user });
  } catch (err: any) {
    if (err.status === 401) recordAttempt(key);
    throw err;
  }
}));

auth.get('/me', h(async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'نشست شما منقضی شده است؛ دوباره وارد شوید', code: 'unauthenticated' });
  res.json({ user: req.user });
}));

auth.post('/logout', h(async (req, res) => {
  const token = readCookie(req, COOKIE);
  if (token) await revokeSession(token);
  clearSessionCookie(res);
  res.status(204).end();
}));

// ---- e-mail verification ----

auth.post('/verify-email', h(async (req, res) => {
  await verifyEmail(tokenSchema.parse(req.body).token);
  res.json({ ok: true });
}));

auth.post('/resend-verification', h(async (req, res) => {
  const { user } = me(req);
  if (user.email_verified) return res.json({ ok: true, already: true });
  assertNotThrottled(`verify:${user.id}`, 3);
  recordAttempt(`verify:${user.id}`);
  await sendVerification(user);
  res.json({ ok: true });
}));

// ---- forgot / reset password ----

auth.post('/forgot-password', h(async (req, res) => {
  const { email } = forgotSchema.parse(req.body);
  for (const key of [`forgot:${clientIp(req)}`, `forgot:${email}`]) assertNotThrottled(key, key.includes('@') ? 3 : 10);
  recordAttempt(`forgot:${clientIp(req)}`);
  recordAttempt(`forgot:${email}`);
  await requestPasswordReset(email);
  res.json({ ok: true });
}));

auth.post('/reset-password', h(async (req, res) => {
  const { token, password } = resetSchema.parse(req.body);
  await resetPassword(token, password);
  clearSessionCookie(res);
  res.json({ ok: true });
}));

// ---- profile & password ----

auth.put('/profile', h(async (req, res) => {
  const { user } = me(req);
  res.json({ user: await updateProfile(user.id, profileSchema.parse(req.body)) });
}));

auth.post('/change-password', h(async (req, res) => {
  const { user, sessionId } = me(req);
  const key = `password:${user.id}`;
  assertNotThrottled(key, 10);
  try {
    res.json(await changePassword(user.id, sessionId, changePasswordSchema.parse(req.body)));
  } catch (err: any) {
    if (err.status === 400) recordAttempt(key);
    throw err;
  }
}));

// ---- active sessions (devices) ----

auth.get('/sessions', h(async (req, res) => {
  const { user, sessionId } = me(req);
  res.json(await listSessions(user.id, sessionId));
}));

auth.post('/sessions/revoke-others', h(async (req, res) => {
  const { user, sessionId } = me(req);
  res.json({ revoked: await revokeOtherSessions(user.id, sessionId) });
}));

auth.delete('/sessions/:id', h(async (req, res) => {
  const { user, sessionId } = me(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('شناسه نامعتبر است'), { status: 400 });
  await revokeSessionById(user.id, id);
  if (id === sessionId) clearSessionCookie(res);
  res.status(204).end();
}));
