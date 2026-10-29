import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanupAuth } from '../src/services/auth';
import { app, logIn, newEmail, PASSWORD, pool, query, resetDb, signUp, verifiedUser } from './helpers/app';
import { lastToken, outbox } from './helpers/outbox';

beforeEach(resetDb);
afterAll(() => pool.end());

describe('e-mail verification', () => {
  it('unlocks the panel once the link is opened', async () => {
    const { b, email } = await signUp();
    const blocked = await b.get('/api/meta').expect(403);
    expect(blocked.body.code).toBe('unverified');

    await request(app).post('/api/auth/verify-email').send({ token: lastToken(email, 'verify-email') }).expect(200);
    expect((await b.get('/api/auth/me')).body.user.email_verified).toBe(true);
    await b.get('/api/meta').expect(200);
  });

  it('accepts each link only once', async () => {
    const { email } = await signUp();
    const token = lastToken(email, 'verify-email');
    await request(app).post('/api/auth/verify-email').send({ token }).expect(200);
    await request(app).post('/api/auth/verify-email').send({ token }).expect(400);
  });

  it('rejects unknown and expired links', async () => {
    const { email } = await signUp();
    await request(app).post('/api/auth/verify-email').send({ token: 'x'.repeat(43) }).expect(400);
    await query(`UPDATE auth_tokens SET expires_at = NOW() - INTERVAL '1 minute'`);
    await request(app).post('/api/auth/verify-email').send({ token: lastToken(email, 'verify-email') }).expect(400);
  });

  it('resending invalidates the previous link and is rate limited', async () => {
    const { b, email } = await signUp();
    const first = lastToken(email, 'verify-email');
    await b.post('/api/auth/resend-verification').expect(200);
    const second = lastToken(email, 'verify-email');
    expect(second).not.toBe(first);
    await request(app).post('/api/auth/verify-email').send({ token: first }).expect(400);

    await b.post('/api/auth/resend-verification').expect(200);
    await b.post('/api/auth/resend-verification').expect(200);
    await b.post('/api/auth/resend-verification').expect(429);
  });

  it('lets unverified users reach their own account endpoints', async () => {
    const { b, email } = await signUp();
    await b.get('/api/auth/sessions').expect(200);
    await b.put('/api/auth/profile').send({ name: 'Renamed', email }).expect(200);
  });
});

describe('profile', () => {
  it('changes the name without asking for the password', async () => {
    const { b, email } = await verifiedUser();
    const res = await b.put('/api/auth/profile').send({ name: 'New Name', email }).expect(200);
    expect(res.body.user.name).toBe('New Name');
    expect(res.body.user.email_verified).toBe(true);
  });

  it('needs the correct current password to change the e-mail', async () => {
    const { b } = await verifiedUser();
    await b.put('/api/auth/profile').send({ name: 'X Y', email: newEmail() }).expect(400);
    await b.put('/api/auth/profile').send({ name: 'X Y', email: newEmail(), current_password: 'wrong-password' }).expect(400);
  });

  it('refuses an e-mail that belongs to someone else', async () => {
    const other = await verifiedUser();
    const { b } = await verifiedUser();
    await b.put('/api/auth/profile').send({ name: 'X Y', email: other.email, current_password: PASSWORD }).expect(409);
  });

  it('a new e-mail must be verified again', async () => {
    const { b } = await verifiedUser();
    const next = newEmail();
    const res = await b.put('/api/auth/profile').send({ name: 'X Y', email: next, current_password: PASSWORD }).expect(200);
    expect(res.body.user.email).toBe(next);
    expect(res.body.user.email_verified).toBe(false);
    await b.get('/api/meta').expect(403);

    await request(app).post('/api/auth/verify-email').send({ token: lastToken(next, 'verify-email') }).expect(200);
    await b.get('/api/meta').expect(200);
  });
});

