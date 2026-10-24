import { parse } from 'csv-parse/sync';
import { productInputSchema, upsertProduct } from './products';
import { runOperation } from './operations';

export interface ImportResult {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  changes: number;
  errors: { row: number; sku?: string; error: string }[];
}

/**
 * Imports products from a CSV file.
 * Expected header: sku,name,description,price,discount_price,stock,category,image_url
 * Extra columns are stored in `attributes` (e.g. color, size, brand).
 */
export async function importCsv(buffer: Buffer, source = 'csv'): Promise<ImportResult> {
  return runOperation('import_csv', { source, bytes: buffer.length }, async () => {
    const text = buffer.toString('utf8').replace(/^﻿/, ''); // strip Excel BOM
    const records = parse(text, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
    const known = ['sku', 'name', 'description', 'price', 'discount_price', 'stock', 'category', 'image_url'];
    const result: ImportResult = { total: records.length, created: 0, updated: 0, unchanged: 0, changes: 0, errors: [] };

    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const attributes: Record<string, string> = {};
      for (const [k, v] of Object.entries(r)) if (!known.includes(k) && v) attributes[k] = v;

      const parsed = productInputSchema.safeParse({
        ...r,
        price: toNumber(r.price),
        discount_price: r.discount_price ? toNumber(r.discount_price) : null,
        stock: toNumber(r.stock),
        attributes,
      });
      if (!parsed.success) {
        result.errors.push({ row: i + 2, sku: r.sku, error: parsed.error.issues.map((x) => x.message).join('، ') });
        continue;
      }
      const res = await upsertProduct(parsed.data, source);
      if (res.created) result.created++;
      else if (res.changes.length) {
        result.updated++;
        result.changes += res.changes.length;
      } else result.unchanged++;
    }
    return result;
  });
}

/** Accepts Persian/Arabic digits and thousand separators: «۴۵۰٬۰۰۰» -> 450000 */
export function toNumber(v: string | undefined): number {
  if (!v) return 0;
  const latin = v
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[,٬\s]/g, '');
  return Number(latin);
}
