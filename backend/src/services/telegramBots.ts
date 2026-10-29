import crypto from 'crypto';
import { query } from '../db/pool';
import { open, seal } from './secretBox';
import { getSetting } from './settings';
import { asMainBot, BotContext, call as rawCall, currentBotId, getBotInfo, withBot } from './telegram';

/**
 * Stores' own Telegram bots, created through the platform's main bot (Telegram "managed bots").
 * The main bot has Bot Management Mode enabled in BotFather; the store owner only confirms the
 * new bot in Telegram, and the main bot fetches its token. Tokens are stored encrypted.
 *
 *  1. the panel creates a one-time link  t.me/<main bot>?start=bot_<token>
 *  2. /start bot_<token> binds that Telegram account to the request; the bot answers with a
 *     "create bot" button (KeyboardButtonRequestManagedBot) pre-filled with the store's name
 *  3. the owner confirms; the main bot receives managed_bot / managed_bot_created and fetches the token
 */

export interface StoreBot {
  id: number;
  tg_bot_id: string;
  username: string;
  name: string;
  status: 'active' | 'error';
  error: string;
  owner_tg_user_id: string | null;
  created_by: number | null;
  created_at: string;
}

interface TgUser { id: number; is_bot?: boolean; first_name?: string; username?: string }
interface Request { id: number; user_id: number; tg_user_id: string | null; bot_id: number | null }

export interface ManagerUpdate {
  managed_bot?: { user: TgUser; bot: TgUser };
  message?: { from?: TgUser; chat: { id: number; type: string }; text?: string; managed_bot_created?: { bot: TgUser } };
}

const LINK_MINUTES = 15;
const COLUMNS = 'id, tg_bot_id, username, name, status, error, owner_tg_user_id, created_by, created_at';
const call = <T = unknown>(method: string, fields: Record<string, unknown>) => rawCall(method, fields) as unknown as Promise<T>;
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
const send = (chatId: number, text: string, extra: Record<string, unknown> = {}) =>
  call('sendMessage', { chat_id: chatId, text, ...extra }).catch((e) => console.error('telegram bots:', (e as Error).message));

// ------------------------------------------------------------------ running as a store bot

const contexts = new Map<number, BotContext>();

/** Telegram context (token) of a store bot */
export async function botContext(botId: number): Promise<BotContext> {
  const cached = contexts.get(botId);
  if (cached) return cached;
  const [b] = await query<{ token_enc: string }>(`SELECT token_enc FROM telegram_bots WHERE id=$1`, [botId]);
  if (!b?.token_enc) throw fail(404, 'ربات یافت نشد');
  const ctx = { token: open(b.token_enc), botId };
  contexts.set(botId, ctx);
  return ctx;
}

/** Runs fn through a store bot, or through the main bot when botId is empty */
export async function runAsBot<T>(botId: number | null | undefined, fn: () => Promise<T>): Promise<T> {
  return botId ? withBot(await botContext(botId), fn) : asMainBot(fn);
}

/** Polling for a store bot is started by telegramPolling.ts (not loaded in tests) */
let onBotReady: (botId: number) => void = () => undefined;
export const setBotReadyHook = (fn: (botId: number) => void) => { onBotReady = fn; };

// ------------------------------------------------------------------ create flow

/** Suggested @username: Telegram needs 5–32 latin letters/digits/underscores ending in "bot" */
const suggestUsername = () => `shop_${crypto.randomBytes(3).toString('hex')}_bot`;

/** Whether the main bot may create bots (Bot Management Mode in BotFather) */
export const canManageBots = async () =>
  !!(await asMainBot(() => call<{ can_manage_bots?: boolean }>('getMe', {}))).can_manage_bots;

