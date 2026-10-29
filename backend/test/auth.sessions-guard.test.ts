import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { app, logIn, pool, query, resetDb, sessionCookie, verifiedUser } from './helpers/app';

beforeEach(resetDb);
afterAll(() => pool.end());

describe('active sessions', () => {
  it('lists every device of the user, marking the current one', async () => {
    const { b, email } = await verifiedUser();
    await logIn(email);
    const res = await b.get('/api/auth/sessions').set('User-Agent', 'TestBrowser/1.0').expect(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.filter((s: any) => s.current)).toHaveLength(1);
    expect(res.body[0].current).toBe(true); // current device first
    expect(res.body[0]).toHaveProperty('ip');
    expect(res.body[0]).not.toHaveProperty('token_hash');
  });

  it("does not show other users' sessions", async () => {
    const a = await verifiedUser();
    await verifiedUser();
    const res = await a.b.get('/api/auth/sessions').expect(200);
    expect(res.body).toHaveLength(1);
  });

  it('revokes one device immediately', async () => {
    const { b, email } = await verifiedUser();
    const phone = await logIn(email);
    const phoneId = (await b.get('/api/auth/sessions')).body.find((s: any) => !s.current).id;

    await b.delete(`/api/auth/sessions/${phoneId}`).expect(204);
    await phone.get('/api/meta').expect(401);
    await b.get('/api/meta').expect(200);
  });

  it("cannot revoke another user's session", async () => {
    const victim = await verifiedUser();
    const victimId = (await victim.b.get('/api/auth/sessions')).body[0].id;
    const { b } = await verifiedUser();
    await b.delete(`/api/auth/sessions/${victimId}`).expect(404);
    await victim.b.get('/api/meta').expect(200);
  });

  it('revoking the current session logs this browser out', async () => {
    const { b } = await verifiedUser();
    const id = (await b.get('/api/auth/sessions')).body[0].id;
    const res = await b.delete(`/api/auth/sessions/${id}`).expect(204);
    expect(sessionCookie(res.headers['set-cookie'])).toMatch(/Expires=Thu, 01 Jan 1970/);
    await b.get('/api/auth/me').expect(401);
  });

  it('signs out all other devices at once', async () => {
    const { b, email } = await verifiedUser();
    const phone = await logIn(email);
    const laptop = await logIn(email);
    expect((await b.post('/api/auth/sessions/revoke-others').expect(200)).body.revoked).toBe(2);
    await phone.get('/api/meta').expect(401);
    await laptop.get('/api/meta').expect(401);
    await b.get('/api/meta').expect(200);
  });

  it('records the client IP and user agent', async () => {
    const { email } = await verifiedUser();
    await request(app).post('/api/auth/login').set('User-Agent', 'Mozilla/5.0 Firefox/130.0').send({ email, password: 'correct-horse-1' }).expect(200);
    const rows = await query<{ user_agent: string; ip: string }>(`SELECT user_agent, ip FROM auth_sessions ORDER BY id DESC LIMIT 1`);
    expect(rows[0].user_agent).toBe('Mozilla/5.0 Firefox/130.0');
    expect(rows[0].ip).not.toBe('');
  });
});

describe('API access control', () => {
  it('keeps /health public', async () => {
    await request(app).get('/api/health').expect(200);
  });

  it('rejects anonymous requests to the panel API', async () => {
    const res = await request(app).get('/api/meta').expect(401);
    expect(res.body.code).toBe('unauthenticated');
  });

  it('lets n8n in with the shared API key, and only with the right one', async () => {
    await request(app).get('/api/meta').set('x-api-key', 'test-api-key').expect(200);
    await request(app).get('/api/meta').set('x-api-key', 'wrong-key').expect(401);
  });

  it('ignores a forged session cookie', async () => {
    await request(app).get('/api/meta').set('Cookie', 'sss_session=forged-token-value').expect(401);
  });
});

describe('CSRF protection', () => {
  it('blocks a state-changing request with the session cookie from another site', async () => {
    const { b, email } = await verifiedUser();
    const res = await b.put('/api/auth/profile').set('Origin', 'https://evil.example').send({ name: 'Hacked', email }).expect(403);
    expect(res.body.error).toBeTruthy();
    expect((await b.get('/api/auth/me')).body.user.name).not.toBe('Hacked');
  });

  it("allows the dashboard's own origin (APP_URL)", async () => {
    const { b, email } = await verifiedUser();
    await b.put('/api/auth/profile').set('Origin', 'http://localhost:5173').send({ name: 'Mine', email }).expect(200);
  });

  it('does not block safe GET requests from other origins', async () => {
    const { b } = await verifiedUser();
    await b.get('/api/auth/me').set('Origin', 'https://evil.example').expect(200);
  });
});
