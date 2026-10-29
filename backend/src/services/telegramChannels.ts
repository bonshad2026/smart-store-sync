import crypto from 'crypto';
import { query } from '../db/pool';
import { getPlatformByKey } from './platforms';
import { getBot, runAsBot } from './telegramBots';
import { call as rawCall, currentBotId, getBotInfo } from './telegram';

/**
 * Telegram channels connected through the store's own bot (see telegramBots.ts).
 *
 * Connecting (no BotFather, no tokens for the store owner):
 *  1. the panel creates a one-time link  t.me/<bot>?start=ch_<token>
 *  2. /start ch_<token> in the private chat binds that Telegram account to the request and the bot
 *     answers with a "pick a channel" button (KeyboardButtonRequestChat)
 *  3. Telegram lists only channels where the user is an admin with the rights below, and adds the bot
 *     as admin with those rights; the bot receives chat_shared from the same account and stores the channel
 * The bot leaves any channel it is added to outside this flow.
 *
 * Monitoring: posts, reaction counts, subscribers joining/leaving and the subscriber count.
 */

export type ChannelStatus = 'active' | 'restricted' | 'removed' | 'disconnected';

export interface TelegramChannel {
  id: number;
  chat_id: string;
  title: string;
  username: string;
  status: ChannelStatus;
  bot_rights: Record<string, boolean>;
  member_count: number | null;
  destination_id: number | null;
  bot_id: number | null;
  connected_by: number | null;
  owner_tg_user_id: string | null;
  connected_at: string;
  refreshed_at: string | null;
  disconnected_at: string | null;
}

interface ConnectRequest {
  id: number; user_id: number; tg_user_id: string | null; channel_id: number | null; error: string;
  expires_at: string; used_at: string | null;
}

interface TgUser { id: number; first_name?: string; last_name?: string; username?: string }
interface TgChat { id: number; type: string; title?: string; username?: string }
interface ChatMember { status: string; user: TgUser; can_post_messages?: boolean; can_edit_messages?: boolean; can_delete_messages?: boolean }
interface ChatMemberUpdated { chat: TgChat; from: TgUser; old_chat_member: ChatMember; new_chat_member: ChatMember }
interface ChannelPost { message_id: number; chat: TgChat; date?: number; text?: string; caption?: string }

export interface ChannelUpdate {
  message?: {
    message_id: number; from?: TgUser; chat: TgChat; text?: string;
    chat_shared?: { request_id: number; chat_id: number; title?: string; username?: string };
  };
  my_chat_member?: ChatMemberUpdated;
  chat_member?: ChatMemberUpdated;
  channel_post?: ChannelPost;
  edited_channel_post?: ChannelPost;
  message_reaction_count?: {
    chat: TgChat; message_id: number;
    reactions: { type: { type: string; emoji?: string; custom_emoji_id?: string }; total_count: number }[];
  };
}

/** Update types the bot must ask Telegram for (chat_member and reaction counts are not sent by default) */
export const CHANNEL_UPDATES = ['my_chat_member', 'chat_member', 'channel_post', 'edited_channel_post', 'message_reaction_count'];

const LINK_MINUTES = 15;
const call = <T = unknown>(method: string, fields: Record<string, unknown>) => rawCall(method, fields) as unknown as Promise<T>;
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
const nameOf = (u?: TgUser) => [u?.first_name, u?.last_name].filter(Boolean).join(' ').slice(0, 200);

/** What the bot asks for when it is added; the owner must hold the same rights to grant them */
const RIGHTS = {
  is_anonymous: false,
  can_manage_chat: true,
  can_post_messages: true,
  can_edit_messages: true,
  can_delete_messages: true,
  can_manage_video_chats: false,
  can_restrict_members: false,
  can_promote_members: false,
  can_change_info: false,
  can_invite_users: false,
  can_post_stories: false,
  can_edit_stories: false,
  can_delete_stories: false,
};

const statusFromMember = (m: ChatMember): ChannelStatus =>
  m.status === 'administrator' ? (m.can_post_messages ? 'active' : 'restricted') : m.status === 'creator' ? 'active' : 'removed';

const rightsOf = (m: ChatMember) => ({
  can_post_messages: !!m.can_post_messages,
  can_edit_messages: !!m.can_edit_messages,
  can_delete_messages: !!m.can_delete_messages,
});

const send = (chatId: number | string, text: string, extra: Record<string, unknown> = {}) =>
  call('sendMessage', { chat_id: chatId, text, ...extra }).catch((e) => console.error('telegram channels:', (e as Error).message));

// ------------------------------------------------------------------ connect flow

