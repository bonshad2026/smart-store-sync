import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../src/config';
import { open } from '../src/services/secretBox';
import { app, Browser, pool, query, resetDb, sha256, verifiedUser } from './helpers/app';

const IG_USER = '17841400000000001';

// A fake Instagram API: records calls and answers from the state below
const ig = vi.hoisted(() => ({
  calls: [] as { method: string; url: string; params: Record<string, any> }[],
  containers: {} as Record<string, Record<string, any>>,
  /** status_code answers per container before it reports FINISHED */
  progress: {} as Record<string, string[]>,
  /** answer with this Graph error code when the path matches */
  failOn: null as null | { path: RegExp; code: number; message: string },
  quotaUsage: 0,
  seq: 0,
}));
vi.mock('../src/services/instagramApi', async (original) => {
  const real = await original<typeof import('../src/services/instagramApi')>();
  return {
    ...real,
    igRequest: vi.fn(async (method: string, url: string, params: Record<string, any> = {}) => {
      ig.calls.push({ method, url, params });
      if (ig.failOn?.path.test(url)) throw new real.InstagramError(`خطای اینستاگرام: ${ig.failOn.message}`, 400, ig.failOn.code);
      if (url === 'https://api.instagram.com/oauth/access_token') {
        if (params.code !== 'good-code') throw new real.InstagramError('خطای اینستاگرام: Invalid authorization code', 400, 100);
        return { data: [{ access_token: 'short-token', user_id: IG_USER, permissions: 'instagram_business_basic,instagram_business_content_publish' }] };
      }
      if (url === '/access_token') return { access_token: 'long-token', token_type: 'bearer', expires_in: 5184000 };
      if (url === '/refresh_access_token') return { access_token: 'refreshed-token', token_type: 'bearer', expires_in: 5184000 };
      if (url === '/me') {
        return { user_id: IG_USER, username: 'shop', name: 'Shop', account_type: 'BUSINESS', followers_count: 1200, follows_count: 10, media_count: 42 };
      }
      if (url.endsWith('/content_publishing_limit')) return { data: [{ quota_usage: ig.quotaUsage, config: { quota_total: 100 } }] };
      if (method === 'POST' && url === `/${IG_USER}/media`) {
        const id = `c${++ig.seq}`;
        ig.containers[id] = params;
        if (params.video_url) ig.progress[id] = ['IN_PROGRESS'];
        return { id };
      }
      if (method === 'POST' && url === `/${IG_USER}/media_publish`) return { id: `m${params.creation_id.slice(1)}` };
      const c = /^\/(c\d+)$/.exec(url);
      if (c) return { status_code: ig.progress[c[1]]?.shift() ?? 'FINISHED', id: c[1] };
      const m = /^\/(m\d+)$/.exec(url);
      if (m) return { permalink: `https://www.instagram.com/p/${m[1]}/` };
      throw new Error(`unexpected Instagram call ${method} ${url}`);
    }),
  };
});

const calls = (pattern: RegExp, method?: string) => ig.calls.filter((c) => pattern.test(c.url) && (!method || c.method === method));
const containers = () => calls(new RegExp(`^/${IG_USER}/media$`), 'POST').map((c) => c.params);

async function admin() {
  return (await verifiedUser()).b; // first account = admin
}

/** Panel connect button -> Instagram sign-in -> callback, as the browser would do it */
async function connect(b: Browser, code = 'good-code') {
  const { id, url } = (await b.post('/api/instagram/connect').expect(201)).body;
  const state = new URL(url).searchParams.get('state');
  const res = await request(app).get('/api/instagram/callback').query({ code: `${code}#_`, state }).expect(302);
  return { id, url, state: state!, location: res.headers.location as string };
}

async function connectedAccount(b: Browser) {
  await connect(b);
  const [a] = await query<{ id: number; destination_id: number }>(`SELECT id, destination_id FROM instagram_accounts`);
  return a;
}

