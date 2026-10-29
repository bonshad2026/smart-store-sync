import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { open, seal } from '../src/services/secretBox';
import { withBot } from '../src/services/telegram';
import { handleManagerUpdate } from '../src/services/telegramBots';
import { ChannelUpdate, handleChannelUpdate as handleAsBot } from '../src/services/telegramChannels';
import { app, pool, query, resetDb, verifiedUser } from './helpers/app';

// A fake Bot API: records calls (and which bot made them) and answers from the state below
const tg = vi.hoisted(() => ({
  calls: [] as { method: string; fields: Record<string, any>; token: string }[],
  members: {} as Record<string, Record<string, unknown>>,
  counts: {} as Record<string, number>,
  managedTokens: {} as Record<string, string>,
  canManage: true,
  failCreateButton: false,
}));
vi.mock('../src/services/telegram', async (original) => {
  const real = await original<typeof import('../src/services/telegram')>();
  const isMain = () => real.currentToken() === 'test-bot-token';
  return {
  ...real,
  getBotInfo: async () => (isMain() ? { id: 111, username: 'main_bot' } : { id: BOT, username: 'store_bot' }),
  call: vi.fn(async (method: string, fields: Record<string, any>) => {
    tg.calls.push({ method, fields, token: real.currentToken() });
    if (method === 'sendMessage' && tg.failCreateButton && fields.reply_markup?.keyboard?.[0]?.[0]?.request_managed_bot) throw new Error('خطای تلگرام: Bad Request: BOT_MANAGEMENT_DISABLED');
    if (method === 'getMe') return { id: 111, username: 'main_bot', can_manage_bots: tg.canManage };
    if (method === 'getManagedBotToken') return tg.managedTokens[fields.user_id] ?? 'missing';
    if (method === 'getChatMember') {
      const m = tg.members[`${fields.chat_id}:${fields.user_id}`];
      if (!m) throw new Error('خطای تلگرام: Bad Request: user not found');
      return m;
    }
    if (method === 'getChat') return { id: fields.chat_id, type: 'channel', title: 'Shop Channel', username: 'shopchannel' };
    if (method === 'getChatMemberCount') return tg.counts[fields.chat_id] ?? 100;
    return { message_id: 1 };
  }),
  };
});

const BOT = 999;
const STORE_TOKEN = '999:store-token';
let storeBotId = 0;
/** Updates received by the store's own bot */
const handleChannelUpdate = (u: ChannelUpdate) => withBot({ token: STORE_TOKEN, botId: storeBotId }, () => handleAsBot(u));
const OWNER = 555;
const CHANNEL = -1001234567890;
const botAdmin = { status: 'administrator', user: { id: BOT }, can_post_messages: true, can_edit_messages: true, can_delete_messages: true };
const sent = (method: string) => tg.calls.filter((c) => c.method === method);
const lastText = () => sent('sendMessage').at(-1)?.fields.text as string;

const privateMsg = (from: number, extra: Record<string, unknown>) =>
  ({ message: { message_id: 1, from: { id: from, first_name: 'Owner' }, chat: { id: from, type: 'private' }, ...extra } });
const start = (from: number, url: string) => handleChannelUpdate(privateMsg(from, { text: `/start ${url.split('start=')[1]}` }));
const share = (from: number, requestId: number, chatId = CHANNEL) =>
  handleChannelUpdate(privateMsg(from, { chat_shared: { request_id: requestId, chat_id: chatId, title: 'Shop Channel' } }));
const botMembership = (from: number, status: string, chatId = CHANNEL) => handleChannelUpdate({
  my_chat_member: {
    chat: { id: chatId, type: 'channel', title: 'Shop Channel' }, from: { id: from },
    old_chat_member: { status: 'left', user: { id: BOT } },
    new_chat_member: status === 'administrator' ? botAdmin : { status, user: { id: BOT } },
  },
});

async function admin() {
  const a = await verifiedUser(); // first account = admin
  const [bot] = await query<{ id: number }>(
    `INSERT INTO telegram_bots (tg_bot_id, username, name, token_enc, created_by) VALUES ($1, 'store_bot', 'Store', $2, 1) RETURNING id`,
    [BOT, seal(STORE_TOKEN)],
  );
  storeBotId = bot.id;
  return a.b;
}

