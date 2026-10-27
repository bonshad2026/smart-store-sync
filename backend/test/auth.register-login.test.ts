import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { app, browser, logIn, newEmail, PASSWORD, pool, query, resetDb, sessionCookie, sha256, signUp } from './helpers/app';
import { outbox } from './helpers/outbox';

beforeEach(resetDb);
afterAll(() => pool.end());

describe('status', () => {
  it('reports a fresh install with registration open', async () => {
    const res = await request(app).get('/api/auth/status').expect(200);
    expect(res.body).toEqual({ has_users: false, registration_open: true });
  });

  it('is closed to new sign-ups when ALLOW_REGISTRATION=false, except for the first account', async () => {
    config.auth.allowRegistration = false;
    try {
      expect((await request(app).get('/api/auth/status')).body.registration_open).toBe(true);
      await signUp();
      expect((await request(app).get('/api/auth/status')).body).toEqual({ has_users: true, registration_open: false });
      await request(app).post('/api/auth/register').send({ name: 'Late', email: newEmail(), password: PASSWORD }).expect(403);
    } finally {
      config.auth.allowRegistration = true;
    }
  });
});

describe('register', () => {
  it('makes the first account admin and later ones members', async () => {
    const first = await signUp();
    const second = await signUp();
    expect(first.user.role).toBe('admin');
    expect(second.user.role).toBe('member');
  });

  it('starts unverified and e-mails a verification link to the new address', async () => {
    const { user, email } = await signUp();
    expect(user.email_verified).toBe(false);
    expect(outbox).toHaveLength(1);
    expect(outbox[0].to).toBe(email);
    expect(outbox[0].url).toMatch(/^http:\/\/localhost:5173\/#\/verify-email\?token=/);
  });

  it('sets an HttpOnly, SameSite=Lax session cookie and never returns the token in the body', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'Cookie', email: newEmail(), password: PASSWORD }).expect(201);
    const cookie = sessionCookie(res.headers['set-cookie']);
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Secure/i); // APP_URL is http in tests
    expect(res.body.token).toBeUndefined();
    expect(res.body.user).not.toHaveProperty('password_hash');
  });

  it('stores only hashes of the password and the session token', async () => {
    const email = newEmail();
    const res = await request(app).post('/api/auth/register').send({ name: 'Hash', email, password: PASSWORD }).expect(201);
    const [user] = await query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE email = $1`, [email]);
    expect(user.password_hash).toMatch(/^scrypt\$/);
    expect(user.password_hash).not.toContain(PASSWORD);

    const token = sessionCookie(res.headers['set-cookie'])!.split(';')[0].split('=')[1];
    const sessions = await query<{ token_hash: string }>(`SELECT token_hash FROM auth_sessions`);
    expect(sessions.map((s) => s.token_hash)).toEqual([sha256(decodeURIComponent(token))]);
  });

  it('normalises the e-mail and rejects duplicates in any letter case', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'Case', email: '  Mixed@Test.Local ', password: PASSWORD }).expect(201);
    expect(res.body.user.email).toBe('mixed@test.local');
    await request(app).post('/api/auth/register').send({ name: 'Dup', email: 'MIXED@test.local', password: PASSWORD }).expect(409);
  });

  it('validates name, e-mail and password length', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'a', email: 'not-an-email', password: 'short' }).expect(400);
    expect(res.body.details.join(' ')).toMatch(/name/);
    expect(res.body.details.join(' ')).toMatch(/email/);
    expect(res.body.details.join(' ')).toMatch(/password/);
  });
});

describe('login / me / logout', () => {
  it('logs in with any letter case of the e-mail and returns the user', async () => {
    const { email } = await signUp();
    const b = browser();
    const res = await b.post('/api/auth/login').send({ email: email.toUpperCase(), password: PASSWORD }).expect(200);
    expect(res.body.user.email).toBe(email);
    expect(sessionCookie(res.headers['set-cookie'])).toBeDefined();
    expect((await b.get('/api/auth/me').expect(200)).body.user.email).toBe(email);
  });

  it('gives the same answer for a wrong password and an unknown e-mail', async () => {
    const { email } = await signUp();
    const wrong = await request(app).post('/api/auth/login').send({ email, password: 'wrong-password' }).expect(401);
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@test.local', password: 'whatever1' }).expect(401);
    expect(wrong.body.error).toBe(unknown.body.error);
  });

  it('blocks an IP after 10 failed logins, even with the right password', async () => {
    const { email } = await signUp();
    for (let i = 0; i < 10; i++) await request(app).post('/api/auth/login').send({ email, password: 'wrong-password' }).expect(401);
    await request(app).post('/api/auth/login').send({ email, password: PASSWORD }).expect(429);
  });

  it('answers 401 on /me without a session', async () => {
    const res = await request(app).get('/api/auth/me').expect(401);
    expect(res.body.code).toBe('unauthenticated');
  });

  it('logout revokes the session on the server, not just in the browser', async () => {
    const { email } = await signUp();
    const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200);
    const cookie = sessionCookie(res.headers['set-cookie'])!.split(';')[0];

    await request(app).post('/api/auth/logout').set('Cookie', cookie).expect(204);
    // replaying the old cookie no longer works
    await request(app).get('/api/auth/me').set('Cookie', cookie).expect(401);
  });

  it('rejects an expired session', async () => {
    const b = await logIn((await signUp()).email);
    await query(`UPDATE auth_sessions SET expires_at = NOW() - INTERVAL '1 minute'`);
    await b.get('/api/auth/me').expect(401);
  });
});
