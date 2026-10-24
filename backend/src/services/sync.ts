import { config } from '../config';
import { query } from '../db/pool';
import type { Product, ProductChange } from './products';
import { runOperation } from './operations';
import { getSetting } from './settings';
import type { Kind } from './templates';

/** Decides which kind of message a set of changes deserves (or null if none) */
export function kindForChanges(changes: ProductChange[]): { kind: Kind; oldPrice?: string | null } | null {
  const get = (f: string) => changes.find((c) => c.field === f);
  const disc = get('discount_price');
  const stock = get('stock');
  const price = get('price');
  if (disc && disc.new_value && (!disc.old_value || Number(disc.new_value) < Number(disc.old_value))) return { kind: 'discount' };
  if (stock && Number(stock.old_value || 0) === 0 && Number(stock.new_value || 0) > 0) return { kind: 'restock' };
  if (price) return { kind: 'price_change', oldPrice: price.old_value };
  return null;
}

/**
 * Called whenever price / stock / details of a product change.
 *  - If N8N_WEBHOOK_URL is set, the change is sent to n8n, which runs the
 *    "product changed" workflow.
 *  - Otherwise, if auto-generation is enabled, content is generated for every
 *    platform that has an active destination.
 * Generated content always waits for human approval before publishing.
 */
export async function onProductChanged(product: Product, changes: ProductChange[]) {
  const ids = (
    await query<{ id: number }>(`SELECT id FROM product_changes WHERE product_id=$1 AND processed=FALSE ORDER BY id`, [product.id])
  ).map((r) => r.id);
  const decision = kindForChanges(changes);

  if (config.n8nWebhookUrl) {
    await notifyN8n({ event: 'product.changed', product, changes, changeIds: ids, kind: decision?.kind ?? null });
    return;
  }

  if (decision && (await getSetting('auto_generate_on_change', 'true')) === 'true') {
    // lazy import to avoid a circular import (content -> products -> sync)
    const { autoTargets, generateContents } = await import('./content');
    const targets = await autoTargets();
    if (targets.length) {
      await generateContents({ productId: product.id, kind: decision.kind, targets, oldPrice: decision.oldPrice });
    }
  }
  await query(`UPDATE product_changes SET processed=TRUE WHERE id = ANY($1::int[])`, [ids]);
}

export async function notifyN8n(payload: Record<string, unknown>, operationId?: number) {
  return runOperation(
    'notify_n8n',
    payload,
    async () => {
      const res = await fetch(config.n8nWebhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`n8n webhook error ${res.status}`);
      return `n8n notified (${res.status})`;
    },
    operationId,
  );
}