/** Creates a one-time link that opens the bot and lets the owner pick a channel */
export async function createConnectLink(userId: number, botId: number) {
  const bot = await getBot(botId);
  if (!bot) throw fail(404, 'ربات یافت نشد');
  if (bot.status !== 'active') throw fail(409, 'ربات فروشگاه در دسترس نیست');
  const token = crypto.randomBytes(24).toString('base64url');
  const { username } = await runAsBot(botId, getBotInfo);
  const [row] = await query<{ id: number; expires_at: string }>(
    `INSERT INTO telegram_connect_requests (user_id, kind, bot_id, token_hash, expires_at)
     VALUES ($1, 'channel', $2, $3, NOW() + make_interval(mins => $4)) RETURNING id, expires_at`,
    [userId, botId, sha256(token), LINK_MINUTES],
  );
  return { id: row.id, url: `https://t.me/${username}?start=ch_${token}`, expires_at: row.expires_at };
}

/** State of a connect link, for the panel to follow while the owner is in Telegram */
export async function connectStatus(id: number, userId: number) {
  const [r] = await query<ConnectRequest & { expired: boolean }>(
    `SELECT *, expires_at < NOW() AS expired FROM telegram_connect_requests WHERE id=$1 AND user_id=$2 AND kind='channel'`,
    [id, userId],
  );
  if (!r) throw fail(404, 'درخواست اتصال یافت نشد');
  const channel = r.channel_id ? await getChannel(r.channel_id) : null;
  const status = channel ? 'connected' : r.error ? 'failed' : r.expired ? 'expired' : r.tg_user_id ? 'opened' : 'pending';
  return { status, error: r.error || undefined, channel };
}

/** Open channel request of the bot that received the update */
const openRequest = async (where: string, params: unknown[]) =>
  (await query<ConnectRequest>(
    `SELECT * FROM telegram_connect_requests
      WHERE kind='channel' AND bot_id IS NOT DISTINCT FROM $${params.length + 1}::int AND ${where} AND used_at IS NULL AND expires_at > NOW()`,
    [...params, currentBotId() ?? null],
  ))[0];