export async function createBotLink(userId: number) {
  // getMe can lag behind the BotFather setting, so only warn; Telegram itself rejects the button if it is really off
  if (!(await canManageBots().catch(() => false))) {
    console.warn('Telegram: getMe reports can_manage_bots=false for the main bot ("Bot Management Mode" in BotFather)');
  }
  const token = crypto.randomBytes(24).toString('base64url');
  const { username } = await asMainBot(getBotInfo);
  const [row] = await query<{ id: number; expires_at: string }>(
    `INSERT INTO telegram_connect_requests (user_id, kind, token_hash, expires_at)
     VALUES ($1, 'bot', $2, NOW() + make_interval(mins => $3)) RETURNING id, expires_at`,
    [userId, sha256(token), LINK_MINUTES],
  );
  return { id: row.id, url: `https://t.me/${username}?start=bot_${token}`, expires_at: row.expires_at };
}

export async function botLinkStatus(id: number, userId: number) {
  const [r] = await query<Request & { expired: boolean; used_at: string | null; error: string }>(
    `SELECT *, expires_at < NOW() AS expired FROM telegram_connect_requests WHERE id=$1 AND user_id=$2 AND kind='bot'`,
    [id, userId],
  );
  if (!r) throw fail(404, 'درخواست یافت نشد');
  const bot = r.bot_id ? await getBot(r.bot_id) : null;
  const status = bot ? 'created' : r.error ? 'failed' : r.expired ? 'expired' : r.tg_user_id ? 'opened' : 'pending';
  return { status, error: r.error || undefined, bot };
}

const openRequest = async (where: string, params: unknown[]) =>
  (await query<Request>(
    `SELECT * FROM telegram_connect_requests WHERE kind='bot' AND ${where} AND used_at IS NULL AND expires_at > NOW()`,
    params,
  ))[0];