/** Runs the whole flow: panel link -> /start -> bot added -> channel picked */
async function connect(b: Awaited<ReturnType<typeof admin>>) {
  tg.members[`${CHANNEL}:${OWNER}`] = { status: 'creator', user: { id: OWNER } };
  tg.members[`${CHANNEL}:${BOT}`] = botAdmin;
  const link = (await b.post('/api/telegram/connect').send({ bot_id: storeBotId }).expect(201)).body;
  await start(OWNER, link.url);
  await botMembership(OWNER, 'administrator');
  await share(OWNER, link.id);
  return link;
}

beforeEach(async () => {
  await resetDb();
  tg.calls.length = 0;
  tg.members = {};
  tg.counts = {};
  tg.managedTokens = {};
  tg.canManage = true;
  tg.failCreateButton = false;
});
afterAll(() => pool.end());

describe('who can connect', () => {
  it('only the store admin, not members, anonymous visitors or the API key', async () => {
    await verifiedUser(); // admin
    const member = await verifiedUser();
    await member.b.post('/api/telegram/connect').send({ bot_id: 1 }).expect(403);
    await request(app).post('/api/telegram/connect').send({ bot_id: 1 }).expect(401);
    await request(app).post('/api/telegram/connect').set('x-api-key', 'test-api-key').send({ bot_id: 1 }).expect(403);
  });
});

describe('connect flow', () => {
  it('connects a channel and creates its publishing destination', async () => {
    const b = await admin();
    const link = (await b.post('/api/telegram/connect').send({ bot_id: storeBotId }).expect(201)).body;
    expect(link.url).toMatch(/^https:\/\/t\.me\/store_bot\?start=ch_[A-Za-z0-9_-]{32}$/);
    expect((await b.get(`/api/telegram/connect/${link.id}`)).body.status).toBe('pending');

    tg.members[`${CHANNEL}:${OWNER}`] = { status: 'creator', user: { id: OWNER } };
    tg.members[`${CHANNEL}:${BOT}`] = botAdmin;
    await start(OWNER, link.url);
    const button = sent('sendMessage').at(-1)!.fields.reply_markup.keyboard[0][0];
    expect(button.request_chat).toMatchObject({ request_id: link.id, chat_is_channel: true });
    expect(button.request_chat.bot_administrator_rights.can_post_messages).toBe(true);
    expect(sent('sendMessage').at(-1)!.token).toBe(STORE_TOKEN); // through the store's own bot
    expect((await b.get(`/api/telegram/connect/${link.id}`)).body.status).toBe('opened');

    await botMembership(OWNER, 'administrator');
    expect(sent('leaveChat')).toHaveLength(0); // added while connecting: allowed
    await share(OWNER, link.id);

    const status = (await b.get(`/api/telegram/connect/${link.id}`)).body;
    expect(status.status).toBe('connected');
    expect(status.channel).toMatchObject({ title: 'Shop Channel', username: 'shopchannel', status: 'active', member_count: 100 });

    const [dest] = await query<{ enabled: boolean; config: any }>(`SELECT * FROM destinations WHERE config ? 'tg_channel'`);
    expect(dest.enabled).toBe(true);
    expect(dest.config.chat_id).toBe(String(CHANNEL));
  });

  it('stores only a hash of the link token', async () => {
    const b = await admin();
    const link = (await b.post('/api/telegram/connect').send({ bot_id: storeBotId }).expect(201)).body;
    const token = link.url.split('ch_')[1];
    const rows = await query<{ token_hash: string }>(`SELECT token_hash FROM telegram_connect_requests`);
    expect(rows[0].token_hash).not.toContain(token);
  });

  it('a link works once', async () => {
    const b = await admin();
    const link = await connect(b);
    await start(OWNER, link.url);
    expect(lastText()).toMatch(/معتبر نیست/);
  });

  it('a link opened by one Telegram account cannot be used by another', async () => {
    const b = await admin();
    const link = (await b.post('/api/telegram/connect').send({ bot_id: storeBotId }).expect(201)).body;
    await start(OWNER, link.url);
    await start(777, link.url);
    expect(lastText()).toMatch(/معتبر نیست/);
    tg.members[`${CHANNEL}:777`] = { status: 'creator', user: { id: 777 } };
    tg.members[`${CHANNEL}:${BOT}`] = botAdmin;
    await share(777, link.id);
    expect((await query(`SELECT * FROM telegram_channels`)).length).toBe(0);
  });

  it('rejects an expired link', async () => {
    const b = await admin();
    const link = (await b.post('/api/telegram/connect').send({ bot_id: storeBotId }).expect(201)).body;
    await query(`UPDATE telegram_connect_requests SET expires_at = NOW() - INTERVAL '1 minute'`);
    await start(OWNER, link.url);
    expect(lastText()).toMatch(/معتبر نیست/);
    expect((await b.get(`/api/telegram/connect/${link.id}`)).body.status).toBe('expired');
  });

  it('refuses when the person is not an admin of the channel', async () => {
    const b = await admin();
    const link = (await b.post('/api/telegram/connect').send({ bot_id: storeBotId }).expect(201)).body;
    tg.members[`${CHANNEL}:${OWNER}`] = { status: 'member', user: { id: OWNER } };
    tg.members[`${CHANNEL}:${BOT}`] = botAdmin;
    await start(OWNER, link.url);
    await share(OWNER, link.id);
    expect((await b.get(`/api/telegram/connect/${link.id}`)).body.status).toBe('failed');
    expect((await query(`SELECT * FROM telegram_channels`)).length).toBe(0);
  });

  it('another admin cannot read the state of my link', async () => {
    const b = await admin();
    const link = (await b.post('/api/telegram/connect').send({ bot_id: storeBotId }).expect(201)).body;
    const other = await verifiedUser();
    await query(`UPDATE users SET role='admin' WHERE email=$1`, [other.email]);
    await other.b.get(`/api/telegram/connect/${link.id}`).expect(404);
  });

  it('the bot leaves channels it is added to outside the panel', async () => {
    await admin();
    await botMembership(4242, 'administrator', -1009999);
    expect(sent('leaveChat').map((c) => c.fields.chat_id)).toEqual([-1009999]);
  });
});

