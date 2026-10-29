import { config } from './config';
import { createApp } from './app';
import { migrate } from './db/migrate';
import { bootstrap } from './services/bootstrap';
import { startTelegramPolling } from './services/telegramPolling';
import { cleanupAuth } from './services/auth';
import { publishDue } from './services/content';
import { refreshAllChannels } from './services/telegramChannels';

const app = createApp();

async function start() {
  await migrate();
  await bootstrap();
  app.listen(config.port, () => console.log(`🚀 Smart Store Sync API: http://localhost:${config.port}/api`));

  // Built-in scheduler: publishes approved content when its scheduled time arrives.
  // (n8n can do the same by calling POST /api/contents/publish-due)
  const interval = Number(process.env.SCHEDULER_INTERVAL_SEC || 60);
  if (interval > 0) {
    setInterval(() => {
      publishDue()
        .then((r) => r.length && console.log('scheduler published:', r))
        .catch((e) => console.error('scheduler error:', e.message));
    }, interval * 1000);
  }

  // Hourly: delete accounts that never verified their e-mail, expired sessions and links
  const cleanup = () =>
    cleanupAuth()
      .then((n) => n && console.log(`auth cleanup: removed ${n} unverified account(s)`))
      .catch((e) => console.error('auth cleanup error:', e.message));
  cleanup();
  setInterval(cleanup, 60 * 60 * 1000);

  // Hourly: subscriber counts and bot rights of connected Telegram channels
  if (config.telegram.botToken) {
    const refresh = () => refreshAllChannels().catch((e) => console.error('telegram channels:', e.message));
    refresh();
    setInterval(refresh, 60 * 60 * 1000);
  }

  // Telegram updates for the main bot and the stores' own bots (set FEEDBACK_POLLING=false to disable)
  startTelegramPolling().catch((e) => console.error('telegram polling:', e.message));
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