/** A product content for Instagram with the given files in the upload folder */
async function content(files: { name: string; type: 'image' | 'video' }[], body = 'متن پست #فروش', links: unknown[] = []) {
  const [p] = await query<{ id: number }>(`INSERT INTO products (sku, name, price) VALUES ($1, 'کفش', 1000) RETURNING id`, [`sku-${Date.now()}-${Math.random()}`]);
  const media = files.map((f) => ({ type: f.type, url: `/uploads/${f.name}`, name: f.name }));
  const [c] = await query<{ id: number }>(
    `INSERT INTO contents (product_id, channel, body, media, links, product_media) VALUES ($1, 'instagram', $2, $3, $4, 'none') RETURNING id`,
    [p.id, body, JSON.stringify(media), JSON.stringify(links)],
  );
  return c.id;
}

async function image(name: string, width = 800, height = 800, format: 'png' | 'jpeg' = 'png') {
  const img = sharp({ create: { width, height, channels: 3, background: '#3366cc' } });
  await (format === 'png' ? img.png() : img.jpeg()).toFile(path.join(config.uploadDir, name));
  return { name, type: 'image' as const };
}
function video(name: string) {
  fs.writeFileSync(path.join(config.uploadDir, name), Buffer.from('not really a video'));
  return { name, type: 'video' as const };
}

const publish = (b: Browser, contentId: number, destinationId: number, extra: Record<string, unknown> = {}) =>
  b.post(`/api/contents/${contentId}/publish`).send({ destinationIds: [destinationId], ...extra }).expect(200);

beforeEach(async () => {
  await resetDb();
  fs.mkdirSync(config.uploadDir, { recursive: true });
  ig.calls.length = 0;
  ig.containers = {};
  ig.progress = {};
  ig.failOn = null;
  ig.quotaUsage = 0;
  ig.seq = 0;
});
afterAll(() => pool.end());

describe('who can connect', () => {
  it('only the store admin, not members or anonymous visitors', async () => {
    await admin();
    const member = await verifiedUser();
    await member.b.post('/api/instagram/connect').expect(403);
    await request(app).post('/api/instagram/connect').expect(401);
    await request(app).post('/api/instagram/connect').set('x-api-key', 'test-api-key').expect(403);
  });
});