describe('change password', () => {
  it('rejects a wrong current password', async () => {
    const { b } = await verifiedUser();
    await b.post('/api/auth/change-password').send({ current_password: 'wrong-password', new_password: 'another-pass-2' }).expect(400);
  });

  it('keeps this device signed in and signs out all others', async () => {
    const { b, email } = await verifiedUser();
    const phone = await logIn(email);
    const res = await b.post('/api/auth/change-password').send({ current_password: PASSWORD, new_password: 'another-pass-2' }).expect(200);
    expect(res.body.revoked).toBe(1);
    await b.get('/api/meta').expect(200);
    await phone.get('/api/meta').expect(401);

    await request(app).post('/api/auth/login').send({ email, password: PASSWORD }).expect(401);
    await request(app).post('/api/auth/login').send({ email, password: 'another-pass-2' }).expect(200);
  });
});

describe('forgot / reset password', () => {
  it('answers the same for unknown e-mails and sends nothing', async () => {
    const res = await request(app).post('/api/auth/forgot-password').send({ email: 'nobody@test.local' }).expect(200);
    expect(res.body).toEqual({ ok: true });
    expect(outbox).toHaveLength(0);
  });

  it('resets the password with the e-mailed link and signs out every device', async () => {
    const { b, email } = await verifiedUser();
    await request(app).post('/api/auth/forgot-password').send({ email }).expect(200);
    const token = lastToken(email, 'reset-password');

    await request(app).post('/api/auth/reset-password').send({ token, password: 'short' }).expect(400);
    await request(app).post('/api/auth/reset-password').send({ token, password: 'brand-new-pass-3' }).expect(200);

    await b.get('/api/auth/me').expect(401);
    await request(app).post('/api/auth/login').send({ email, password: PASSWORD }).expect(401);
    await request(app).post('/api/auth/login').send({ email, password: 'brand-new-pass-3' }).expect(200);
    // single use
    await request(app).post('/api/auth/reset-password').send({ token, password: 'brand-new-pass-4' }).expect(400);
  });

  it('rejects an expired reset link', async () => {
    const { email } = await verifiedUser();
    await request(app).post('/api/auth/forgot-password').send({ email }).expect(200);
    await query(`UPDATE auth_tokens SET expires_at = NOW() - INTERVAL '1 minute' WHERE kind = 'reset_password'`);
    await request(app).post('/api/auth/reset-password').send({ token: lastToken(email, 'reset-password'), password: 'brand-new-pass-3' }).expect(400);
  });

  it('a reset proves ownership of the address, so it also verifies it', async () => {
    const { email } = await signUp();
    await request(app).post('/api/auth/forgot-password').send({ email }).expect(200);
    await request(app).post('/api/auth/reset-password').send({ token: lastToken(email, 'reset-password'), password: 'brand-new-pass-3' }).expect(200);
    const b = await logIn(email, 'brand-new-pass-3');
    expect((await b.get('/api/auth/me')).body.user.email_verified).toBe(true);
  });

  it('is rate limited per e-mail', async () => {
    const { email } = await verifiedUser();
    for (let i = 0; i < 3; i++) await request(app).post('/api/auth/forgot-password').send({ email }).expect(200);
    await request(app).post('/api/auth/forgot-password').send({ email }).expect(429);
  });
});

describe('cleanup of unverified accounts', () => {
  const insertUser = (email: string, role: string, daysOld: number, verified: boolean) =>
    query(
      `INSERT INTO users (name, email, password_hash, role, created_at, email_verified_at)
       VALUES ('x', $1, 'x', $2, NOW() - make_interval(days => $3), CASE WHEN $4 THEN NOW() END)`,
      [email, role, daysOld, verified],
    );

  it('deletes only non-admin accounts left unverified past the limit', async () => {
    await insertUser('old-unverified@test.local', 'member', 8, false);
    await insertUser('fresh-unverified@test.local', 'member', 1, false);
    await insertUser('old-verified@test.local', 'member', 30, true);
    await insertUser('old-admin@test.local', 'admin', 30, false);

    expect(await cleanupAuth()).toBe(1);
    const left = (await query<{ email: string }>(`SELECT email FROM users ORDER BY email`)).map((u) => u.email);
    expect(left).toEqual(['fresh-unverified@test.local', 'old-admin@test.local', 'old-verified@test.local']);
  });

  it('removes expired sessions', async () => {
    const { email } = await verifiedUser();
    await logIn(email);
    await query(`UPDATE auth_sessions SET expires_at = NOW() - INTERVAL '1 day' WHERE id = 1`);
    await cleanupAuth();
    expect((await query(`SELECT id FROM auth_sessions`)).length).toBe(1);
  });
});