async function onStart(chatId: number, from: TgUser, token: string) {
  const r = await openRequest('token_hash = $1', [sha256(token)]);
  if (!r || (r.tg_user_id && String(r.tg_user_id) !== String(from.id))) {
    await send(chatId, 'این لینک دیگر معتبر نیست. از پنل مدیریت یک لینک جدید بسازید.');
    return;
  }
  await query(`UPDATE telegram_connect_requests SET tg_user_id=$2 WHERE id=$1`, [r.id, from.id]);
  const name = (await getSetting('store_name')).trim().slice(0, 64) || 'فروشگاه من';
  try {
    await call('sendMessage', {
      chat_id: chatId,
      text: 'روی دکمهٔ زیر بزنید و ساخت ربات فروشگاه را تأیید کنید. نام و آیدی پیشنهادی را می‌توانید تغییر دهید.',
      reply_markup: {
        keyboard: [[{ text: '🤖 ساخت ربات فروشگاه', request_managed_bot: { request_id: r.id, suggested_name: name, suggested_username: suggestUsername() } }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  } catch (e) {
    // e.g. Bot Management Mode is off: show the failure in the panel instead of leaving it waiting
    console.error('managed bot button:', (e as Error).message);
    const message = 'ساخت ربات فعلاً در دسترس نیست. کمی بعد دوباره تلاش کنید.';
    await query(`UPDATE telegram_connect_requests SET error=$2, used_at=NOW() WHERE id=$1`, [r.id, message]);
    await send(chatId, `❌ ${message}`);
  }
}

/** A bot was created through the main bot (arrives both as an update and as a service message) */
async function onBotCreated(creator: TgUser, bot: TgUser, chatId?: number) {
  const r = await openRequest('tg_user_id = $1', [creator.id]);
  if (!r) {
    // the other of the two notifications already saved it: just confirm in the chat
    const [done] = await query(`SELECT id FROM telegram_bots WHERE tg_bot_id=$1 AND owner_tg_user_id=$2`, [bot.id, creator.id]);
    if (done && chatId) await send(chatId, `✅ ربات @${bot.username} ساخته شد. ادامهٔ کار را در پنل انجام دهید.`, { reply_markup: { remove_keyboard: true } });
    return; // otherwise: created outside the panel
  }
  try {
    const token = await call<string>('getManagedBotToken', { user_id: bot.id });
    // subscribers must be able to use the store's bot (buttons, private answers)
    await call('setManagedBotAccessSettings', { user_id: bot.id, is_access_restricted: false });
    const [row] = await query<{ id: number }>(
      `INSERT INTO telegram_bots (tg_bot_id, username, name, token_enc, owner_tg_user_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (tg_bot_id) DO UPDATE SET username=EXCLUDED.username, name=EXCLUDED.name, token_enc=EXCLUDED.token_enc,
         owner_tg_user_id=EXCLUDED.owner_tg_user_id, status='active', error='', updated_at=NOW()
       RETURNING id`,
      [bot.id, bot.username || '', bot.first_name || '', seal(token), creator.id, r.user_id],
    );
    contexts.delete(row.id);
    await query(`UPDATE telegram_connect_requests SET bot_id=$2, used_at=NOW() WHERE id=$1`, [r.id, row.id]);
    onBotReady(row.id);
    if (chatId) await send(chatId, `✅ ربات @${bot.username} ساخته شد. ادامهٔ کار را در پنل انجام دهید.`, { reply_markup: { remove_keyboard: true } });
  } catch (e) {
    const message = 'ساخت ربات کامل نشد. دوباره تلاش کنید.';
    console.error('managed bot:', (e as Error).message);
    await query(`UPDATE telegram_connect_requests SET error=$2, used_at=NOW() WHERE id=$1`, [r.id, message]);
    if (chatId) await send(chatId, `❌ ${message}`, { reply_markup: { remove_keyboard: true } });
  }
}

/** Token or owner of an existing bot changed (e.g. the token was revoked in BotFather) */
async function onBotChanged(creator: TgUser, bot: TgUser) {
  const [known] = await query<{ id: number }>(`SELECT id FROM telegram_bots WHERE tg_bot_id=$1`, [bot.id]);
  if (!known) return onBotCreated(creator, bot);
  try {
    const token = await call<string>('getManagedBotToken', { user_id: bot.id });
    await query(
      `UPDATE telegram_bots SET token_enc=$2, username=$3, owner_tg_user_id=$4, status='active', error='', updated_at=NOW() WHERE id=$1`,
      [known.id, seal(token), bot.username || '', creator.id],
    );
    contexts.delete(known.id);
    onBotReady(known.id);
  } catch (e) {
    await markBotError(known.id, (e as Error).message);
  }
}

/** Handles updates of the main bot about managed bots; true when consumed */
export async function handleManagerUpdate(u: ManagerUpdate): Promise<boolean> {
  if (currentBotId()) return false; // store bots don't manage bots
  if (u.managed_bot) return onBotChanged(u.managed_bot.user, u.managed_bot.bot).then(() => true);
  const m = u.message;
  if (!m || m.chat.type !== 'private' || !m.from) return false;
  if (m.managed_bot_created) return onBotCreated(m.from, m.managed_bot_created.bot, m.chat.id).then(() => true);
  const start = /^\/start\s+bot_([A-Za-z0-9_-]{20,64})$/.exec((m.text || '').trim());
  if (start) return onStart(m.chat.id, m.from, start[1]).then(() => true);
  return false;
}

// ------------------------------------------------------------------ panel

export async function getBot(id: number) {
  return (await query<StoreBot>(`SELECT ${COLUMNS} FROM telegram_bots WHERE id=$1`, [id]))[0];
}

export async function listBots() {
  return query<StoreBot & { channels: number }>(
    `SELECT ${COLUMNS.split(', ').map((c) => `b.${c}`).join(', ')},
       (SELECT COUNT(*) FROM telegram_channels c WHERE c.bot_id = b.id AND c.status <> 'disconnected')::int AS channels
     FROM telegram_bots b ORDER BY b.created_at`,
  );
}

export async function activeBotIds() {
  return (await query<{ id: number }>(`SELECT id FROM telegram_bots WHERE status='active'`)).map((r) => r.id);
}

export async function markBotError(id: number, error: string) {
  contexts.delete(id);
  await query(`UPDATE telegram_bots SET status='error', error=$2, updated_at=NOW() WHERE id=$1`, [id, error.slice(0, 250)]);
}

export const getBotOffset = async (id: number) =>
  Number((await query<{ update_offset: string }>(`SELECT update_offset FROM telegram_bots WHERE id=$1`, [id]))[0]?.update_offset || 0);
export const saveBotOffset = (id: number, offset: number) =>
  query(`UPDATE telegram_bots SET update_offset=$2 WHERE id=$1`, [id, offset]);