describe('connect flow', () => {
  it('builds the Instagram sign-in URL and stores only a hash of the state', async () => {
    const b = await admin();
    const { id, url } = (await b.post('/api/instagram/connect').expect(201)).body;
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://www.instagram.com/oauth/authorize');
    expect(u.searchParams.get('client_id')).toBe('1234567890');
    expect(u.searchParams.get('redirect_uri')).toBe('https://panel.example.test/api/instagram/callback');
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('scope')!.split(',')).toEqual(expect.arrayContaining([
      'instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_comments',
      'instagram_business_manage_messages', 'instagram_business_manage_insights',
    ]));
    const [reqId, state] = u.searchParams.get('state')!.split('.');
    expect(Number(reqId)).toBe(id);
    const [row] = await query<{ state_hash: string }>(`SELECT state_hash FROM instagram_connect_requests WHERE id=$1`, [id]);
    expect(row.state_hash).toBe(sha256(state));
    expect((await b.get(`/api/instagram/connect/${id}`)).body.status).toBe('pending');
  });

  it('connects the account, keeps its token encrypted and creates a publishing destination', async () => {
    const b = await admin();
    const { id, location } = await connect(b);
    const [platform] = await query<{ id: number; delivery: string }>(`SELECT id, delivery FROM platforms WHERE key='instagram'`);
    expect(platform.delivery).toBe('instagram');
    expect(location).toBe(`http://localhost:5173/#/channels/${platform.id}?ig_connect=${id}`);

    // code -> short-lived token -> long-lived token, the code without Instagram's trailing "#_"
    expect(calls(/oauth\/access_token$/)[0].params).toMatchObject({
      client_id: '1234567890', client_secret: 'test-instagram-secret', grant_type: 'authorization_code', code: 'good-code',
      redirect_uri: 'https://panel.example.test/api/instagram/callback',
    });
    expect(calls(/^\/access_token$/)[0].params).toMatchObject({ grant_type: 'ig_exchange_token', access_token: 'short-token' });

    const status = (await b.get(`/api/instagram/connect/${id}`)).body;
    expect(status.status).toBe('connected');
    expect(status.account).toMatchObject({ username: 'shop', followers_count: 1200, media_count: 42, status: 'active' });
    expect(status.account.token_enc).toBeUndefined();

    const [acc] = await query<{ token_enc: string; token_expires_at: Date; destination_id: number }>(`SELECT * FROM instagram_accounts`);
    expect(acc.token_enc).not.toContain('long-token');
    expect(open(acc.token_enc)).toBe('long-token');
    expect(acc.token_expires_at.getTime()).toBeGreaterThan(Date.now() + 59 * 24 * 3600 * 1000);
    const [dest] = await query<{ name: string; enabled: boolean; config: any; platform_id: number }>(`SELECT * FROM destinations WHERE id=$1`, [acc.destination_id]);
    expect(dest).toMatchObject({ name: '@shop', enabled: true, platform_id: platform.id });
    expect(dest.config.ig_account_id).toBeGreaterThan(0);

    const list = (await b.get('/api/instagram').expect(200)).body;
    expect(list).toMatchObject({ configured: true, public_url: true });
    expect(list.accounts).toHaveLength(1);
  });

  it('uses a state only once and ignores forged ones', async () => {
    const b = await admin();
    const { id, state } = await connect(b);
    const exchanges = calls(/oauth\/access_token$/).length;
    await request(app).get('/api/instagram/callback').query({ code: 'good-code', state }).expect(302);
    await request(app).get('/api/instagram/callback').query({ code: 'good-code', state: `${id}.forged` }).expect(302);
    await request(app).get('/api/instagram/callback').query({ code: 'good-code' }).expect(302);
    expect(calls(/oauth\/access_token$/)).toHaveLength(exchanges);
  });

  it('reports a cancelled sign-in', async () => {
    const b = await admin();
    const { id, url } = (await b.post('/api/instagram/connect').expect(201)).body;
    const state = new URL(url).searchParams.get('state');
    await request(app).get('/api/instagram/callback')
      .query({ error: 'access_denied', error_reason: 'user_denied', error_description: 'The user denied your request.', state }).expect(302);
    const status = (await b.get(`/api/instagram/connect/${id}`)).body;
    expect(status).toMatchObject({ status: 'failed', error: 'اتصال در اینستاگرام لغو شد' });
    expect(calls(/access_token/)).toHaveLength(0);
  });

  it('reports a failed token exchange', async () => {
    const b = await admin();
    const { id } = await connect(b, 'bad-code');
    const status = (await b.get(`/api/instagram/connect/${id}`)).body;
    expect(status.status).toBe('failed');
    expect(status.error).toContain('Invalid authorization code');
    expect(await query(`SELECT * FROM instagram_accounts`)).toHaveLength(0);
  });

  it('another user cannot read the connect result', async () => {
    const b = await admin();
    const { id } = await connect(b);
    const other = await verifiedUser();
    await other.b.get(`/api/instagram/connect/${id}`).expect(403); // not an admin
  });
});