describe('monitoring', () => {
  it('records subscribers joining and leaving', async () => {
    const b = await admin();
    await connect(b);
    const member = (status: string, old: string) => handleChannelUpdate({
      chat_member: {
        chat: { id: CHANNEL, type: 'channel' }, from: { id: 1 },
        old_chat_member: { status: old, user: { id: 1 } },
        new_chat_member: { status, user: { id: 1, first_name: 'Sub', username: 'sub1' } },
      },
    });
    await member('member', 'left');
    await member('member', 'left');
    await member('left', 'member');
    const [ch] = (await b.get('/api/telegram/channels').expect(200)).body;
    expect(ch).toMatchObject({ member_count: 101, joins_7d: 2, leaves_7d: 1 });
    const details = (await b.get(`/api/telegram/channels/${ch.id}`).expect(200)).body;
    expect(details.events.map((e: any) => e.event)).toEqual(expect.arrayContaining(['join', 'leave']));
    expect(details.growth).toHaveLength(1);
  });

  it('records posts made in Telegram and their reactions', async () => {
    const b = await admin();
    await connect(b);
    await handleChannelUpdate({ channel_post: { message_id: 50, chat: { id: CHANNEL, type: 'channel' }, date: 1790000000, text: 'New arrivals' } });
    await handleChannelUpdate({
      message_reaction_count: {
        chat: { id: CHANNEL, type: 'channel' }, message_id: 50,
        reactions: [{ type: { type: 'emoji', emoji: '❤' }, total_count: 7 }, { type: { type: 'emoji', emoji: '👍' }, total_count: 3 }],
      },
    });
    const [ch] = (await b.get('/api/telegram/channels')).body;
    expect(ch).toMatchObject({ posts: 1, reactions: 10 });
    const { posts } = (await b.get(`/api/telegram/channels/${ch.id}`)).body;
    expect(posts[0]).toMatchObject({ message_id: '50', source: 'telegram', text: 'New arrivals', reactions_total: 10, reactions: { '❤': 7, '👍': 3 } });
  });

  it('ignores updates from channels that are not connected', async () => {
    await admin();
    await handleChannelUpdate({ channel_post: { message_id: 1, chat: { id: -100555, type: 'channel' }, text: 'x' } });
    expect((await query(`SELECT * FROM telegram_posts`)).length).toBe(0);
  });

  it('notices when the bot is removed from the channel and stops publishing there', async () => {
    const b = await admin();
    await connect(b);
    await botMembership(OWNER, 'left');
    const [ch] = (await b.get('/api/telegram/channels')).body;
    expect(ch.status).toBe('removed');
    const [dest] = await query<{ enabled: boolean }>(`SELECT enabled FROM destinations WHERE id=$1`, [ch.destination_id]);
    expect(dest.enabled).toBe(false);
  });

  it('notices when the bot loses the right to post', async () => {
    const b = await admin();
    await connect(b);
    await handleChannelUpdate({
      my_chat_member: {
        chat: { id: CHANNEL, type: 'channel' }, from: { id: OWNER },
        old_chat_member: botAdmin, new_chat_member: { ...botAdmin, can_post_messages: false },
      },
    });
    expect((await b.get('/api/telegram/channels')).body[0].status).toBe('restricted');
  });
});

