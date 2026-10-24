import { config } from '../config';
import { query } from '../db/pool';
import { generateContents, GenerateRequest, processPublication } from './content';
import { getOperation, listOperations } from './operations';
import { notifyN8n } from './sync';

/** Retries one failed operation, based on its type and stored payload. */
export async function retryOperation(id: number) {
  const op = await getOperation(id);
  if (!op) throw new Error(`عملیات ${id} یافت نشد`);
  if (op.status === 'success') return { skipped: true, reason: 'already successful' };
  if (op.attempts >= config.maxRetries + 1) throw new Error(`حداکثر تعداد تلاش (${config.maxRetries}) انجام شده است`);

  await query(`UPDATE operations SET status='retrying', updated_at=NOW() WHERE id=$1`, [id]);
  const p = op.payload as Record<string, any>;
  switch (op.type) {
    case 'publish':
      return processPublication(Number(p.publicationId), id);
    case 'generate_content':
      if (!Array.isArray(p.targets)) break; // created by an older version
      return generateContents(p as GenerateRequest, id);
    case 'notify_n8n':
      return notifyN8n(p, id);
  }
  await query(`UPDATE operations SET status='failed', updated_at=NOW() WHERE id=$1`, [id]);
  throw new Error(`این عملیات قابل تلاش مجدد خودکار نیست`);
}

/** Retries all failed operations that still have attempts left (used by n8n retry workflow). */
export async function retryAllFailed() {
  const failed = await listOperations('failed', 50);
  const results = [];
  for (const op of failed) {
    if (op.attempts >= config.maxRetries + 1) continue;
    if (!['publish', 'generate_content', 'notify_n8n'].includes(op.type)) continue;
    try {
      await retryOperation(op.id);
      results.push({ id: op.id, ok: true });
    } catch (e) {
      results.push({ id: op.id, ok: false, error: (e as Error).message });
    }
  }
  return results;
}
