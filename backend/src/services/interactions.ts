import { z } from 'zod';
import { config } from '../config';
import { query } from '../db/pool';
import type { LinkItem } from './media';
import { getSetting } from './settings';
import { asMainBot, call, currentBotId, getBotUsername } from './telegram';
import { runAsBot } from './telegramBots';

/**
 * Reusable automatic interactions ("ثبت نظر", "درخواست محصول", "پرداخت", ...).
 * An interaction is attached to a post as a button. It either:
 *  - popup: answers instantly with an alert inside Telegram, or
 *  - flow:  opens a private chat with the bot that walks the user through steps
 *           (message → question → multiple choice → phone number → payment link ...),
 *           stores the answers and finishes with a final message.
 * Flow buttons are plain t.me deep links, so they also work in e-mails, websites and other networks.
 */

// ------------------------------------------------------------------ types & validation

export const STEP_TYPES = ['message', 'text', 'choice', 'contact', 'payment'] as const;

export const stepSchema = z.object({
  type: z.enum(STEP_TYPES),
  text: z.string().trim().min(1, 'متن هر مرحله الزامی است').max(1500),
  key: z.string().trim().max(40).optional().default(''),
  options: z.array(z.string().trim().min(1).max(40)).max(10).optional().default([]),
  button: z.string().trim().max(40).optional().default(''),
  url: z.string().trim().max(500).optional().default(''),
}).refine((s) => s.type !== 'choice' || s.options.length >= 2, 'مرحله گزینه‌ای حداقل ۲ گزینه لازم دارد')
  .refine((s) => s.type !== 'payment' || /^https?:\/\//.test(s.url) || s.url === '{payment_link}', 'لینک پرداخت باید با https:// شروع شود');

export type Step = z.infer<typeof stepSchema>;

export const interactionSchema = z.object({
  title: z.string().trim().min(1, 'عنوان تعامل الزامی است').max(60),
  emoji: z.string().trim().max(16).default(''),
  description: z.string().trim().max(300).default(''),
  mode: z.enum(['flow', 'popup']).default('flow'),
  popup_text: z.string().trim().max(200, 'پاسخ پنجره‌ای حداکثر ۲۰۰ کاراکتر است').default(''),
  steps: z.array(stepSchema).max(12).default([]),
  final_message: z.string().trim().max(1500).default(''),
  notify_admin: z.boolean().default(false),
  enabled: z.boolean().default(true),
  sort_order: z.number().int().default(100),
}).refine((i) => i.mode !== 'popup' || i.popup_text.length > 0, 'متن پاسخ پنجره‌ای را بنویسید')
  .refine((i) => i.mode !== 'flow' || i.steps.length > 0 || i.final_message.length > 0, 'برای روال گفتگو حداقل یک مرحله یا پیام پایانی تعریف کنید');

export interface Interaction extends z.infer<typeof interactionSchema> { id: number; created_at: string }

interface Session {
  id: number; interaction_id: number; content_id: number | null; chat_id: string; tg_user_id: string;
  tg_username: string; tg_name: string; bot_id: number | null; step: number; answers: { key: string; question: string; answer: string }[]; status: string;
}

export interface TgUser { id: number; first_name?: string; last_name?: string; username?: string }
export interface TgMessage {
  message_id: number; from?: TgUser; chat: { id: number; type: string }; text?: string; caption?: string;
  contact?: { phone_number: string };
}

// ------------------------------------------------------------------ CRUD

export async function listInteractions(onlyEnabled = false) {
  return query<Interaction & { taps: number; started: number; completed: number }>(`
    SELECT i.*,
      (SELECT COUNT(*) FROM feedback f WHERE f.interaction_id = i.id)::int AS taps,
      (SELECT COUNT(*) FROM interaction_sessions s WHERE s.interaction_id = i.id)::int AS started,
      (SELECT COUNT(*) FROM interaction_sessions s WHERE s.interaction_id = i.id AND s.status = 'completed')::int AS completed
    FROM interactions i ${onlyEnabled ? 'WHERE i.enabled' : ''}
    ORDER BY i.sort_order, i.id`);
}

export async function getInteraction(id: number) {
  return (await query<Interaction>(`SELECT * FROM interactions WHERE id=$1`, [id]))[0];
}

export async function createInteraction(input: z.infer<typeof interactionSchema>) {
  const [row] = await query<Interaction>(
    `INSERT INTO interactions (title, emoji, description, mode, popup_text, steps, final_message, notify_admin, enabled, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [input.title, input.emoji, input.description, input.mode, input.popup_text, JSON.stringify(input.steps), input.final_message,
      input.notify_admin, input.enabled, input.sort_order],
  );
  return row;
}

export async function updateInteraction(id: number, input: z.infer<typeof interactionSchema>) {
  const [row] = await query<Interaction>(
    `UPDATE interactions SET title=$2, emoji=$3, description=$4, mode=$5, popup_text=$6, steps=$7, final_message=$8,
       notify_admin=$9, enabled=$10, sort_order=$11 WHERE id=$1 RETURNING *`,
    [id, input.title, input.emoji, input.description, input.mode, input.popup_text, JSON.stringify(input.steps), input.final_message,
      input.notify_admin, input.enabled, input.sort_order],
  );
  return row;
}

export async function setInteractionEnabled(id: number, enabled: boolean) {
  await query(`UPDATE interactions SET enabled=$2 WHERE id=$1`, [id, enabled]);
}

export async function deleteInteraction(id: number) {
  await query(`DELETE FROM interactions WHERE id=$1`, [id]);
}

/** Ready-made interactions, created once */
export async function seedInteractions() {
  const [{ n }] = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM interactions`);
  if (n > 0 || (await getSetting('interactions_seeded')) === 'true') return;
  const defs: z.input<typeof interactionSchema>[] = [
    {
      title: 'ثبت نظر', emoji: '⭐', description: 'امتیاز و نظر مشتری درباره محصول',
      steps: [
        { type: 'choice', text: 'به «{product_name}» چه امتیازی می‌دهید؟', key: 'امتیاز', options: ['⭐ ۱', '⭐⭐ ۲', '⭐⭐⭐ ۳', '⭐⭐⭐⭐ ۴', '⭐⭐⭐⭐⭐ ۵'] },
        { type: 'text', text: 'لطفاً نظرتان را در یک پیام کوتاه بنویسید:', key: 'نظر' },
      ],
      final_message: 'ممنون از نظر ارزشمند شما {name} 🌷',
    },
    {
      title: 'درخواست محصول', emoji: '🛒', description: 'ثبت سفارش یا درخواست خرید با شماره تماس', notify_admin: true,
      steps: [
        { type: 'choice', text: 'چند عدد از «{product_name}» نیاز دارید؟', key: 'تعداد', options: ['۱', '۲', '۳', 'بیشتر'] },
        { type: 'contact', text: 'برای هماهنگی، شماره تماس خود را بفرستید (دکمه پایین یا تایپ کنید):', key: 'شماره تماس' },
        { type: 'text', text: 'شهر و آدرس تحویل را بنویسید:', key: 'آدرس' },
      ],
      final_message: '✅ درخواست شما ثبت شد. همکاران ما به‌زودی برای نهایی کردن سفارش تماس می‌گیرند.',
    },
    {
      title: 'پرداخت آنلاین', emoji: '💳', description: 'ارسال لینک پرداخت امن برای محصول',
      steps: [
        { type: 'payment', text: 'مبلغ قابل پرداخت برای «{product_name}»: {price}\nبرای پرداخت امن روی دکمه زیر بزنید 👇', button: '💳 پرداخت', url: '{payment_link}' },
      ],
      final_message: 'پس از پرداخت، رسید را همین‌جا بفرستید تا سفارش شما ارسال شود 🙏',
    },
    {
      title: 'پرسش درباره محصول', emoji: '❓', description: 'سؤال مشتری برای پاسخ کارشناس', notify_admin: true,
      steps: [{ type: 'text', text: 'سؤال خود درباره «{product_name}» را بنویسید:', key: 'سؤال' }],
      final_message: 'سؤال شما ثبت شد؛ کارشناسان ما به‌زودی پاسخ می‌دهند.',
    },
    {
      title: 'خبرم کن', emoji: '🔔', description: 'اطلاع‌رسانی موجود شدن یا تخفیف بعدی', mode: 'popup',
      popup_text: '🔔 ثبت شد! به محض موجود شدن یا تخفیف بعدی همین محصول، در کانال خبرتان می‌کنیم.',
    },
  ];
  for (const [i, d] of defs.entries()) await createInteraction(interactionSchema.parse({ ...d, sort_order: i + 1 }));
  await query(`INSERT INTO settings (key, value) VALUES ('interactions_seeded','true') ON CONFLICT (key) DO UPDATE SET value='true'`);
  console.log('✔ Default interactions added');
}

// ------------------------------------------------------------------ buttons in posts

/**
 * Turns `{kind:'interaction'}` link items into real buttons for a channel:
 *  - Telegram: popup → callback button, flow → deep link to the bot
 *  - other networks: flow → deep link URL (popup interactions need Telegram and are skipped)
 */
export async function resolveInteractionLinks(links: LinkItem[] = [], contentId = 0, telegram = true): Promise<LinkItem[]> {
  if (!links.some((l) => l.kind === 'interaction')) return links;
  const out: LinkItem[] = [];
  for (const l of links) {
    if (l.kind !== 'interaction') { out.push(l); continue; }
    const it = l.interaction_id ? await getInteraction(l.interaction_id) : undefined;
    if (!it || !it.enabled) continue;
    const title = `${it.emoji ? `${it.emoji} ` : ''}${it.title}`;
    if (it.mode === 'popup') {
      if (telegram) out.push({ title, url: '', kind: 'link', callback: `ia:${it.id}:${contentId}` });
    } else {
      out.push({ title, url: `https://t.me/${await getBotUsername()}?start=i${it.id}_c${contentId}`, kind: 'link' });
    }
  }
  return out;
}

// ------------------------------------------------------------------ conversation engine

const nameOf = (u?: TgUser) => [u?.first_name, u?.last_name].filter(Boolean).join(' ').slice(0, 200);
const fmt = (n: unknown) => Number(n || 0).toLocaleString('fa-IR');

async function placeholders(s: Session | null, contentId: number | null) {
  const [p] = contentId
    ? await query<{ name: string; sku: string; price: string; discount_price: string | null }>(
      `SELECT p.name, p.sku, p.price, p.discount_price FROM contents c JOIN products p ON p.id = c.product_id WHERE c.id=$1`, [contentId])
    : [];
  const price = p ? Number(p.discount_price || p.price) : 0;
  const payment = await getSetting('payment_link');
  const values: Record<string, string> = {
    product_name: p?.name || 'محصول',
    sku: p?.sku || '',
    price: p ? `${fmt(price)} تومان` : '',
    amount: String(price || ''),
    name: s?.tg_name || '',
    session: String(s?.id || ''),
    store_name: await getSetting('store_name'),
    payment_link: payment,
  };
  return (t: string) => t.replace(/\{(\w+)\}/g, (m, k) => (k in values ? values[k] : m));
}

async function send(chatId: string | number, text: string, markup?: unknown) {
  return call('sendMessage', { chat_id: chatId, text, reply_markup: markup, disable_web_page_preview: true });
}

/** Sends steps from the session's current position until one needs the user's input (or the flow ends) */
async function advance(sessionId: number) {
  const [s] = await query<Session>(`SELECT * FROM interaction_sessions WHERE id=$1`, [sessionId]);
  if (!s || s.status !== 'active') return;
  const it = await getInteraction(s.interaction_id);
  if (!it) return;
  const render = await placeholders(s, s.content_id);
  let i = s.step;
  while (i < it.steps.length) {
    const st = it.steps[i] as Step;
    const text = render(st.text);
    if (st.type === 'message') {
      await send(s.chat_id, text);
      i++;
      continue;
    }
    if (st.type === 'payment') {
      const url = render(render(st.url || '{payment_link}'));
      if (/^https?:\/\//.test(url)) {
        await send(s.chat_id, text, { inline_keyboard: [[{ text: st.button || '💳 پرداخت', url }]] });
      } else {
        await send(s.chat_id, `${text}\n\n(لینک پرداخت هنوز در تنظیمات فروشگاه تعریف نشده است)`);
      }
      i++;
      continue;
    }
    if (st.type === 'choice') {
      const rows = st.options.map((o, k) => [{ text: o, callback_data: `is:${s.id}:${k}` }]);
      await send(s.chat_id, text, { inline_keyboard: rows });
    } else if (st.type === 'contact') {
      await send(s.chat_id, text, { keyboard: [[{ text: '📱 ارسال شماره تماس', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true });
    } else {
      await send(s.chat_id, text, { remove_keyboard: true });
    }
    await query(`UPDATE interaction_sessions SET step=$2, updated_at=NOW() WHERE id=$1`, [s.id, i]);
    return; // wait for the user's answer
  }
  await finish(s, it, render);
}

async function finish(s: Session, it: Interaction, render: (t: string) => string) {
  await query(`UPDATE interaction_sessions SET status='completed', step=$2, completed_at=NOW(), updated_at=NOW() WHERE id=$1`, [s.id, it.steps.length]);
  if (it.final_message) await send(s.chat_id, render(it.final_message), { remove_keyboard: true });
  const [full] = await query<Session>(`SELECT * FROM interaction_sessions WHERE id=$1`, [s.id]);
  const summary = (full.answers || []).map((a) => `• ${a.key || a.question}: ${a.answer}`).join('\n');
  if (it.notify_admin) {
    const admin = (await getSetting('admin_chat_id')).trim();
    if (admin) {
      const who = `${s.tg_name}${s.tg_username ? ` (@${s.tg_username})` : ''}`;
      // the store admin's chat is with the platform's main bot
      await asMainBot(() => send(admin, `🔔 ${it.emoji} ${it.title} — ${render('{product_name}')}\n👤 ${who}\n${summary}`)).catch((e) => console.error('admin notify:', e.message));
    }
  }
  forward({ event: 'interaction.completed', interaction: { id: it.id, title: it.title }, session: full, product: render('{product_name}') });
}

function forward(payload: Record<string, unknown>) {
  getSetting('n8n_feedback_webhook').then((url) => {
    if (!url.trim()) return;
    return fetch(url.trim(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, reply_api: `${config.publicUrl}/api/interactions/sessions/${(payload.session as Session)?.id}/reply` }),
      signal: AbortSignal.timeout(10000),
    });
  }).catch((e) => console.error('n8n interaction webhook:', (e as Error).message));
}

async function startSession(interactionId: number, contentId: number, msg: TgMessage) {
  const it = await getInteraction(interactionId);
  if (!it || !it.enabled) {
    await send(msg.chat.id, 'این گزینه در حال حاضر فعال نیست 🙏');
    return;
  }
  await query(`UPDATE interaction_sessions SET status='cancelled', updated_at=NOW() WHERE chat_id=$1 AND status='active'`, [msg.chat.id]);
  const [s] = await query<Session>(
    `INSERT INTO interaction_sessions (interaction_id, content_id, tg_user_id, tg_username, tg_name, chat_id, bot_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [it.id, contentId || null, msg.from?.id ?? msg.chat.id, msg.from?.username || '', nameOf(msg.from), msg.chat.id, currentBotId() ?? null],
  );
  if (it.mode === 'popup') {
    // popup interactions opened via a deep link (e.g. from e-mail): show the text as a message
    await send(msg.chat.id, it.popup_text);
    await finish(s, { ...it, final_message: '' }, (t) => t);
    return;
  }
  forward({ event: 'interaction.started', interaction: { id: it.id, title: it.title }, session: s });
  await advance(s.id);
}

async function saveAnswer(s: Session, answer: string) {
  const it = await getInteraction(s.interaction_id);
  const st = it?.steps[s.step] as Step | undefined;
  if (!it || !st) return;
  const render = await placeholders(s, s.content_id);
  const answers = [...(s.answers || []), { key: st.key || '', question: render(st.text), answer }];
  await query(`UPDATE interaction_sessions SET answers=$2, step=$3, seen=FALSE, updated_at=NOW() WHERE id=$1`, [s.id, JSON.stringify(answers), s.step + 1]);
  await advance(s.id);
}

/**
 * Handles Telegram updates that belong to interactions. Returns true when the update was consumed.
 * Called by the feedback poller before its generic handling.
 */
export async function handleInteractionUpdate(u: {
  callback_query?: { id: string; from: TgUser; data?: string };
  message?: TgMessage;
}): Promise<boolean> {
  const cq = u.callback_query;
  if (cq?.data) {
    // popup interaction under a post
    let m = /^ia:(\d+):(\d+)$/.exec(cq.data);
    if (m) {
      const it = await getInteraction(Number(m[1]));
      await call('answerCallbackQuery', { callback_query_id: cq.id, text: (it?.popup_text || 'ثبت شد 🙏').slice(0, 200), show_alert: true }).catch(() => undefined);
      await query(
        `INSERT INTO feedback (kind, content_id, interaction_id, button_title, tg_user_id, tg_username, tg_name, auto_reply, status, bot_id)
         VALUES ('click',$1,$2,$3,$4,$5,$6,$7,'seen',$8)`,
        [Number(m[2]) || null, it?.id ?? null, it ? `${it.emoji} ${it.title}`.trim() : '', cq.from.id, cq.from.username || '', nameOf(cq.from), it?.popup_text || '', currentBotId() ?? null],
      );
      forward({ event: 'interaction.tap', interaction: it ? { id: it.id, title: it.title } : null, user: cq.from, content_id: Number(m[2]) });
      return true;
    }
    // multiple-choice answer inside a conversation
    m = /^is:(\d+):(\d+)$/.exec(cq.data);
    if (m) {
      const [s] = await query<Session>(`SELECT * FROM interaction_sessions WHERE id=$1`, [Number(m[1])]);
      const it = s ? await getInteraction(s.interaction_id) : undefined;
      const st = it?.steps[s?.step ?? -1] as Step | undefined;
      if (!s || s.status !== 'active' || st?.type !== 'choice') {
        await call('answerCallbackQuery', { callback_query_id: cq.id, text: 'این گفتگو به پایان رسیده است' }).catch(() => undefined);
        return true;
      }
      const choice = st.options[Number(m[2])] ?? '';
      await call('answerCallbackQuery', { callback_query_id: cq.id, text: `✔ ${choice}` }).catch(() => undefined);
      await saveAnswer(s, choice);
      return true;
    }
    return false;
  }

  const msg = u.message;
  if (!msg || msg.chat.type !== 'private') return false;
  const text = (msg.text || msg.caption || '').trim();

  const start = /^\/start\s+i(\d+)_c(\d+)$/i.exec(text);
  if (start) {
    await startSession(Number(start[1]), Number(start[2]), msg);
    return true;
  }

  const [s] = await query<Session>(`SELECT * FROM interaction_sessions WHERE chat_id=$1 AND status='active' ORDER BY id DESC LIMIT 1`, [msg.chat.id]);
  if (!s) return false;
  if (/^\/(cancel|لغو)/.test(text) || text === 'لغو') {
    await query(`UPDATE interaction_sessions SET status='cancelled', updated_at=NOW() WHERE id=$1`, [s.id]);
    await send(msg.chat.id, 'گفتگو لغو شد. هر زمان خواستید دوباره از دکمه زیر پست شروع کنید.', { remove_keyboard: true });
    return true;
  }
  const it = await getInteraction(s.interaction_id);
  const st = it?.steps[s.step] as Step | undefined;
  if (!st) return false;
  if (st.type === 'choice') {
    const pick = st.options.find((o) => o === text);
    if (!pick) {
      await send(msg.chat.id, 'لطفاً یکی از گزینه‌های بالا را انتخاب کنید (یا /cancel برای لغو).');
      return true;
    }
    await saveAnswer(s, pick);
    return true;
  }
  if (st.type === 'contact') {
    const phone = msg.contact?.phone_number || text;
    if (!/^[+\d۰-۹٠-٩\s-]{7,20}$/.test(phone)) {
      await send(msg.chat.id, 'شماره معتبر نیست؛ دوباره بفرستید یا از دکمه «ارسال شماره تماس» استفاده کنید.');
      return true;
    }
    await saveAnswer(s, phone);
    return true;
  }
  if (!text) {
    await send(msg.chat.id, 'لطفاً پاسخ را به‌صورت متن بفرستید.');
    return true;
  }
  await saveAnswer(s, text);
  return true;
}

// ------------------------------------------------------------------ panel: responses

export async function listSessions(filter: { interactionId?: number; status?: string; contentId?: number; productId?: number } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.interactionId) { params.push(filter.interactionId); where.push(`s.interaction_id=$${params.length}`); }
  if (filter.status) { params.push(filter.status); where.push(`s.status=$${params.length}`); }
  if (filter.contentId) { params.push(filter.contentId); where.push(`s.content_id=$${params.length}`); }
  if (filter.productId) { params.push(filter.productId); where.push(`c.product_id=$${params.length}`); }
  return query(`
    SELECT s.*, i.title AS interaction_title, i.emoji AS interaction_emoji, jsonb_array_length(i.steps) AS total_steps,
           p.id AS product_id, p.name AS product_name, p.image_url AS product_image, pl.name AS platform_name
      FROM interaction_sessions s
      JOIN interactions i ON i.id = s.interaction_id
      LEFT JOIN contents c ON c.id = s.content_id
      LEFT JOIN products p ON p.id = c.product_id
      LEFT JOIN platforms pl ON pl.key = c.channel
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY s.updated_at DESC LIMIT 300`, params);
}

/** Interaction counts per content of one product (for the product page) */
export async function statsByProduct(productId: number) {
  return query(`
    SELECT c.id AS content_id,
      (SELECT COUNT(*) FROM feedback f WHERE f.content_id = c.id)::int AS taps,
      (SELECT COUNT(*) FROM interaction_sessions s WHERE s.content_id = c.id)::int AS sessions,
      (SELECT COUNT(*) FROM interaction_sessions s WHERE s.content_id = c.id AND s.status='completed')::int AS completed
    FROM contents c WHERE c.product_id = $1`, [productId]);
}

export async function unseenSessions() {
  const [r] = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM interaction_sessions WHERE status='completed' AND NOT seen`);
  return r.n;
}

export async function markSessionsSeen(ids: number[]) {
  await query(`UPDATE interaction_sessions SET seen=TRUE WHERE id = ANY($1::int[])`, [ids]);
}

export async function replyToSession(id: number, text: string) {
  const [s] = await query<Session>(`SELECT * FROM interaction_sessions WHERE id=$1`, [id]);
  if (!s) throw new Error('گفتگو یافت نشد');
  await runAsBot(s.bot_id, () => send(s.chat_id, text));
  await query(`UPDATE interaction_sessions SET reply=$2, seen=TRUE, updated_at=NOW() WHERE id=$1`, [id, text]);
  return { ok: true };
}
