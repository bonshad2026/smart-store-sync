import { query } from '../db/pool';

export type OperationType = 'import_csv' | 'generate_content' | 'publish' | 'publish_telegram' | 'sync' | 'notify_n8n';

export interface Operation {
  id: number;
  type: OperationType;
  status: 'success' | 'failed' | 'retrying';
  payload: Record<string, unknown>;
  message: string;
  attempts: number;
  created_at: string;
  updated_at: string;
}

/**
 * Runs `fn` and records the result in the `operations` table.
 * If it fails, the operation is stored as `failed` so it can be retried later
 * from the dashboard or by the n8n retry workflow.
 */
export async function runOperation<T>(
  type: OperationType,
  payload: Record<string, unknown>,
  fn: () => Promise<T>,
  existingId?: number,
): Promise<T> {
  try {
    const result = await fn();
    await record(type, payload, 'success', summarize(result), existingId);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await record(type, payload, 'failed', message, existingId);
    throw err;
  }
}

async function record(
  type: OperationType,
  payload: Record<string, unknown>,
  status: 'success' | 'failed',
  message: string,
  existingId?: number,
) {
  if (existingId) {
    await query(
      `UPDATE operations SET status=$1, message=$2, attempts=attempts+1, updated_at=NOW() WHERE id=$3`,
      [status, message, existingId],
    );
  } else {
    await query(`INSERT INTO operations (type, status, payload, message) VALUES ($1,$2,$3,$4)`, [
      type,
      status,
      JSON.stringify(payload),
      message,
    ]);
  }
}

function summarize(result: unknown): string {
  if (result === undefined || result === null) return 'OK';
  if (typeof result === 'string') return result.slice(0, 500);
  try {
    return JSON.stringify(result).slice(0, 500);
  } catch {
    return 'OK';
  }
}

export async function listOperations(status?: string, limit = 100): Promise<Operation[]> {
  if (status) {
    return query<Operation>(`SELECT * FROM operations WHERE status=$1 ORDER BY id DESC LIMIT $2`, [status, limit]);
  }
  return query<Operation>(`SELECT * FROM operations ORDER BY id DESC LIMIT $1`, [limit]);
}

export async function getOperation(id: number): Promise<Operation | undefined> {
  const rows = await query<Operation>(`SELECT * FROM operations WHERE id=$1`, [id]);
  return rows[0];
}