/** /start ch_<token> in a private chat */
async function onStart(chatId: number, from: TgUser, token: string) {
  const r = await openRequest('token_hash = $1', [sha256(token)]);
  if (!r || (r.tg_user_id && String(r.tg_user_id) !== String(from.id))) {
    await send(chatId, 'این لینک دیگر معتبر نیست. از پنل مدیریت یک لینک جدید بسازید.');
    return;
  }
  await query(`UPDATE telegram_connect_requests SET tg_user_id=$2 WHERE id=$1`, [r.id, from.id]);
  await send(chatId, 'روی دکمهٔ زیر بزنید و کانالی را که می‌خواهید متصل شود انتخاب کنید.', {
    reply_markup: {
      keyboard: [[{
        text: '📢 انتخاب کانال',
        request_chat: {
          request_id: r.id,
          chat_is_channel: true,
          user_administrator_rights: RIGHTS,
          bot_administrator_rights: RIGHTS,
          request_title: true,
          request_username: true,
        },
      }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

/** The owner picked a channel; Telegram has added the bot to it */
async function onChatShared(chatId: number, from: TgUser, shared: { request_id: number; chat_id: number; title?: string; username?: string }) {
  const done = { reply_markup: { remove_keyboard: true } };
  const r = await openRequest('id = $1 AND tg_user_id = $2', [shared.request_id, from.id]);
  if (!r) {
    await send(chatId, 'این درخواست دیگر معتبر نیست. از پنل مدیریت یک لینک جدید بسازید.', done);
    return;
  }
  const failRequest = async (message: string) => {
    await query(`UPDATE telegram_connect_requests SET error=$2, used_at=NOW() WHERE id=$1`, [r.id, message]);
    await send(chatId, `❌ ${message}`, done);
  };

  const [owner, bot] = await Promise.all([
    call<ChatMember>('getChatMember', { chat_id: shared.chat_id, user_id: from.id }).catch(() => null),
    getBotInfo().then((b) => call<ChatMember>('getChatMember', { chat_id: shared.chat_id, user_id: b.id })).catch(() => null),
  ]);
  if (!owner || !['creator', 'administrator'].includes(owner.status)) return failRequest('فقط مدیران کانال می‌توانند آن را متصل کنند.');
  if (!bot || bot.status !== 'administrator') return failRequest('ربات به‌عنوان مدیر به کانال اضافه نشد. دوباره تلاش کنید.');

  const chat = await call<TgChat>('getChat', { chat_id: shared.chat_id }).catch(() => null);
  const channel = await saveChannel({
    chatId: shared.chat_id,
    title: chat?.title || shared.title || '',
    username: chat?.username || shared.username || '',
    status: statusFromMember(bot),
    rights: rightsOf(bot),
    userId: r.user_id,
    ownerTgId: from.id,
    botId: currentBotId() ?? null,
  });
  await query(`UPDATE telegram_connect_requests SET channel_id=$2, used_at=NOW() WHERE id=$1`, [r.id, channel.id]);
  await refreshChannel(channel.id).catch(() => undefined);
  await send(chatId, `✅ کانال «${channel.title}» متصل شد. مدیریت آن از پنل انجام می‌شود.`, done);
}

/** Creates or re-activates the channel and its publishing destination */
async function saveChannel(c: {
  chatId: number; title: string; username: string; status: ChannelStatus; rights: Record<string, boolean>; userId: number; ownerTgId: number;
  botId: number | null;
}): Promise<TelegramChannel> {
  const [existing] = await query<TelegramChannel>(`SELECT * FROM telegram_channels WHERE chat_id=$1`, [c.chatId]);
  const name = c.title || (c.username ? `@${c.username}` : String(c.chatId));
  let destinationId = existing?.destination_id ?? null;
  if (destinationId) {
    await query(`UPDATE destinations SET name=$2, enabled=TRUE, updated_at=NOW() WHERE id=$1`, [destinationId, name]);
  } else {
    const platform = await getPlatformByKey('telegram');
    if (platform) {
      const [d] = await query<{ id: number }>(
        `INSERT INTO destinations (platform_id, name, config) VALUES ($1, $2, $3) RETURNING id`,
        [platform.id, name, JSON.stringify({ chat_id: String(c.chatId), tg_channel: true })],
      );
      destinationId = d.id;
    }
  }
  const [row] = await query<TelegramChannel>(
    `INSERT INTO telegram_channels (chat_id, title, username, status, bot_rights, destination_id, connected_by, owner_tg_user_id, bot_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (chat_id) DO UPDATE SET title=EXCLUDED.title, username=EXCLUDED.username, status=EXCLUDED.status,
       bot_rights=EXCLUDED.bot_rights, destination_id=EXCLUDED.destination_id, connected_by=EXCLUDED.connected_by,
       owner_tg_user_id=EXCLUDED.owner_tg_user_id, bot_id=EXCLUDED.bot_id, connected_at=NOW(), disconnected_at=NULL
     RETURNING *`,
    [c.chatId, c.title, c.username, c.status, JSON.stringify(c.rights), destinationId, c.userId, c.ownerTgId, c.botId],
  );
  return row;
}

// ------------------------------------------------------------------ incoming updates

/** The channel as seen by the bot handling the update (a channel belongs to one bot) */
const channelByChat = async (chatId: number | string) =>
  (await query<TelegramChannel>(
    `SELECT * FROM telegram_channels WHERE chat_id=$1 AND bot_id IS NOT DISTINCT FROM $2::int`,
    [chatId, currentBotId() ?? null],
  ))[0];

/** Bot's own membership changed: added, removed, rights changed */
async function onMyChatMember(u: ChatMemberUpdated) {
  if (u.chat.type !== 'channel') return;
  const ch = await channelByChat(u.chat.id);
  const status = statusFromMember(u.new_chat_member);
  if (ch && ch.status !== 'disconnected') {
    await query(`UPDATE telegram_channels SET status=$2, bot_rights=$3, title=COALESCE(NULLIF($4,''), title) WHERE id=$1`,
      [ch.id, status, JSON.stringify(rightsOf(u.new_chat_member)), u.chat.title || '']);
    if (status === 'removed' && ch.destination_id) await query(`UPDATE destinations SET enabled=FALSE WHERE id=$1`, [ch.destination_id]);
    return;
  }
  if (status === 'removed') return;
  // added outside the panel flow: allowed only while the same account is in the middle of connecting
  const pending = await openRequest('tg_user_id = $1', [u.from.id]);
  if (!pending) await call('leaveChat', { chat_id: u.chat.id }).catch(() => undefined);
}

/** A subscriber joined or left */
async function onChatMember(u: ChatMemberUpdated) {
  const ch = await channelByChat(u.chat.id);
  if (!ch || ch.status === 'disconnected') return;
  const inside = (s: string) => ['member', 'administrator', 'creator', 'restricted'].includes(s);
  const was = inside(u.old_chat_member.status);
  const is = inside(u.new_chat_member.status);
  if (was === is) return;
  const user = u.new_chat_member.user;
  await query(
    `INSERT INTO telegram_member_events (channel_id, tg_user_id, tg_name, tg_username, event) VALUES ($1,$2,$3,$4,$5)`,
    [ch.id, user.id, nameOf(user), user.username || '', is ? 'join' : 'leave'],
  );
  await query(`UPDATE telegram_channels SET member_count = GREATEST(COALESCE(member_count, 0) + $2, 0) WHERE id=$1`, [ch.id, is ? 1 : -1]);
}

/** A post published in the channel (directly in Telegram, or edited) */
async function onChannelPost(p: ChannelPost, edited: boolean) {
  const ch = await channelByChat(p.chat.id);
  if (!ch || ch.status === 'disconnected') return;
  const text = (p.text || p.caption || '').slice(0, 2000);
  if (edited) {
    await query(`UPDATE telegram_posts SET text=$3, updated_at=NOW() WHERE channel_id=$1 AND message_id=$2`, [ch.id, p.message_id, text]);
    return;
  }
  await query(
    `INSERT INTO telegram_posts (channel_id, message_id, source, text, posted_at)
     VALUES ($1,$2,'telegram',$3, COALESCE(to_timestamp($4), NOW())) ON CONFLICT (channel_id, message_id) DO NOTHING`,
    [ch.id, p.message_id, text, p.date ?? null],
  );
}

/** Anonymous reaction totals on a channel post */
async function onReactionCount(r: NonNullable<ChannelUpdate['message_reaction_count']>) {
  const ch = await channelByChat(r.chat.id);
  if (!ch || ch.status === 'disconnected') return;
  const reactions: Record<string, number> = {};
  for (const x of r.reactions) {
    const key = x.type.emoji || (x.type.type === 'paid' ? '⭐' : '•');
    reactions[key] = (reactions[key] || 0) + x.total_count;
  }
  const total = Object.values(reactions).reduce((a, b) => a + b, 0);
  await query(
    `INSERT INTO telegram_posts (channel_id, message_id, source, reactions, reactions_total)
     VALUES ($1,$2,'telegram',$3,$4)
     ON CONFLICT (channel_id, message_id) DO UPDATE SET reactions=EXCLUDED.reactions, reactions_total=EXCLUDED.reactions_total, updated_at=NOW()`,
    [ch.id, r.message_id, JSON.stringify(reactions), total],
  );
}

/** Handles channel-related updates; returns true when the update was consumed */
export async function handleChannelUpdate(u: ChannelUpdate): Promise<boolean> {
  if (u.my_chat_member) return onMyChatMember(u.my_chat_member).then(() => true);
  if (u.chat_member) return onChatMember(u.chat_member).then(() => true);
  if (u.channel_post) return onChannelPost(u.channel_post, false).then(() => true);
  if (u.edited_channel_post) return onChannelPost(u.edited_channel_post, true).then(() => true);
  if (u.message_reaction_count) return onReactionCount(u.message_reaction_count).then(() => true);
  const m = u.message;
  if (!m || m.chat.type !== 'private' || !m.from) return false;
  if (m.chat_shared) return onChatShared(m.chat.id, m.from, m.chat_shared).then(() => true);
  const start = /^\/start\s+ch_([A-Za-z0-9_-]{20,64})$/.exec((m.text || '').trim());
  if (start) return onStart(m.chat.id, m.from, start[1]).then(() => true);
  return false;
}

/** Remembers a post the panel sent, so reactions and button taps can be tied to the content */
export async function recordPanelPost(chatId: string, messageIds: number[], contentId: number | undefined, text: string) {
  const ch = await channelByChat(chatId).catch(() => undefined);
  if (!ch) return;
  const plain = text.replace(/<[^>]+>/g, '').slice(0, 2000);
  for (const [i, id] of messageIds.entries()) {
    await query(
      `INSERT INTO telegram_posts (channel_id, message_id, content_id, source, text) VALUES ($1,$2,$3,'panel',$4)
       ON CONFLICT (channel_id, message_id) DO UPDATE SET content_id=EXCLUDED.content_id, source='panel'`,
      [ch.id, id, contentId ?? null, i === 0 ? plain : ''],
    );
  }
}

// ------------------------------------------------------------------ panel

export async function getChannel(id: number) {
  return (await query<TelegramChannel>(`SELECT * FROM telegram_channels WHERE id=$1`, [id]))[0];
}

const STATS = `
  (SELECT COUNT(*) FROM telegram_posts p WHERE p.channel_id = c.id AND p.text <> '')::int AS posts,
  (SELECT COALESCE(SUM(reactions_total), 0) FROM telegram_posts p WHERE p.channel_id = c.id)::int AS reactions,
  (SELECT COUNT(*) FROM feedback f WHERE f.content_id IN (SELECT content_id FROM telegram_posts p WHERE p.channel_id = c.id))::int AS clicks,
  (SELECT COUNT(*) FROM telegram_member_events e WHERE e.channel_id = c.id AND e.event = 'join' AND e.created_at > NOW() - INTERVAL '7 days')::int AS joins_7d,
  (SELECT COUNT(*) FROM telegram_member_events e WHERE e.channel_id = c.id AND e.event = 'leave' AND e.created_at > NOW() - INTERVAL '7 days')::int AS leaves_7d,
  (SELECT MAX(posted_at) FROM telegram_posts p WHERE p.channel_id = c.id) AS last_post_at`;

export async function listChannels() {
  return query(`SELECT c.*, b.username AS bot_username, ${STATS} FROM telegram_channels c LEFT JOIN telegram_bots b ON b.id = c.bot_id ORDER BY (c.status = 'disconnected'), c.connected_at DESC`);
}

export async function channelDetails(id: number) {
  const [channel] = await query(`SELECT c.*, ${STATS} FROM telegram_channels c WHERE c.id=$1`, [id]);
  if (!channel) throw fail(404, 'کانال یافت نشد');
  const [growth, events, posts] = await Promise.all([
    query(`SELECT day, members FROM telegram_member_counts WHERE channel_id=$1 AND day > CURRENT_DATE - 30 ORDER BY day`, [id]),
    query(`SELECT * FROM telegram_member_events WHERE channel_id=$1 ORDER BY created_at DESC LIMIT 30`, [id]),
    query(
      `SELECT p.*, (SELECT COUNT(*) FROM feedback f WHERE f.content_id = p.content_id)::int AS clicks
         FROM telegram_posts p WHERE p.channel_id=$1 AND (p.text <> '' OR p.reactions_total > 0)
        ORDER BY p.posted_at DESC LIMIT 30`,
      [id],
    ),
  ]);
  return { channel, growth, events, posts };
}

/** Re-reads title, @username, subscriber count and the bot's rights from Telegram */
export async function refreshChannel(id: number) {
  const ch = await getChannel(id);
  if (!ch) throw fail(404, 'کانال یافت نشد');
  if (ch.status === 'disconnected') return ch;
  return runAsBot(ch.bot_id, () => refreshThroughBot(ch));
}

async function refreshThroughBot(ch: TelegramChannel) {
  const { id } = ch;
  try {
    const { id: botId } = await getBotInfo();
    const [chat, count, bot] = await Promise.all([
      call<TgChat>('getChat', { chat_id: ch.chat_id }),
      call<number>('getChatMemberCount', { chat_id: ch.chat_id }),
      call<ChatMember>('getChatMember', { chat_id: ch.chat_id, user_id: botId }),
    ]);
    await query(
      `UPDATE telegram_channels SET title=$2, username=$3, member_count=$4, status=$5, bot_rights=$6, refreshed_at=NOW() WHERE id=$1`,
      [id, chat.title || ch.title, chat.username || '', count, statusFromMember(bot), JSON.stringify(rightsOf(bot))],
    );
    await query(
      `INSERT INTO telegram_member_counts (channel_id, day, members) VALUES ($1, CURRENT_DATE, $2)
       ON CONFLICT (channel_id, day) DO UPDATE SET members=EXCLUDED.members`,
      [id, count],
    );
  } catch (e) {
    const m = (e as Error).message;
    if (/chat not found|kicked|not a member|forbidden/i.test(m)) {
      await query(`UPDATE telegram_channels SET status='removed', refreshed_at=NOW() WHERE id=$1`, [id]);
    } else throw e;
  }
  return getChannel(id);
}

export async function refreshAllChannels() {
  const rows = await query<{ id: number }>(`SELECT id FROM telegram_channels WHERE status <> 'disconnected'`);
  for (const r of rows) await refreshChannel(r.id).catch((e) => console.error('telegram channel refresh:', (e as Error).message));
}

/** Removes the bot from the channel and stops publishing to it; history is kept */
export async function disconnectChannel(id: number) {
  const ch = await getChannel(id);
  if (!ch) throw fail(404, 'کانال یافت نشد');
  if (ch.status !== 'removed' && ch.status !== 'disconnected') {
    await runAsBot(ch.bot_id, () => call('leaveChat', { chat_id: ch.chat_id })).catch(() => undefined);
  }
  await query(`UPDATE telegram_channels SET status='disconnected', disconnected_at=NOW() WHERE id=$1`, [id]);
  if (ch.destination_id) await query(`UPDATE destinations SET enabled=FALSE WHERE id=$1`, [ch.destination_id]);
  return getChannel(id);
}