describe('disconnect', () => {
  it('removes the bot, disables the destination and keeps the history', async () => {
    const b = await admin();
    await connect(b);
    const [ch] = (await b.get('/api/telegram/channels')).body;
    const res = await b.post(`/api/telegram/channels/${ch.id}/disconnect`).expect(200);
    expect(res.body.status).toBe('disconnected');
    expect(sent('leaveChat').map((c) => c.fields.chat_id)).toEqual([String(CHANNEL)]);
    const [dest] = await query<{ enabled: boolean }>(`SELECT enabled FROM destinations WHERE id=$1`, [ch.destination_id]);
    expect(dest.enabled).toBe(false);

    // re-adding the bot by hand afterwards is not enough
    await botMembership(OWNER, 'administrator');
    expect(sent('leaveChat')).toHaveLength(2);
  });

  it('members cannot disconnect a channel', async () => {
    const b = await admin();
    await connect(b);
    const [ch] = (await b.get('/api/telegram/channels')).body;
    const member = await verifiedUser();
    await member.b.post(`/api/telegram/channels/${ch.id}/disconnect`).expect(403);
  });

  it('can be connected again through the panel, reusing the same destination', async () => {
    const b = await admin();
    await connect(b);
    const [ch] = (await b.get('/api/telegram/channels')).body;
    await b.post(`/api/telegram/channels/${ch.id}/disconnect`).expect(200);
    await connect(b);
    const [again] = (await b.get('/api/telegram/channels')).body;
    expect(again).toMatchObject({ id: ch.id, status: 'active', destination_id: ch.destination_id });
    expect((await query(`SELECT * FROM destinations WHERE config ? 'tg_channel'`)).length).toBe(1);
  });
});