describe('publishing', () => {
  it('publishes one photo as a post, converted to JPEG, with link lines in the caption', async () => {
    const b = await admin();
    const acc = await connectedAccount(b);
    const id = await content([await image('photo.png')], '<b>کفش جدید</b> #کفش', [{ title: 'خرید', url: 'https://shop.example/p/1' }]);
    const r = (await publish(b, id, acc.destination_id)).body;
    expect(r.results[0]).toMatchObject({ status: 'sent' });
    expect(r.results[0].message).toContain('https://www.instagram.com/p/');

    const [c] = containers();
    expect(c.image_url).toMatch(/^https:\/\/panel\.example\.test\/uploads\/ig-[0-9a-f]+\.jpg$/);
    expect(c.caption).toBe('کفش جدید #کفش\n\nخرید: https://shop.example/p/1');
    expect(c.access_token).toBe('long-token');
    const file = path.join(config.uploadDir, path.basename(c.image_url));
    expect((await sharp(file).metadata()).format).toBe('jpeg');
    expect(calls(/media_publish$/)[0].params.creation_id).toBe('c1');

    const [post] = await query<{ format: string; media_id: string; content_id: number }>(`SELECT * FROM instagram_posts`);
    expect(post).toMatchObject({ format: 'image', media_id: 'm1', content_id: id });
    const [pub] = await query<{ status: string; external_id: string; options: any }>(`SELECT * FROM publications`);
    expect(pub).toMatchObject({ status: 'sent', external_id: 'm1', options: { instagram_format: 'auto' } });
  });

  it('sends a JPEG that already fits as it is', async () => {
    const b = await admin();
    const acc = await connectedAccount(b);
    const id = await content([await image('photo.jpg', 1080, 1080, 'jpeg')]);
    await publish(b, id, acc.destination_id);
    expect(containers()[0].image_url).toBe('https://panel.example.test/uploads/photo.jpg');
  });

  it('pads photos that are too tall for the feed to 4:5', async () => {
    const b = await admin();
    const acc = await connectedAccount(b);
    const id = await content([await image('tall.jpg', 400, 1000, 'jpeg')]);
    await publish(b, id, acc.destination_id);
    const meta = await sharp(path.join(config.uploadDir, path.basename(containers()[0].image_url))).metadata();
    expect(meta.width! / meta.height!).toBeCloseTo(0.8, 2);
  });

  it('publishes one video as a reel after Instagram has processed it', async () => {
    const b = await admin();
    const acc = await connectedAccount(b);
    const id = await content([video('clip.mp4')]);
    await publish(b, id, acc.destination_id);
    expect(containers()[0]).toMatchObject({ media_type: 'REELS', video_url: 'https://panel.example.test/uploads/clip.mp4' });
    expect(calls(/^\/c1$/)).toHaveLength(2); // IN_PROGRESS, then FINISHED
    const [post] = await query<{ format: string }>(`SELECT format FROM instagram_posts`);
    expect(post.format).toBe('reel');
  });

  it('publishes several files as one carousel', async () => {
    const b = await admin();
    const acc = await connectedAccount(b);
    const id = await content([await image('a.png'), video('b.mp4'), await image('c.jpg', 1080, 1080, 'jpeg')]);
    await publish(b, id, acc.destination_id);
    const [one, two, three, carousel] = containers();
    expect(one).toMatchObject({ is_carousel_item: true });
    expect(one.caption).toBeUndefined();
    expect(two).toMatchObject({ is_carousel_item: true, media_type: 'VIDEO' });
    expect(three).toMatchObject({ is_carousel_item: true, image_url: 'https://panel.example.test/uploads/c.jpg' });
    expect(carousel).toMatchObject({ media_type: 'CAROUSEL', children: 'c1,c2,c3', caption: 'متن پست #فروش' });
    expect(calls(/media_publish$/)).toHaveLength(1);
    expect(calls(/media_publish$/)[0].params.creation_id).toBe('c4');
  });

  it('publishes every file as its own story, without a caption', async () => {
    const b = await admin();
    const acc = await connectedAccount(b);
    const id = await content([await image('s1.png', 1080, 1920), await image('s2.png')]);
    const r = (await publish(b, id, acc.destination_id, { instagramFormat: 'story' })).body;
    expect(r.results[0].status).toBe('sent');
    expect(containers()).toHaveLength(2);
    for (const c of containers()) {
      expect(c.media_type).toBe('STORIES');
      expect(c.caption).toBeUndefined();
    }
    expect(calls(/media_publish$/)).toHaveLength(2);
    const posts = await query<{ format: string }>(`SELECT format FROM instagram_posts`);
    expect(posts.map((p) => p.format)).toEqual(['story', 'story']);
  });

  it('refuses content without a photo or video', async () => {
    const b = await admin();
    const acc = await connectedAccount(b);
    const id = await content([]);
    const r = (await publish(b, id, acc.destination_id)).body;
    expect(r.results[0]).toMatchObject({ status: 'failed' });
    expect(r.results[0].message).toContain('بدون عکس یا ویدیو');
    expect(containers()).toHaveLength(0);
  });

  it('refuses captions with more than 30 hashtags', async () => {
    const b = await admin();
    const acc = await connectedAccount(b);
    const tags = Array.from({ length: 31 }, (_, i) => `#tag${i}`).join(' ');
    const id = await content([await image('p.png')], tags);
    const r = (await publish(b, id, acc.destination_id)).body;
    expect(r.results[0].status).toBe('failed');
    expect(r.results[0].message).toContain('هشتگ');
    expect(containers()).toHaveLength(0);
  });

  it('stops when the daily publishing limit is reached', async () => {
    const b = await admin();
    const acc = await connectedAccount(b);
    ig.quotaUsage = 100;
    const id = await content([await image('p.png')]);
    const r = (await publish(b, id, acc.destination_id)).body;
    expect(r.results[0].status).toBe('failed');
    expect(r.results[0].message).toContain('سقف انتشار');
    expect(containers()).toHaveLength(0);
  });

  it('marks the account for reconnecting when Instagram rejects its token', async () => {
    const b = await admin();
    const acc = await connectedAccount(b);
    ig.failOn = { path: /content_publishing_limit|\/media$/, code: 190, message: 'Error validating access token' };
    const id = await content([await image('p.png')]);
    const r = (await publish(b, id, acc.destination_id)).body;
    expect(r.results[0].status).toBe('failed');
    expect(r.results[0].message).toContain('دوباره وصل کنید');
    const [a] = await query<{ status: string }>(`SELECT status FROM instagram_accounts`);
    expect(a.status).toBe('expired');
  });

  it('a test of the destination only checks the connection', async () => {
    const b = await admin();
    const acc = await connectedAccount(b);
    const r = (await b.post(`/api/destinations/${acc.destination_id}/test`).expect(200)).body;
    expect(r.message).toContain('@shop');
    expect(containers()).toHaveLength(0);
  });
});

