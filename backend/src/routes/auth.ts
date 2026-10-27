import { NextFunction, Request, Response, Router } from 'express';
import { config } from '../config';
import {
  assertNotThrottled, authStatus, clearFailures, login, loginSchema, recordFailure, register, registerSchema, revokeSession,
  User, userFromToken,
} from '../services/auth';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const bearer = (req: Request) => {
  const m = /^Bearer\s+(\S+)$/i.exec(req.header('authorization') || '');
  return m ? m[1] : '';
};
const clientIp = (req: Request) => req.ip || req.socket.remoteAddress || 'unknown';
const userAgent = (req: Request) => req.header('user-agent') || '';

/**
 * Guards /api: a logged-in user (Authorization: Bearer <token>) or, for n8n and scripts,
 * the shared API_KEY in the x-api-key header. /health and /auth/* stay public.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.path === '/health' || req.path.startsWith('/auth/')) return next();
  try {
    const token = bearer(req);
    if (token) {
      const user = await userFromToken(token);
      if (user) {
        req.user = user;
        return next();
      }
    }
    if (config.apiKey && req.header('x-api-key') === config.apiKey) return next();
    res.status(401).json({ error: 'برای ادامه وارد حساب کاربری شوید', code: 'unauthenticated' });
  } catch (err) {
    next(err);
  }
}

export const auth = Router();

auth.get('/status', h(async (_req, res) => {
  res.json(await authStatus());
}));

auth.post('/register', h(async (req, res) => {
  const input = registerSchema.parse(req.body);
  res.status(201).json(await register(input, userAgent(req)));
}));

auth.post('/login', h(async (req, res) => {
  const ip = clientIp(req);
  assertNotThrottled(ip);
  const input = loginSchema.parse(req.body);
  try {
    const result = await login(input, userAgent(req));
    clearFailures(ip);
    res.json(result);
  } catch (err: any) {
    if (err.status === 401) recordFailure(ip);
    throw err;
  }
}));

auth.get('/me', h(async (req, res) => {
  const user = bearer(req) ? await userFromToken(bearer(req)) : null;
  if (!user) return res.status(401).json({ error: 'نشست شما منقضی شده است؛ دوباره وارد شوید', code: 'unauthenticated' });
  res.json({ user });
}));

auth.post('/logout', h(async (req, res) => {
  if (bearer(req)) await revokeSession(bearer(req));
  res.status(204).end();
}));
