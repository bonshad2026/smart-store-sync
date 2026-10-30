import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { config } from '../config';
import { query } from '../db/pool';
import { getAccount, igCall, publicUrlReady } from './instagram';
import type { IgParams } from './instagramApi';
import type { LinkItem, ResolvedMedia } from './media';

/**
 * Publishing to a connected Instagram account. Instagram fetches every file from a public URL
 * (PUBLIC_URL/uploads/...), so photos are converted to JPEG there first.
 *  - auto: one photo = post, one video = reel, several files = carousel
 *  - story: every file becomes its own story (stories have no caption)
 */

export const IG_FORMATS = ['auto', 'story'] as const;
export type IgFormat = (typeof IG_FORMATS)[number];

const CAPTION_LIMIT = 2200;
const MAX_HASHTAGS = 30;
const MAX_WAIT_MS = 5 * 60 * 1000;
// feed photos must be between 4:5 (portrait) and 1.91:1 (landscape); others are padded with white
const MIN_RATIO = 4 / 5;
const MAX_RATIO = 1.91;
const MAX_WIDTH = 1440;

const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });
const fa = (n: number) => n.toLocaleString('fa-IR');

/** Caption text: formatting tags removed, URL buttons appended as plain lines (Instagram captions have no links) */
export function buildCaption(body: string, links: LinkItem[] = []) {
  let text = body.replace(/<\/?(b|i|s|u|code)>/g, '').trim();
  const lines = links.filter((l) => l.url && /^https?:\/\//.test(l.url)).map((l) => `${l.title}: ${l.url}`);
  if (lines.length) text += `\n\n${lines.join('\n')}`;
  const tags = text.match(/#[^\s#]+/g) || [];
  if (tags.length > MAX_HASHTAGS) throw fail(`کپشن اینستاگرام حداکثر ${fa(MAX_HASHTAGS)} هشتگ می‌پذیرد (این متن ${fa(tags.length)} هشتگ دارد)`);
  const length = [...text].length;
  if (length > CAPTION_LIMIT) throw fail(`کپشن اینستاگرام حداکثر ${fa(CAPTION_LIMIT)} کاراکتر است (این متن ${fa(length)} کاراکتر دارد)`);
  return text;
}

async function readMedia(m: ResolvedMedia) {
  if (m.filePath) return fs.promises.readFile(m.filePath);
  const res = await fetch(m.publicUrl, { signal: AbortSignal.timeout(60000) }).catch(() => null);
  if (!res?.ok) throw fail(`فایل «${m.name}» دریافت نشد`);
  return Buffer.from(await res.arrayBuffer());
}

/** Public URL of a JPEG version of the photo that Instagram accepts (converted and padded only when needed) */
export async function instagramImageUrl(m: ResolvedMedia, feed: boolean): Promise<string> {
  const input = await readMedia(m);
  const meta = await sharp(input).metadata().catch(() => null);
  if (!meta?.width || !meta.height) throw fail(`فایل «${m.name}» عکس معتبری نیست`);
  const rotated = (meta.orientation ?? 1) >= 5;
  const [w, h] = rotated ? [meta.height, meta.width] : [meta.width, meta.height];
  const ratio = w / h;
  const pad = feed && (ratio < MIN_RATIO || ratio > MAX_RATIO);
  if (meta.format === 'jpeg' && !pad && w <= MAX_WIDTH && (meta.orientation ?? 1) === 1) return m.publicUrl;

  const name = `ig-${crypto.createHash('sha1').update(input).update(pad ? 'pad' : '').digest('hex').slice(0, 20)}.jpg`;
  const file = path.join(config.uploadDir, name);
  if (!fs.existsSync(file)) {
    let img = sharp(input).rotate().flatten({ background: '#ffffff' });
    if (pad) {
      const white = { r: 255, g: 255, b: 255, alpha: 1 };
      if (ratio < MIN_RATIO) {
        const extra = Math.ceil(h * MIN_RATIO) - w;
        img = img.extend({ left: Math.floor(extra / 2), right: Math.ceil(extra / 2), background: white });
      } else {
        const extra = Math.ceil(w / MAX_RATIO) - h;
        img = img.extend({ top: Math.floor(extra / 2), bottom: Math.ceil(extra / 2), background: white });
      }
      // extend() must run before resize(), so finish this step first
      img = sharp(await img.toBuffer());
    }
    await img.resize({ width: MAX_WIDTH, withoutEnlargement: true }).jpeg({ quality: 90, mozjpeg: true }).toFile(file);
  }
  return `${config.publicUrl}/uploads/${name}`;
}

const videoUrl = (m: ResolvedMedia) => m.publicUrl;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until Instagram has fetched and processed a container's file */
async function waitReady(accountId: number, containerId: string, name: string) {
  const started = Date.now();
  for (;;) {
    const c = await igCall<{ status_code?: string; status?: string }>(accountId, 'GET', `/${containerId}`, { fields: 'status_code,status' });
    if (!c.status_code || c.status_code === 'FINISHED' || c.status_code === 'PUBLISHED') return;
    if (c.status_code === 'ERROR' || c.status_code === 'EXPIRED') {
      throw fail(`اینستاگرام فایل «${name}» را نپذیرفت${c.status ? ` (${c.status})` : ''}`);
    }
    if (Date.now() - started > MAX_WAIT_MS) throw fail(`پردازش فایل «${name}» در اینستاگرام بیش از حد طول کشید`);
    await sleep(config.instagram.pollMs);
  }
}

async function container(accountId: number, igUserId: string, params: IgParams, name: string) {
  const { id } = await igCall<{ id: string }>(accountId, 'POST', `/${igUserId}/media`, params);
  await waitReady(accountId, id, name);
  return id;
}

async function publishContainer(accountId: number, igUserId: string, creationId: string) {
  const { id } = await igCall<{ id: string }>(accountId, 'POST', `/${igUserId}/media_publish`, { creation_id: creationId });
  const info = await igCall<{ permalink?: string }>(accountId, 'GET', `/${id}`, { fields: 'permalink' }).catch(() => ({ permalink: '' }));
  return { id, permalink: info.permalink || '' };
}

/** Instagram allows a limited number of API posts per 24 hours */
async function checkQuota(accountId: number, igUserId: string) {
  const r = await igCall<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>(
    accountId, 'GET', `/${igUserId}/content_publishing_limit`, { fields: 'quota_usage,config' },
  ).catch((e) => {
    if ((e as { status?: number }).status === 409) throw e; // the account itself is unusable
    return null;
  });
  const q = r?.data?.[0];
  if (q?.config?.quota_total && (q.quota_usage ?? 0) >= q.config.quota_total) {
    throw fail(`سقف انتشار روزانهٔ اینستاگرام (${fa(q.config.quota_total)} پست در ۲۴ ساعت) پر شده است`, 429);
  }
}

export interface InstagramPublishInput {
  accountId: number;
  body: string;
  media: ResolvedMedia[];
  links?: LinkItem[];
  format?: IgFormat;
  contentId?: number;
}

export async function publishToInstagram(input: InstagramPublishInput) {
  if (!publicUrlReady()) throw fail('آدرس عمومی سرور (PUBLIC_URL) برای انتشار در اینستاگرام تنظیم نشده است', 503);
  const account = await getAccount(input.accountId);
  if (!account) throw fail('پیج اینستاگرام یافت نشد', 404);
  const items = input.media.filter((m) => m.type === 'image' || m.type === 'video');
  if (!items.length) throw fail('اینستاگرام بدون عکس یا ویدیو منتشر نمی‌کند؛ به محتوا عکس یا ویدیو اضافه کنید');
  const story = input.format === 'story';
  const caption = story ? '' : buildCaption(input.body, input.links);
  const { id: accountId, ig_user_id: ig } = account;
  await checkQuota(accountId, ig);

  const published: { id: string; permalink: string; format: string }[] = [];
  if (story) {
    for (const m of items) {
      const params = m.type === 'image'
        ? { media_type: 'STORIES', image_url: await instagramImageUrl(m, false) }
        : { media_type: 'STORIES', video_url: videoUrl(m) };
      const p = await publishContainer(accountId, ig, await container(accountId, ig, params, m.name));
      published.push({ ...p, format: 'story' });
    }
  } else if (items.length === 1) {
    const m = items[0];
    const params: Record<string, string> = m.type === 'image'
      ? { image_url: await instagramImageUrl(m, true), caption }
      : { media_type: 'REELS', video_url: videoUrl(m), caption };
    const p = await publishContainer(accountId, ig, await container(accountId, ig, params, m.name));
    published.push({ ...p, format: m.type === 'image' ? 'image' : 'reel' });
  } else {
    const children: string[] = [];
    for (const m of items) {
      const params = m.type === 'image'
        ? { image_url: await instagramImageUrl(m, true), is_carousel_item: true }
        : { media_type: 'VIDEO', video_url: videoUrl(m), is_carousel_item: true };
      children.push(await container(accountId, ig, params, m.name));
    }
    const carousel = await container(accountId, ig, { media_type: 'CAROUSEL', children: children.join(','), caption }, 'کاروسل');
    published.push({ ...(await publishContainer(accountId, ig, carousel)), format: 'carousel' });
  }

  for (const p of published) {
    await query(
      `INSERT INTO instagram_posts (account_id, media_id, format, permalink, caption, content_id) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (account_id, media_id) DO NOTHING`,
      [accountId, p.id, p.format, p.permalink, caption, input.contentId ?? null],
    );
  }
  return { account, published };
}
