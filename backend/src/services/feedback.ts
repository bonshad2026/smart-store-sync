import { config } from '../config';
import { query } from '../db/pool';
import type { LinkItem } from './media';
import { getSetting, saveSettings } from './settings';
import { handleInteractionUpdate } from './interactions';
import { call, currentBotId } from './telegram';
import { runAsBot } from './telegramBots';
import { ChannelUpdate, handleChannelUpdate } from './telegramChannels';

/**
 * User feedback from Telegram:
 *  - taps on interactive "popup" buttons (callback_query)  -> alert with the button's answer
 *  - taps on interactive "chat" buttons (/start c<id>_<btn>) -> the bot answers in a private chat
 *  - any other private message to the bot                   -> stored for a reply from the panel
 * Updates are fetched with long polling (getUpdates, see telegramPolling.ts), so no public HTTPS address is needed.
 * Every event is also forwarded to n8n (setting `n8n_feedback_webhook`) for custom automations.
 */

export interface Feedback {
  id: number;
  kind: 'click' | 'start' | 'message';
  content_id: number | null;
  button_id: string | null;
  button_title: string;
  tg_user_id: string | null;
  tg_username: string;
  tg_name: string;
  chat_id: string | null;
  text: string;
  auto_reply: string;
  reply: string;
  status: 'new' | 'seen' | 'replied';
  replied_at: string | null;
  bot_id: number | null;
  created_at: string;
}

interface TgUser { id: number; first_name?: string; last_name?: string; username?: string }
interface TgMessage { message_id: number; from?: TgUser; chat: { id: number; type: string }; text?: string; caption?: string; contact?: { phone_number: string } }
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage };
}

const nameOf = (u?: TgUser) => [u?.first_name, u?.last_name].filter(Boolean).join(' ').slice(0, 200);

async function findButton(contentId: number, buttonId: string) {
  if (!contentId) return null;
  const [c] = await query<{ links: LinkItem[] }>(`SELECT links FROM contents WHERE id=$1`, [contentId]);
  return c?.links?.find((l) => l.kind === 'reply' && l.id === buttonId) || null;
}

