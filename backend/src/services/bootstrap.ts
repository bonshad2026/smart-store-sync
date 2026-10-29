import { query } from '../db/pool';
import { listPlatforms, seedTemplatesFor } from './platforms';
import { getSetting } from './settings';
import { seedDemoData } from './demo';
import { seedInteractions } from './interactions';

/** One-time data setup after migrations (idempotent) */
export async function bootstrap() {
  // 1) starter templates for platforms that have none
  for (const p of await listPlatforms()) {
    if (!p.templates_count) await seedTemplatesFor(p);
  }

  // 2) migrate the single Telegram channel of v0.1 (settings) into a destination
  const tg = (await query<{ id: number }>(`SELECT id FROM platforms WHERE key='telegram'`))[0];
  const hasTgDest = (await query(`SELECT 1 FROM destinations WHERE platform_id=$1 LIMIT 1`, [tg.id])).length > 0;
  const chatId = await getSetting('telegram_chat_id');
  if (!hasTgDest && chatId && !chatId.includes('your_channel')) {
    await query(`INSERT INTO destinations (platform_id, name, config) VALUES ($1, 'کانال اصلی', $2)`, [
      tg.id,
      JSON.stringify({ chat_id: chatId }),
    ]);
    console.log(`✔ Telegram channel ${chatId} added as a destination`);
  }

  // 3) ready-made interactions (review, order, payment, ...)
  await seedInteractions().catch((e) => console.error('interactions seed failed:', e.message));

  // 4) demo data (once) so charts and history are not empty
  await seedDemoData().catch((e) => console.error('demo seed failed:', e.message));
}
