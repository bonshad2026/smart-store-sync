import { z } from 'zod';
import { pool, query } from '../db/pool';
import { onProductChanged } from './sync';

export const productInputSchema = z.object({
  sku: z.string().trim().min(1, 'کد کالا (SKU) الزامی است'),
  name: z.string().trim().min(1, 'نام محصول الزامی است'),
  description: z.string().optional().default(''),
  price: z.coerce.number().nonnegative('قیمت نمی‌تواند منفی باشد'),
  discount_price: z
    .union([z.null(), z.literal(''), z.coerce.number().nonnegative('قیمت تخفیفی نمی‌تواند منفی باشد')])
    .optional()
    .transform((v) => (v === '' || v === undefined || v === null ? null : v)),
  stock: z.coerce.number().int('موجودی باید عدد صحیح باشد').nonnegative('موجودی نمی‌تواند منفی باشد'),
  category: z.string().optional().default(''),
  image_url: z.string().optional().default(''),
  images: z.array(z.string()).optional(),
  attributes: z.record(z.any()).optional().default({}),
  is_active: z.boolean().optional().default(true),
});

export type ProductInput = z.infer<typeof productInputSchema>;

export interface Product extends Omit<ProductInput, 'images'> {
  id: number;
  images: string[];
  source: string;
  created_at: string;
  updated_at: string;
}

export interface ProductChange {
  field: string;
  old_value: string | null;
  new_value: string | null;
}

/** Fields whose changes are tracked and synced to connected channels */
const TRACKED_FIELDS = ['name', 'description', 'price', 'discount_price', 'stock'] as const;

function norm(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return String(v);
  const n = Number(v);
  // pg returns NUMERIC as string ("450000") - normalize numeric strings
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(n) && /^-?\d+(\.\d+)?$/.test(v.trim())) {
    return String(n);
  }
  return String(v);
}

export function diffProduct(oldP: Partial<Product> | undefined, newP: ProductInput): ProductChange[] {
  if (!oldP) return [];
  const changes: ProductChange[] = [];
  for (const f of TRACKED_FIELDS) {
    const a = norm(oldP[f]);
    const b = norm(newP[f]);
    if (a !== b) changes.push({ field: f, old_value: a, new_value: b });
  }
  return changes;
}

/** Keeps `images` and the main `image_url` consistent */
function resolveImages(input: ProductInput, existing?: Product): string[] {
  let images = [...(input.images ?? existing?.images ?? [])].filter(Boolean);
  if (input.image_url && !images.includes(input.image_url)) images = [input.image_url, ...images];
  return Array.from(new Set(images));
}

export interface UpsertResult {
  product: Product;
  created: boolean;
  changes: ProductChange[];
}

/**
 * Creates or updates a product (matched by SKU), detects changes in
 * price / stock / details, stores them in product_changes and triggers sync.
 */
export async function upsertProduct(input: ProductInput, source = 'manual', triggerSync = true): Promise<UpsertResult> {
  const client = await pool.connect();
  let result: UpsertResult;
  try {
    await client.query('BEGIN');
    const existing = (await client.query(`SELECT * FROM products WHERE sku=$1 FOR UPDATE`, [input.sku])).rows[0] as
      | Product
      | undefined;

    const images = resolveImages(input, existing);
    const mainImage = images[0] || '';
    if (!existing) {
      const row = (
        await client.query(
          `INSERT INTO products (sku,name,description,price,discount_price,stock,category,image_url,attributes,is_active,source,images)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [
            input.sku, input.name, input.description, input.price, input.discount_price, input.stock,
            input.category, mainImage, JSON.stringify(input.attributes), input.is_active, source, JSON.stringify(images),
          ],
        )
      ).rows[0];
      result = { product: row, created: true, changes: [] };
    } else {
      const changes = diffProduct(existing, input);
      const row = (
        await client.query(
          `UPDATE products SET name=$2, description=$3, price=$4, discount_price=$5, stock=$6, category=$7,
             image_url=$8, attributes=$9, is_active=$10, images=$11, updated_at=NOW()
           WHERE sku=$1 RETURNING *`,
          [
            input.sku, input.name, input.description, input.price, input.discount_price, input.stock,
            input.category, mainImage, JSON.stringify(input.attributes), input.is_active, JSON.stringify(images),
          ],
        )
      ).rows[0];
      for (const c of changes) {
        await client.query(
          `INSERT INTO product_changes (product_id, field, old_value, new_value, source) VALUES ($1,$2,$3,$4,$5)`,
          [row.id, c.field, c.old_value, c.new_value, source],
        );
      }
      result = { product: row, created: false, changes };
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (triggerSync && result.changes.length > 0) {
    // Fire-and-forget: failures are logged in `operations` and can be retried
    onProductChanged(result.product, result.changes).catch((e) => console.error('sync error:', e.message));
  }
  return result;
}

export async function listProducts(search = '', category = ''): Promise<Product[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(name ILIKE $${params.length} OR sku ILIKE $${params.length} OR category ILIKE $${params.length})`);
  }
  if (category) {
    params.push(category);
    where.push(`category = $${params.length}`);
  }
  return query<Product>(
    `SELECT * FROM products ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC`,
    params,
  );
}

export async function listCategories(): Promise<{ category: string; count: number }[]> {
  return query(
    `SELECT category, COUNT(*)::int AS count FROM products WHERE category <> '' GROUP BY category ORDER BY count DESC`,
  );
}

/** Replaces the gallery (first image = main image) */
export async function setProductImages(id: number, images: string[]): Promise<Product | undefined> {
  const clean = Array.from(new Set(images.filter(Boolean)));
  return (
    await query<Product>(
      `UPDATE products SET images=$2, image_url=$3, updated_at=NOW() WHERE id=$1 RETURNING *`,
      [id, JSON.stringify(clean), clean[0] || ''],
    )
  )[0];
}

export async function getProduct(id: number): Promise<Product | undefined> {
  return (await query<Product>(`SELECT * FROM products WHERE id=$1`, [id]))[0];
}

export async function deleteProduct(id: number): Promise<boolean> {
  const rows = await query(`DELETE FROM products WHERE id=$1 RETURNING id`, [id]);
  return rows.length > 0;
}

export async function listChanges(limit = 100, onlyUnprocessed = false, productId?: number) {
  const where: string[] = [];
  const params: unknown[] = [limit];
  if (onlyUnprocessed) where.push('c.processed = FALSE');
  if (productId) {
    params.push(productId);
    where.push(`c.product_id = $${params.length}`);
  }
  return query(
    `SELECT c.*, p.name AS product_name, p.sku, p.image_url FROM product_changes c
     JOIN products p ON p.id = c.product_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY c.id DESC LIMIT $1`,
    params,
  );
}

export async function markChangesProcessed(ids: number[]) {
  if (!ids.length) return;
  await query(`UPDATE product_changes SET processed=TRUE WHERE id = ANY($1::int[])`, [ids]);
}
