import crypto from 'crypto';
import request from 'supertest';
import { createApp } from '../../src/app';
import { pool, query } from '../../src/db/pool';
import { resetThrottling } from '../../src/services/auth';
import { lastToken, outbox } from './outbox';

export const app = createApp();
export { pool, query };

/** A client that keeps its cookies between requests, like one browser */
export const browser = () => request.agent(app);
export type Browser = ReturnType<typeof browser>;

export async function resetDb() {
  await query(`TRUNCATE users, auth_sessions, auth_tokens, telegram_connect_requests, telegram_channels, telegram_bots RESTART IDENTITY CASCADE`);
  await query(`TRUNCATE instagram_accounts, products RESTART IDENTITY CASCADE`);
  await query(`DELETE FROM destinations WHERE config ? 'tg_channel' OR config ? 'ig_account_id'`);
  outbox.length = 0;
  resetThrottling();
}

let seq = 0;
export const newEmail = () => `user${++seq}@test.local`;
export const PASSWORD = 'correct-horse-1';

/** Signs up in a fresh browser; the account is unverified */
export async function signUp(email = newEmail(), password = PASSWORD, name = 'Test User') {
  const b = browser();
  const res = await b.post('/api/auth/register').send({ name, email, password }).expect(201);
  return { b, email, password, user: res.body.user };
}

/** Signs up and clicks the verification link */
export async function verifiedUser(email = newEmail(), password = PASSWORD) {
  const s = await signUp(email, password);
  await request(app).post('/api/auth/verify-email').send({ token: lastToken(email, 'verify-email') }).expect(200);
  return s;
}

/** Logs in from a new browser */
export async function logIn(email: string, password = PASSWORD) {
  const b = browser();
  await b.post('/api/auth/login').send({ email, password }).expect(200);
  return b;
}

/** Raw value of the session cookie in a Set-Cookie header list */
export function sessionCookie(setCookie: string[] | string | undefined) {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.find((c) => c.startsWith('sss_session='));
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