describe("store's own bot", () => {
  const NEW_BOT = { id: 4242, is_bot: true, username: 'my_shop_bot', first_name: 'My Shop' };
  /** Updates received by the platform's main bot */
  const toMain = (u: Parameters<typeof handleManagerUpdate>[0]) => handleManagerUpdate(u);
  const startMain = (from: number, url: string) => toMain(privateMsg(from, { text: `/start ${url.split('start=')[1]}` }) as never);

  it('only the store admin can create it', async () => {
    await verifiedUser();
    const member = await verifiedUser();
    await member.b.post('/api/telegram/bots/create').expect(403);
    await request(app).post('/api/telegram/bots/create').set('x-api-key', 'test-api-key').expect(403);
  });

  it('is created through the main bot and its token is stored encrypted', async () => {
    const { b } = await verifiedUser();
    const link = (await b.post('/api/telegram/bots/create').expect(201)).body;
    expect(link.url).toMatch(/^https:\/\/t\.me\/main_bot\?start=bot_[A-Za-z0-9_-]{32}$/);

    await startMain(OWNER, link.url);
    const msg = sent('sendMessage').at(-1)!;
    expect(msg.token).toBe('test-bot-token');
    const button = msg.fields.reply_markup.keyboard[0][0].request_managed_bot;
    expect(button).toMatchObject({ request_id: link.id, suggested_name: 'فروشگاه من' });
    expect(button.suggested_username).toMatch(/^[a-z0-9_]{5,32}$/);
    expect(button.suggested_username).toMatch(/bot$/);
    expect((await b.get(`/api/telegram/bots/create/${link.id}`)).body.status).toBe('opened');

    tg.managedTokens[NEW_BOT.id] = '4242:SECRET-TOKEN';
    await toMain({ managed_bot: { user: { id: OWNER }, bot: NEW_BOT } });
    await toMain(privateMsg(OWNER, { managed_bot_created: { bot: NEW_BOT } }) as never);

    expect(sent('setManagedBotAccessSettings').at(-1)!.fields).toEqual({ user_id: NEW_BOT.id, is_access_restricted: false });
    expect(lastText()).toMatch(/@my_shop_bot/);
    const status = (await b.get(`/api/telegram/bots/create/${link.id}`)).body;
    expect(status.status).toBe('created');
    expect(status.bot).toMatchObject({ username: 'my_shop_bot', name: 'My Shop', status: 'active' });
    expect(JSON.stringify(status)).not.toContain('SECRET-TOKEN');

    const { bots } = (await b.get('/api/telegram/bot').expect(200)).body;
    expect(bots).toHaveLength(1);
    expect(JSON.stringify(bots)).not.toMatch(/SECRET-TOKEN|token_enc/);
    const [row] = await query<{ token_enc: string }>(`SELECT token_enc FROM telegram_bots`);
    expect(row.token_enc).not.toContain('SECRET-TOKEN');
    expect(open(row.token_enc)).toBe('4242:SECRET-TOKEN');
  });

  it('shows a failure in the panel when Telegram refuses the create button', async () => {
    const { b } = await verifiedUser();
    tg.canManage = false;
    expect((await b.get('/api/telegram/bot')).body.can_create_bots).toBe(false);
    const link = (await b.post('/api/telegram/bots/create').expect(201)).body;
    tg.failCreateButton = true;
    await startMain(OWNER, link.url);
    expect((await b.get(`/api/telegram/bots/create/${link.id}`)).body.status).toBe('failed');
  });

  it('ignores bots made through the main bot outside the panel', async () => {
    await verifiedUser();
    tg.managedTokens[NEW_BOT.id] = '4242:SECRET-TOKEN';
    await toMain({ managed_bot: { user: { id: OWNER }, bot: NEW_BOT } });
    expect(sent('getManagedBotToken')).toHaveLength(0);
    expect((await query(`SELECT * FROM telegram_bots`)).length).toBe(0);
  });

  it('a link opened by one Telegram account cannot be used by another', async () => {
    const { b } = await verifiedUser();
    const link = (await b.post('/api/telegram/bots/create').expect(201)).body;
    await startMain(OWNER, link.url);
    await startMain(777, link.url);
    expect(lastText()).toMatch(/معتبر نیست/);
    tg.managedTokens[NEW_BOT.id] = '4242:SECRET-TOKEN';
    await toMain({ managed_bot: { user: { id: 777 }, bot: NEW_BOT } });
    expect((await query(`SELECT * FROM telegram_bots`)).length).toBe(0);
  });

  it('picks up a new token when it changes in Telegram', async () => {
    const { b } = await verifiedUser();
    const link = (await b.post('/api/telegram/bots/create').expect(201)).body;
    await startMain(OWNER, link.url);
    tg.managedTokens[NEW_BOT.id] = '4242:FIRST';
    await toMain({ managed_bot: { user: { id: OWNER }, bot: NEW_BOT } });
    tg.managedTokens[NEW_BOT.id] = '4242:SECOND';
    await toMain({ managed_bot: { user: { id: OWNER }, bot: NEW_BOT } });
    const rows = await query<{ token_enc: string }>(`SELECT token_enc FROM telegram_bots`);
    expect(rows).toHaveLength(1);
    expect(open(rows[0].token_enc)).toBe('4242:SECOND');
  });

  it('store bots do not act as the manager', async () => {
    await admin();
    const handled = await withBot({ token: STORE_TOKEN, botId: storeBotId }, () =>
      handleManagerUpdate({ managed_bot: { user: { id: OWNER }, bot: NEW_BOT } }));
    expect(handled).toBe(false);
  });

  it('a channel only answers to the bot that was added to it', async () => {
    const b = await admin();
    await connect(b);
    // the same channel seen through the main bot is not this store's channel
    await handleAsBot({ channel_post: { message_id: 7, chat: { id: CHANNEL, type: 'channel' }, text: 'x' } });
    expect((await query(`SELECT * FROM telegram_posts`)).length).toBe(0);
  });

  it('a channel link needs one of the store bots', async () => {
    const b = await admin();
    await b.post('/api/telegram/connect').send({ bot_id: 9999 }).expect(404);
  });
});
