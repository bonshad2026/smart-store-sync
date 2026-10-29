import { AsyncLocalStorage } from 'async_hooks';
import fs from 'fs';
import path from 'path';
import { fetch as undiciFetch, FormData, ProxyAgent } from 'undici';
import { config } from '../config';
import type { LinkItem, ResolvedMedia } from './media';

// Optional proxy for reaching Telegram (e.g. when Telegram is filtered).
// Example: TELEGRAM_PROXY=http://host.docker.internal:10809
const proxyAgent = config.telegram.proxy ? new ProxyAgent(config.telegram.proxy) : undefined;

const CAPTION_LIMIT = 1024;

/** Escapes text for Telegram HTML mode while keeping simple formatting tags (<b>, <i>, <s>, <u>, <code>) */
export function telegramSafeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/&lt;(\/?)(b|i|s|u|code)&gt;/g, '<$1$2>');
}

interface Sent { message_id: number }

/**
 * Which bot a Telegram call goes through. Outside withBot() it is the platform's main bot (TELEGRAM_BOT_TOKEN);
 * inside, a store's own (managed) bot. Update handlers run inside the context of the bot that received the update,
 * so replies, buttons and deep links automatically use that bot.
 */
export interface BotContext { token: string; botId?: number }
const botContext = new AsyncLocalStorage<BotContext>();
export const withBot = <T>(bot: BotContext, fn: () => Promise<T>) => botContext.run(bot, fn);
/** Runs fn with the platform's main bot, even inside a store bot's context */
export const asMainBot = <T>(fn: () => Promise<T>) => botContext.run({ token: config.telegram.botToken }, fn);
/** telegram_bots.id of the current store bot; undefined for the main bot */
export const currentBotId = () => botContext.getStore()?.botId;
export const currentToken = () => botContext.getStore()?.token || config.telegram.botToken;

/**
 * Calls a Bot API method. Plain values are sent as form fields; local files are
 * uploaded as multipart attachments (referenced as attach://name when needed).
 */
export async function call(method: string, fields: Record<string, unknown>, files: Record<string, string> = {}) {
  const token = currentToken();
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN در فایل .env تنظیم نشده است');
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
  }
  for (const [k, file] of Object.entries(files)) {
    form.append(k, new Blob([fs.readFileSync(file)]), path.basename(file));
  }
  let res;
  try {
    res = await undiciFetch(`${config.telegram.apiBase}/bot${token}/${method}`, {
      method: 'POST',
      // Telegram rejects an empty multipart body (e.g. getMe), so send none
      body: [...form.keys()].length ? form : undefined,
      dispatcher: proxyAgent,
      signal: AbortSignal.timeout(Object.keys(files).length ? 180000 : 30000),
    });
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } };
    const detail = e.cause?.code || e.cause?.message || e.message;
    throw new Error(
      `اتصال به سرور تلگرام برقرار نشد (${detail}). ` +
        (proxyAgent
          ? `پروکسی ${config.telegram.proxy} را بررسی کنید.`
          : 'اگر تلگرام فیلتر است، رله تلگرام (start-telegram-relay.bat) را اجرا کنید یا TELEGRAM_PROXY را تنظیم کنید.'),
    );
  }
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: Sent | Sent[] };
  if (!res.ok || !data.ok) {
    const d = data.description || String(res.status);
    if (/too large|Request Entity/i.test(d)) throw new Error('خطای تلگرام: حجم فایل بیش از حد مجاز ربات (۵۰ مگابایت) است');
    throw new Error(`خطای تلگرام: ${d}`);
  }
  return data.result!;
}

const METHOD = { image: ['sendPhoto', 'photo'], video: ['sendVideo', 'video'], audio: ['sendAudio', 'audio'] } as const;

/** Returns the value for a media field + the file to upload (if local) */
function mediaRef(m: ResolvedMedia, key: string): { value: string; files: Record<string, string> } {
  if (m.filePath) return { value: `attach://${key}`, files: { [key]: m.filePath } };
  return { value: m.url!, files: {} };
}

const botInfo = new Map<string, { id: number; username: string }>();
/** id and @username of the current bot (cached per token) */
export async function getBotInfo(): Promise<{ id: number; username: string }> {
  const token = currentToken();
  const cached = botInfo.get(token);
  if (cached) return cached;
  const me = (await call('getMe', {})) as unknown as { id: number; username: string };
  botInfo.set(token, { id: me.id, username: me.username });
  return botInfo.get(token)!;
}

/** @username of the bot — needed for "answer in private chat" buttons */
export const getBotUsername = async () => (await getBotInfo()).username;

