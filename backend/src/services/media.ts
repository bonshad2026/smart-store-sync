import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import { config } from '../config';
import type { Product } from './products';

export type MediaType = 'image' | 'video' | 'audio';

export interface MediaItem {
  type: MediaType;
  url: string;   // /uploads/xxx (local) or https://...
  name?: string;
  mime?: string;
  size?: number;
}

export interface LinkItem {
  title: string;
  url: string;
  /** 'reply' = interactive Telegram button that answers the user instead of opening a URL */
  kind?: 'link' | 'reply' | 'interaction';
  /** for kind 'interaction': the reusable interaction attached to the post */
  interaction_id?: number;
  /** resolved Telegram callback data (set at send time, never stored) */
  callback?: string;
  /** short stable id of an interactive button (used in Telegram callback data) */
  id?: string;
  /** answer shown to the user who taps an interactive button */
  reply?: string;
  /** popup = alert inside Telegram (≤200 chars); chat = the bot answers in a private chat */
  mode?: 'popup' | 'chat';
}

/** Link buttons that open a URL (interactive reply buttons are Telegram-only) */
export const urlLinks = (links: LinkItem[] = []) => links.filter((l) => l.kind !== 'reply' && l.kind !== 'interaction' && l.url);

export const mediaSchema = z.array(
  z.object({
    type: z.enum(['image', 'video', 'audio']),
    url: z.string().min(1),
    name: z.string().optional(),
    mime: z.string().optional(),
    size: z.number().optional(),
  }),
).max(10, 'حداکثر ۱۰ فایل برای هر محتوا');

export const linksSchema = z.array(
  z.union([
    z.object({
      kind: z.literal('reply'),
      id: z.string().trim().regex(/^[a-z0-9]{1,12}$/i).optional(),
      title: z.string().trim().min(1, 'عنوان دکمه الزامی است').max(60),
      url: z.string().optional().default(''),
      reply: z.string().trim().min(1, 'پاسخ دکمه تعاملی را بنویسید').max(3000),
      mode: z.enum(['popup', 'chat']).default('popup'),
    }).refine((b) => b.mode !== 'popup' || b.reply.length <= 200, 'پاسخ پنجره‌ای تلگرام حداکثر ۲۰۰ کاراکتر است؛ حالت «پیام خصوصی» را انتخاب کنید'),
    z.object({
      kind: z.literal('interaction'),
      interaction_id: z.number().int().positive(),
      title: z.string().trim().max(80).default(''),
      url: z.string().optional().default(''),
    }),
    z.object({
      kind: z.literal('link').optional(),
      title: z.string().trim().min(1, 'عنوان لینک الزامی است'),
      url: z.string().trim().regex(/^(https?:\/\/|tg:\/\/)/, 'لینک باید با http:// یا https:// شروع شود'),
    }),
  ]),
).max(8, 'حداکثر ۸ دکمه')
  .transform((items) => items.map((b) => (b.kind === 'reply' && !b.id ? { ...b, id: Math.random().toString(36).slice(2, 8) } : b)));

export const PRODUCT_MEDIA_MODES = ['none', 'main', 'all'] as const;
export type ProductMediaMode = (typeof PRODUCT_MEDIA_MODES)[number];
export const productMediaSchema = z.enum(PRODUCT_MEDIA_MODES);

/** Guesses the media type of a gallery URL from its extension (product galleries store plain URLs) */
export function mediaTypeOfUrl(url: string): MediaType {
  const clean = url.split('?')[0].toLowerCase();
  if (/^data:video\//.test(url) || /\.(mp4|webm|mov|m4v|ogv|mkv)$/.test(clean)) return 'video';
  if (/^data:audio\//.test(url) || /\.(mp3|wav|ogg|m4a|aac|oga)$/.test(clean)) return 'audio';
  return 'image';
}

export function mediaTypeOf(mime: string): MediaType | null {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return null;
}

/** A media item resolved for sending: either a local file or a public URL */
export interface ResolvedMedia {
  type: MediaType;
  filePath?: string;
  url?: string;
  name: string;
  publicUrl: string; // absolute URL (for webhooks / e-mails)
}

export function resolveMedia(m: MediaItem): ResolvedMedia {
  if (m.url.startsWith('/uploads/')) {
    const file = path.join(config.uploadDir, path.basename(m.url));
    return { type: m.type, filePath: file, name: m.name || path.basename(file), publicUrl: `${config.publicUrl}${m.url}` };
  }
  const data = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/.exec(m.url);
  if (data) {
    const name = `inline-${crypto.createHash('sha1').update(data[2]).digest('hex').slice(0, 16)}.${data[1] === 'jpeg' ? 'jpg' : data[1]}`;
    const file = path.join(config.uploadDir, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, Buffer.from(data[2], 'base64'));
    return { type: m.type, filePath: file, name, publicUrl: `${config.publicUrl}/uploads/${name}` };
  }
  return { type: m.type, url: m.url, name: m.name || path.basename(m.url.split('?')[0]) || 'file', publicUrl: m.url };
}

/** Product gallery items as media (photos and videos) */
export function productGallery(product: Product | null | undefined): MediaItem[] {
  const urls = product?.images?.length ? product.images : product?.image_url ? [product.image_url] : [];
  return urls.map((url, i) => ({ type: mediaTypeOfUrl(url), url, name: `product-${i + 1}` }));
}

/**
 * All media to send for a content item:
 *  product media (none / main item / whole gallery) + attached files, max 10 items, without duplicates.
 */
export function contentMedia(media: MediaItem[] | null | undefined, product: Product | null | undefined, mode: ProductMediaMode | boolean = 'main') {
  const m: ProductMediaMode = mode === true ? 'main' : mode === false ? 'none' : mode;
  const gallery = productGallery(product);
  const fromProduct = m === 'all' ? gallery : m === 'main' ? gallery.slice(0, 1) : [];
  const seen = new Set<string>();
  const out: MediaItem[] = [];
  for (const item of [...fromProduct, ...(media || [])]) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out
    .slice(0, 10)
    .map(resolveMedia)
    .filter((x) => !x.filePath || fs.existsSync(x.filePath));
}
