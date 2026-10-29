import { config } from '../config';
import { handleUpdate } from './feedback';
import { getSetting, saveSettings } from './settings';
import { BotContext, call, withBot } from './telegram';
import { activeBotIds, botContext, getBotOffset, handleManagerUpdate, markBotError, saveBotOffset, setBotReadyHook } from './telegramBots';
import { CHANNEL_UPDATES } from './telegramChannels';

/**
 * Long polling (getUpdates) for the platform's main bot and for every store bot, so no public HTTPS
 * address is needed. Each update is handled inside the context of the bot that received it.
 */

interface Update { update_id: number }

const COMMON = ['message', 'callback_query', ...CHANNEL_UPDATES];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const running = new Map<number, { stop: boolean }>(); // store bot id -> loop

async function loop(opts: {
  name: string;
  ctx: BotContext;
  allowed: string[];
  offset: () => Promise<number>;
  save: (offset: number) => Promise<unknown>;
  handle: (u: Update) => Promise<unknown>;
  stopped: () => boolean;
  onUnauthorized?: (message: string) => Promise<void>;
}) {
  let offset = await opts.offset();
  console.log(`✔ Telegram polling started: ${opts.name}`);
  while (!opts.stopped()) {
    try {
      const updates = (await withBot(opts.ctx, () =>
        call('getUpdates', { offset, timeout: 20, allowed_updates: opts.allowed }))) as unknown as Update[];
      for (const u of updates) {
        offset = u.update_id + 1;
        await withBot(opts.ctx, () => opts.handle(u)).catch((e) => console.error(`${opts.name} update failed:`, (e as Error).message));
      }
      if (updates.length) await opts.save(offset);
    } catch (e) {
      const m = (e as Error).message;
      if (/Unauthorized|401/.test(m) && opts.onUnauthorized) return opts.onUnauthorized(m);
      // 409 = a webhook is set or another poller runs; back off quietly
      console.error(`${opts.name} polling:`, m.slice(0, 160));
      await sleep(/409|Conflict/.test(m) ? 60000 : 15000);
    }
  }
}

/** The main bot: managed-bot creation plus anything sent through it (older channels, admin chat) */
function startMainBot() {
  let started = false;
  return () => {
    if (started || !config.telegram.botToken) return;
    started = true;
    loop({
      name: 'main bot',
      ctx: { token: config.telegram.botToken },
      allowed: [...COMMON, 'managed_bot'],
      offset: async () => Number(await getSetting('tg_update_offset', '0')) || 0,
      save: (offset) => saveSettings({ tg_update_offset: String(offset) }),
      handle: async (u) => (await handleManagerUpdate(u as never)) || handleUpdate(u as never),
      stopped: () => false,
    }).catch((e) => console.error('main bot polling:', e.message));
  };
}

/** Starts (or restarts, after a token change) polling for one store bot */
export async function startStoreBot(botId: number) {
  const previous = running.get(botId);
  if (previous) previous.stop = true;
  const state = { stop: false };
  running.set(botId, state);
  const ctx = await botContext(botId);
  loop({
    name: `store bot #${botId}`,
    ctx,
    allowed: COMMON,
    offset: () => getBotOffset(botId),
    save: (offset) => saveBotOffset(botId, offset),
    handle: (u) => handleUpdate(u as never),
    stopped: () => state.stop,
    onUnauthorized: (m) => markBotError(botId, `توکن ربات نامعتبر است (${m.slice(0, 80)})`),
  }).catch((e) => console.error(`store bot #${botId} polling:`, e.message));
}

export const startMainPolling = startMainBot();

/** Main bot + every active store bot; new bots start as soon as they are created */
export async function startTelegramPolling() {
  if (process.env.FEEDBACK_POLLING === 'false') return;
  setBotReadyHook((id) => void startStoreBot(id).catch((e) => console.error('store bot start:', e.message)));
  startMainPolling();
  for (const id of await activeBotIds()) await startStoreBot(id).catch((e) => console.error('store bot start:', e.message));
}
