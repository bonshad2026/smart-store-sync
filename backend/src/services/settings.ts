import { query } from '../db/pool';

export async function getSettings(): Promise<Record<string, string>> {
  const rows = await query<{ key: string; value: string }>(`SELECT key, value FROM settings`);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function getSetting(key: string, fallback = ''): Promise<string> {
  const rows = await query<{ value: string }>(`SELECT value FROM settings WHERE key=$1`, [key]);
  return rows[0]?.value ?? fallback;
}

export async function saveSettings(values: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(values)) {
    await query(
      `INSERT INTO settings (key, value, updated_at) VALUES ($1,$2,NOW())
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,
      [key, String(value)],
    );
  }
}
