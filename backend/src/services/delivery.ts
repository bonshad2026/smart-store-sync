import { sendEmail, splitList } from './email';
import { contentMedia, LinkItem, MediaItem, ProductMediaMode, ResolvedMedia, urlLinks } from './media';
import type { Destination } from './platforms';
import type { Product } from './products';
import { resolveInteractionLinks } from './interactions';
import { sendTelegramPost } from './telegram';
import { runAsBot } from './telegramBots';
import { recordPanelPost } from './telegramChannels';
import { query } from '../db/pool';

export interface DeliveryInput {
  destination: Destination; // raw (unmasked) destination incl. delivery type
  title: string;
  body: string;
  product?: Product | null;
  media?: MediaItem[];
  links?: LinkItem[];
  productMedia?: ProductMediaMode | boolean;
  /** content id, used to link Telegram button clicks back to the content */
  contentId?: number;
}

export interface DeliveryResult {
  status: 'sent' | 'manual';
  external_id?: string;
  message: string;
}

const stripTags = (s: string) => s.replace(/<\/?(b|i|s|u|code)>/g, '');

/**
 * Generic webhook delivery - works with any SMS panel or API.
 * URL / body may contain placeholders: {text} {title} {to} {product_name} {image_url} {media_url} {links}
 *  - in the URL values are URL-encoded, in the body they are JSON-escaped.
 * If no body template is given, a standard JSON payload (incl. all media and links) is sent.
 */
async function sendWebhook(d: Destination, title: string, body: string, product: Product | null | undefined, media: ResolvedMedia[], links: LinkItem[]) {
  const c = d.config;
  const text = stripTags(body);
  const recipients = splitList(c.recipients || '');
  const firstImage = media.find((m) => m.type === 'image');
  const values: Record<string, string> = {
    text,
    title,
    to: recipients.join(','),
    product_name: product?.name || '',
    image_url: firstImage?.publicUrl || '',
    media_url: media[0]?.publicUrl || '',
    links: links.map((l) => `${l.title}: ${l.url}`).join('\n'),
  };
  const fill = (tpl: string, enc: (v: string) => string) =>
    tpl.replace(/\{(text|title|to|product_name|image_url|media_url|links)\}/g, (_m, k) => enc(values[k] ?? ''));

  const method = String(c.method || 'POST').toUpperCase();
  const url = fill(String(c.url), encodeURIComponent);
  const headers: Record<string, string> = {};
  if (c.auth_header) headers['Authorization'] = String(c.auth_header);
  if (c.headers) {
    try {
      Object.assign(headers, typeof c.headers === 'string' ? JSON.parse(c.headers) : c.headers);
    } catch {
      throw new Error('هدرهای وب‌هوک باید JSON معتبر باشند');
    }
  }
  let payload: string | undefined;
  if (method !== 'GET') {
    payload = c.body_template
      ? fill(String(c.body_template), (v) => JSON.stringify(v).slice(1, -1))
      : JSON.stringify({
          platform: d.platform_key,
          destination: d.name,
          title,
          text,
          recipients,
          media: media.map((m) => ({ type: m.type, url: m.publicUrl, name: m.name })),
          links,
          product: product
            ? { id: product.id, sku: product.sku, name: product.name, price: Number(product.price), image_url: firstImage?.publicUrl || '' }
            : null,
        });
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }
  const res = await fetch(url, { method, headers, body: payload, signal: AbortSignal.timeout(30000) }).catch((e) => {
    throw new Error(`اتصال به وب‌هوک برقرار نشد (${(e as any).cause?.code || e.message})`);
  });
  const resText = await res.text().catch(() => '');
  if (!res.ok) throw new Error(`وب‌هوک خطا برگرداند: ${res.status} ${resText.slice(0, 200)}`);
  return resText.slice(0, 200);
}

/** Sends one piece of content (text + media + links) to one destination using the platform's delivery method */
export async function deliver(input: DeliveryInput): Promise<DeliveryResult> {
  const { destination: d, title, body, product } = input;
  if (!d.enabled) throw new Error(`مقصد «${d.name}» غیرفعال است`);
  const media = contentMedia(input.media, product, input.productMedia ?? 'main');
  const raw = input.links || [];
  const links = await resolveInteractionLinks(raw, input.contentId, d.delivery === 'telegram');
  switch (d.delivery) {
    case 'telegram': {
      // a connected channel is published to through the store bot that was added to it
      const chatId = String(d.config.chat_id || '');
      const [ch] = d.config.tg_channel ? await query<{ bot_id: number | null }>(`SELECT bot_id FROM telegram_channels WHERE chat_id=$1`, [chatId]) : [];
      const r = await runAsBot(ch?.bot_id, async () => {
        const sent = await sendTelegramPost({ chatId, text: body, media, links, contentId: input.contentId });
        await recordPanelPost(sent.chat_id, sent.message_ids, input.contentId, body).catch((e) => console.error('telegram post record:', e.message));
        return sent;
      });
      const extra = r.message_ids.length > 1 ? ` (${r.message_ids.length.toLocaleString('fa-IR')} پیام)` : '';
      return { status: 'sent', external_id: String(r.message_id ?? ''), message: `ارسال شد به ${r.chat_id}${extra}` };
    }
    case 'email': {
      const r = await sendEmail(d.config as any, title, body, media, urlLinks(links));
      return { status: 'sent', external_id: r.message_id, message: `ایمیل برای ${r.recipients.toLocaleString('fa-IR')} گیرنده ارسال شد` };
    }
    case 'webhook': {
      const r = await sendWebhook(d, title, body, product, media, urlLinks(links));
      return { status: 'sent', message: `وب‌هوک: ${r || 'OK'}` };
    }
    case 'manual':
    default:
      return { status: 'manual', message: 'آماده انتشار دستی (متن و فایل‌ها را دانلود و منتشر کنید)' };
  }
}