describe('account upkeep', () => {
  it('renews a week-old token and updates the profile', async () => {
    const b = await admin();
    const acc = await connectedAccount(b);
    await query(`UPDATE instagram_accounts SET token_refreshed_at = NOW() - INTERVAL '8 days', followers_count = 1`);
    const a = (await b.post(`/api/instagram/accounts/${acc.id}/refresh`).expect(200)).body;
    expect(a.followers_count).toBe(1200);
    expect(calls(/refresh_access_token/)[0].params).toMatchObject({ grant_type: 'ig_refresh_token', access_token: 'long-token' });
    const [row] = await query<{ token_enc: string }>(`SELECT token_enc FROM instagram_accounts`);
    expect(open(row.token_enc)).toBe('refreshed-token');
  });

  it('keeps a fresh token', async () => {
    const b = await admin();
    const acc = await connectedAccount(b);
    await b.post(`/api/instagram/accounts/${acc.id}/refresh`).expect(200);
    expect(calls(/refresh_access_token/)).toHaveLength(0);
  });

  it('disconnecting forgets the token and disables the destination', async () => {
    const b = await admin();
    const acc = await connectedAccount(b);
    const a = (await b.post(`/api/instagram/accounts/${acc.id}/disconnect`).expect(200)).body;
    expect(a.status).toBe('disconnected');
    const [row] = await query<{ token_enc: string }>(`SELECT token_enc FROM instagram_accounts`);
    expect(row.token_enc).toBe('');
    const [dest] = await query<{ enabled: boolean }>(`SELECT enabled FROM destinations WHERE id=$1`, [acc.destination_id]);
    expect(dest.enabled).toBe(false);

    // connecting again re-activates the same account and destination
    await connect(b);
    const accounts = await query<{ status: string; destination_id: number }>(`SELECT status, destination_id FROM instagram_accounts`);
    expect(accounts).toEqual([{ status: 'active', destination_id: acc.destination_id }]);
  });

  it('members cannot disconnect', async () => {
    const b = await admin();
    const acc = await connectedAccount(b);
    const member = await verifiedUser();
    await member.b.post(`/api/instagram/accounts/${acc.id}/disconnect`).expect(403);
  });
});