async function record(f: Partial<Feedback> & { kind: Feedback['kind'] }) {
  const [row] = await query<Feedback>(
    `INSERT INTO feedback (kind, content_id, button_id, button_title, tg_user_id, tg_username, tg_name, chat_id, text, auto_reply, status, bot_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [f.kind, f.content_id ?? null, f.button_id ?? null, f.button_title ?? '', f.tg_user_id ?? null, f.tg_username ?? '',
      f.tg_name ?? '', f.chat_id ?? null, f.text ?? '', f.auto_reply ?? '', f.auto_reply && f.kind !== 'message' ? 'seen' : 'new', currentBotId() ?? null],
  );
  forwardToN8n(row).catch(() => undefined);
  return row;
}

async function forwardToN8n(f: Feedback) {
  const url = (await getSetting('n8n_feedback_webhook')).trim();
  if (!url) return;
  const product = f.content_id
    ? (await query(`SELECT p.id, p.name, p.sku FROM contents c JOIN products p ON p.id=c.product_id WHERE c.id=$1`, [f.content_id]))[0]
    : null;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'feedback', feedback: f, product, reply_api: `${config.publicUrl}/api/feedback/${f.id}/reply` }),
    signal: AbortSignal.timeout(10000),
  }).catch((e) => console.error('n8n feedback webhook:', (e as Error).message));
}

/** Handles one update of the main bot or of a store bot (called inside that bot's context) */
export async function handleUpdate(u: TgUpdate) {
  // connected channels: connect flow, bot membership, posts, reactions, subscribers
  if (await handleChannelUpdate(u as ChannelUpdate)) return;
  // reusable interactions (popup taps, conversations) take precedence
  if (await handleInteractionUpdate(u)) return;
  // 1) tap on an interactive popup button
  if (u.callback_query) {
    const cq = u.callback_query;
    const m = /^fb:(\d+):([a-z0-9]+)$/i.exec(cq.data || '');
    if (!m) return call('answerCallbackQuery', { callback_query_id: cq.id }).catch(() => undefined);
    const btn = await findButton(Number(m[1]), m[2]);
    const answer = (btn?.reply || 'ممنون از توجه شما 🙏').slice(0, 200);
    await call('answerCallbackQuery', { callback_query_id: cq.id, text: answer, show_alert: true }).catch((e) => console.error(e.message));
    await record({
      kind: 'click', content_id: Number(m[1]) || null, button_id: m[2], button_title: btn?.title || '',
      tg_user_id: String(cq.from.id), tg_username: cq.from.username || '', tg_name: nameOf(cq.from), auto_reply: answer,
    });
    return;
  }

  const msg = u.message;
  if (!msg || msg.chat.type !== 'private') return; // only private chats with the bot
  const text = (msg.text || msg.caption || '').trim();
  const who = { tg_user_id: String(msg.from?.id ?? msg.chat.id), tg_username: msg.from?.username || '', tg_name: nameOf(msg.from), chat_id: String(msg.chat.id) };

  // 2) "answer in private chat" button: /start c<contentId>_<buttonId>
  const s = /^\/start\s+c(\d+)_([a-z0-9]+)$/i.exec(text);
  if (s) {
    const btn = await findButton(Number(s[1]), s[2]);
    const answer = btn?.reply || (await getSetting('bot_welcome'));
    await call('sendMessage', { chat_id: msg.chat.id, text: answer, disable_web_page_preview: true }).catch((e) => console.error(e.message));
    await record({ kind: 'start', content_id: Number(s[1]) || null, button_id: s[2], button_title: btn?.title || '', ...who, auto_reply: answer });
    return;
  }

  // 3) any other private message (incl. plain /start)
  const welcome = await getSetting('bot_welcome');
  const isStart = /^\/start\b/.test(text);
  if (welcome && isStart) await call('sendMessage', { chat_id: msg.chat.id, text: welcome }).catch(() => undefined);
  await record({ kind: 'message', ...who, text: text || '(پیام غیرمتنی)', auto_reply: isStart ? welcome : '' });
}

// ------------------------------------------------------------------ panel API

export async function listFeedback(filter: { status?: string; kind?: string; limit?: number } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.status) { params.push(filter.status); where.push(`f.status = $${params.length}`); }
  if (filter.kind) { params.push(filter.kind); where.push(`f.kind = $${params.length}`); }
  params.push(Math.min(filter.limit || 200, 500));
  return query(
    `SELECT f.*, c.kind AS content_kind, p.id AS product_id, p.name AS product_name, p.image_url AS product_image
       FROM feedback f
       LEFT JOIN contents c ON c.id = f.content_id
       LEFT JOIN products p ON p.id = c.product_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY f.created_at DESC LIMIT $${params.length}`,
    params,
  );
}

export async function feedbackStats() {
  const [totals] = await query(`
    SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE kind IN ('click','start'))::int AS clicks,
      COUNT(*) FILTER (WHERE kind = 'message')::int AS messages,
      COUNT(*) FILTER (WHERE status = 'new')::int AS unread,
      COUNT(DISTINCT tg_user_id)::int AS users
    FROM feedback`);
  const buttons = await query(`
    SELECT f.button_title, f.content_id, p.name AS product_name, COUNT(*)::int AS clicks, MAX(f.created_at) AS last_at
      FROM feedback f LEFT JOIN contents c ON c.id = f.content_id LEFT JOIN products p ON p.id = c.product_id
     WHERE f.kind IN ('click','start')
     GROUP BY f.button_title, f.content_id, p.name ORDER BY clicks DESC LIMIT 10`);
  return { ...totals, buttons };
}

export async function markSeen(ids: number[]) {
  await query(`UPDATE feedback SET status='seen' WHERE id = ANY($1::int[]) AND status='new'`, [ids]);
}

/** Answers a user from the panel (or from n8n). Needs a private chat: the user must have started the bot. */
export async function replyToFeedback(id: number, text: string) {
  const [f] = await query<Feedback>(`SELECT * FROM feedback WHERE id=$1`, [id]);
  if (!f) throw new Error('بازخورد یافت نشد');
  const chat = f.chat_id || f.tg_user_id;
  if (!chat) throw new Error('شناسه کاربر برای پاسخ موجود نیست');
  try {
    await runAsBot(f.bot_id, () => call('sendMessage', { chat_id: chat, text }));
  } catch (e) {
    const m = (e as Error).message;
    if (/403|blocked|initiate|chat not found/i.test(m)) {
      throw new Error('تلگرام اجازه پیام مستقیم نمی‌دهد؛ این کاربر هنوز ربات را Start نکرده است. از دکمه‌های «پاسخ در پیام خصوصی» استفاده کنید.');
    }
    throw e;
  }
  const [row] = await query<Feedback>(
    `UPDATE feedback SET reply=$2, status='replied', replied_at=NOW() WHERE id=$1 RETURNING *`,
    [id, text],
  );
  return row;
}