/**
 * Inline keyboard, two buttons per row:
 *  - link buttons open their URL
 *  - interactive "popup" buttons send a callback (answered with an alert, see feedback.ts)
 *  - interactive "chat" buttons open the bot with a start payload; the bot answers privately
 */
async function keyboard(links: LinkItem[], contentId = 0) {
  if (!links.length) return undefined;
  const rows: Record<string, string>[][] = [];
  for (const [i, l] of links.entries()) {
    if (i % 2 === 0) rows.push([]);
    let btn: Record<string, string>;
    if (l.kind === 'reply' && l.mode === 'chat') btn = { text: l.title, url: `https://t.me/${await getBotUsername()}?start=c${contentId}_${l.id}` };
    else if (l.kind === 'reply') btn = { text: l.title, callback_data: `fb:${contentId}:${l.id}` };
    else if (l.callback) btn = { text: l.title, callback_data: l.callback };
    else btn = { text: l.title, url: l.url };
    rows[rows.length - 1].push(btn);
  }
  return { inline_keyboard: rows };
}

/**
 * Sends a full post to a chat/channel:
 *  - text only                 -> sendMessage (+ link buttons)
 *  - one photo / video / audio -> sendPhoto|Video|Audio with the text as caption (+ buttons)
 *  - several photos / videos   -> album (sendMediaGroup), then the text with the buttons
 *  - remaining audio files     -> sent as audio messages
 * Captions longer than Telegram's limit are sent as a separate message.
 */
export async function sendTelegramPost(opts: { chatId: string; text: string; media?: ResolvedMedia[]; links?: LinkItem[]; contentId?: number }) {
  const { chatId } = opts;
  if (!chatId) throw new Error('شناسه کانال تلگرام برای این مقصد تعریف نشده است');
  const html = telegramSafeHtml(opts.text || '').trim();
  const media = opts.media || [];
  const markup = await keyboard(opts.links || [], opts.contentId);
  const visual = media.filter((m) => m.type === 'image' || m.type === 'video');
  const audio = media.filter((m) => m.type === 'audio');
  const ids: number[] = [];
  const base = { chat_id: chatId, parse_mode: 'HTML' };
  let textSent = false;

  if (visual.length === 1 || (visual.length === 0 && audio.length >= 1)) {
    const m = visual.length ? visual[0] : audio.shift()!;
    const [method, field] = METHOD[m.type];
    const ref = mediaRef(m, 'file0');
    const fits = html.length <= CAPTION_LIMIT;
    const r = (await call(
      method,
      { ...base, [field]: ref.value, caption: fits && html ? html : undefined, reply_markup: fits ? markup : undefined },
      ref.files,
    )) as Sent;
    ids.push(r.message_id);
    textSent = fits;
  } else if (visual.length > 1) {
    const files: Record<string, string> = {};
    const fits = html.length <= CAPTION_LIMIT && !markup; // albums cannot carry buttons
    const group = visual.slice(0, 10).map((m, i) => {
      const ref = mediaRef(m, `file${i}`);
      Object.assign(files, ref.files);
      return {
        type: m.type === 'image' ? 'photo' : 'video',
        media: ref.value,
        ...(i === 0 && fits && html ? { caption: html, parse_mode: 'HTML' } : {}),
      };
    });
    const r = (await call('sendMediaGroup', { chat_id: chatId, media: group }, files)) as Sent[];
    ids.push(...r.map((x) => x.message_id));
    textSent = fits;
  }

  if (!textSent && (html || markup)) {
    const r = (await call('sendMessage', { ...base, text: html || '🔗', reply_markup: markup, disable_web_page_preview: true })) as Sent;
    ids.push(r.message_id);
  }

  for (const [i, m] of audio.entries()) {
    const ref = mediaRef(m, `audio${i}`);
    const r = (await call('sendAudio', { chat_id: chatId, audio: ref.value, title: m.name }, ref.files)) as Sent;
    ids.push(r.message_id);
  }
  return { message_id: ids[0], message_ids: ids, chat_id: chatId };
}

/** Backwards-compatible helper: text + optional single image */
export async function sendTelegramMessage(text: string, chatId: string, image?: { url?: string; filePath?: string }) {
  const media: ResolvedMedia[] = [];
  if (image?.filePath && fs.existsSync(image.filePath)) media.push({ type: 'image', filePath: image.filePath, name: 'image', publicUrl: '' });
  else if (image?.url && /^https?:\/\//.test(image.url)) media.push({ type: 'image', url: image.url, name: 'image', publicUrl: image.url });
  return sendTelegramPost({ chatId, text, media });
}
