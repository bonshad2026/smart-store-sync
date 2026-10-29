import { z } from 'zod';
import { query } from '../db/pool';
import { LinkItem, linksSchema, MediaItem, mediaSchema, ProductMediaMode, productMediaSchema } from './media';
import { builtinTemplate, Kind, KIND_KEYS } from './templates';

export const DELIVERY_TYPES = ['telegram', 'instagram', 'email', 'webhook', 'manual'] as const;
export type Delivery = (typeof DELIVERY_TYPES)[number];

export interface Platform {
  id: number;
  key: string;
  name: string;
  icon: string;
  color: string;
  delivery: Delivery;
  max_length: number | null;
  style_guide: string;
  is_builtin: boolean;
  enabled: boolean;
  sort_order: number;
  destinations_count?: number;
  templates_count?: number;
}

export interface Destination {
  id: number;
  platform_id: number;
  name: string;
  config: Record<string, any>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
  platform_key?: string;
  platform_name?: string;
  platform_color?: string;
  platform_icon?: string;
  delivery?: Delivery;
}

export interface Template {
  id: number;
  platform_id: number;
  destination_id: number | null;
  kind: Kind;
  name: string;
  title: string;
  body: string;
  is_default: boolean;
  created_at: string;
  media: MediaItem[];
  links: LinkItem[];
  product_media: ProductMediaMode;
}

// ---------------------------------------------------------------- platforms

export const platformInputSchema = z.object({
  name: z.string().trim().min(1, 'نام شبکه الزامی است'),
  icon: z.string().trim().default('globe'),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{3,8}$/, 'رنگ نامعتبر است').default('#6366f1'),
  delivery: z.enum(DELIVERY_TYPES).default('manual'),
  max_length: z.coerce.number().int().positive().nullable().optional(),
  style_guide: z.string().default(''),
  enabled: z.boolean().default(true),
});

export async function listPlatforms(): Promise<Platform[]> {
  return query<Platform>(`
    SELECT p.*,
      (SELECT COUNT(*) FROM destinations d WHERE d.platform_id = p.id)::int AS destinations_count,
      (SELECT COUNT(*) FROM content_templates t WHERE t.platform_id = p.id)::int AS templates_count
    FROM platforms p ORDER BY p.sort_order, p.id`);
}

export async function getPlatform(id: number): Promise<Platform | undefined> {
  return (await query<Platform>(`SELECT * FROM platforms WHERE id=$1`, [id]))[0];
}

export async function getPlatformByKey(key: string): Promise<Platform | undefined> {
  return (await query<Platform>(`SELECT * FROM platforms WHERE key=$1`, [key]))[0];
}

function slugify(name: string): string {
  const latin = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `custom-${latin || 'net'}-${Date.now().toString(36)}`;
}

export async function createPlatform(input: z.infer<typeof platformInputSchema>): Promise<Platform> {
  const p = (
    await query<Platform>(
      `INSERT INTO platforms (key, name, icon, color, delivery, max_length, style_guide, enabled, is_builtin, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,FALSE,100) RETURNING *`,
      [slugify(input.name), input.name, input.icon, input.color, input.delivery, input.max_length ?? null, input.style_guide, input.enabled],
    )
  )[0];
  await seedTemplatesFor(p);
  return p;
}

export async function updatePlatform(id: number, input: Partial<z.infer<typeof platformInputSchema>>) {
  const current = await getPlatform(id);
  if (!current) return undefined;
  const next = { ...current, ...input };
  // Built-in platforms keep their delivery type (except website/instagram, which may switch to webhook/manual)
  if (current.is_builtin && ['telegram', 'email', 'sms'].includes(current.key)) next.delivery = current.delivery;
  return (
    await query<Platform>(
      `UPDATE platforms SET name=$2, icon=$3, color=$4, delivery=$5, max_length=$6, style_guide=$7, enabled=$8
       WHERE id=$1 RETURNING *`,
      [id, next.name, next.icon, next.color, next.delivery, next.max_length ?? null, next.style_guide, next.enabled],
    )
  )[0];
}

export async function deletePlatform(id: number) {
  const p = await getPlatform(id);
  if (!p) return false;
  if (p.is_builtin) throw Object.assign(new Error('شبکه‌های پیش‌فرض قابل حذف نیستند؛ می‌توانید آن را غیرفعال کنید'), { status: 400 });
  await query(`DELETE FROM platforms WHERE id=$1`, [id]);
  return true;
}

// ------------------------------------------------------------- destinations

const SECRET_KEYS = ['password', 'pass', 'token', 'api_key', 'apikey', 'secret', 'authorization'];
export const MASK = '••••••••';
const isSecret = (k: string) => SECRET_KEYS.some((s) => k.toLowerCase().includes(s));

/** Hides secrets (passwords, tokens) before sending a destination to the browser */
export function maskConfig(config: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(config || {}).map(([k, v]) => [k, isSecret(k) && v ? MASK : v]));
}

export const destinationInputSchema = z.object({
  platform_id: z.coerce.number().int().positive(),
  name: z.string().trim().min(1, 'نام مقصد الزامی است'),
  config: z.record(z.any()).default({}),
  enabled: z.boolean().default(true),
});

const DEST_SELECT = `
  SELECT d.*, p.key AS platform_key, p.name AS platform_name, p.color AS platform_color,
         p.icon AS platform_icon, p.delivery
  FROM destinations d JOIN platforms p ON p.id = d.platform_id`;

export async function listDestinations(platformId?: number, raw = false): Promise<Destination[]> {
  const rows = platformId
    ? await query<Destination>(`${DEST_SELECT} WHERE d.platform_id=$1 ORDER BY d.id`, [platformId])
    : await query<Destination>(`${DEST_SELECT} ORDER BY p.sort_order, d.id`);
  return raw ? rows : rows.map((d) => ({ ...d, config: maskConfig(d.config) }));
}

export async function getDestination(id: number, raw = true): Promise<Destination | undefined> {
  const d = (await query<Destination>(`${DEST_SELECT} WHERE d.id=$1`, [id]))[0];
  if (!d) return undefined;
  return raw ? d : { ...d, config: maskConfig(d.config) };
}

function validateConfig(delivery: Delivery, config: Record<string, any>) {
  const need = (k: string, label: string) => {
    if (!String(config[k] ?? '').trim()) throw Object.assign(new Error(`${label} الزامی است`), { status: 400 });
  };
  if (delivery === 'telegram') need('chat_id', 'شناسه کانال تلگرام');
  if (delivery === 'webhook') need('url', 'آدرس وب‌هوک');
  if (delivery === 'email') {
    need('recipients', 'گیرندگان ایمیل');
    need('smtp_host', 'سرور SMTP');
  }
}

export async function createDestination(input: z.infer<typeof destinationInputSchema>) {
  const p = await getPlatform(input.platform_id);
  if (!p) throw Object.assign(new Error('شبکه یافت نشد'), { status: 404 });
  validateConfig(p.delivery, input.config);
  const d = (
    await query<Destination>(
      `INSERT INTO destinations (platform_id, name, config, enabled) VALUES ($1,$2,$3,$4) RETURNING id`,
      [input.platform_id, input.name, JSON.stringify(input.config), input.enabled],
    )
  )[0];
  return getDestination(d.id, false);
}

export async function updateDestination(id: number, input: Partial<z.infer<typeof destinationInputSchema>>) {
  const current = await getDestination(id);
  if (!current) return undefined;
  // keep stored secrets when the browser sends back the mask
  const config = { ...current.config };
  for (const [k, v] of Object.entries(input.config ?? {})) {
    if (v === MASK) continue;
    config[k] = v;
  }
  validateConfig(current.delivery!, config);
  await query(`UPDATE destinations SET name=$2, config=$3, enabled=$4, updated_at=NOW() WHERE id=$1`, [
    id,
    input.name ?? current.name,
    JSON.stringify(config),
    input.enabled ?? current.enabled,
  ]);
  return getDestination(id, false);
}

export async function deleteDestination(id: number) {
  return (await query(`DELETE FROM destinations WHERE id=$1 RETURNING id`, [id])).length > 0;
}

// ---------------------------------------------------------------- templates

export const templateInputSchema = z.object({
  platform_id: z.coerce.number().int().positive(),
  destination_id: z.coerce.number().int().positive().nullable().optional(),
  kind: z.enum(KIND_KEYS as [Kind, ...Kind[]]).default('intro'),
  name: z.string().trim().min(1, 'نام قالب الزامی است'),
  title: z.string().default(''),
  body: z.string().trim().min(1, 'متن قالب الزامی است'),
  is_default: z.boolean().default(false),
  media: mediaSchema.default([]),
  links: linksSchema.default([]),
  product_media: productMediaSchema.default('main'),
});

export async function listTemplates(platformId?: number): Promise<Template[]> {
  return platformId
    ? query<Template>(`SELECT * FROM content_templates WHERE platform_id=$1 ORDER BY kind, is_default DESC, id`, [platformId])
    : query<Template>(`SELECT * FROM content_templates ORDER BY platform_id, kind, is_default DESC, id`);
}

export async function getTemplate(id: number): Promise<Template | undefined> {
  return (await query<Template>(`SELECT * FROM content_templates WHERE id=$1`, [id]))[0];
}

async function clearOtherDefaults(t: { id?: number; platform_id: number; kind: string; destination_id?: number | null }) {
  await query(
    `UPDATE content_templates SET is_default=FALSE
     WHERE platform_id=$1 AND kind=$2 AND destination_id IS NOT DISTINCT FROM $3 AND id <> $4`,
    [t.platform_id, t.kind, t.destination_id ?? null, t.id ?? 0],
  );
}

export async function createTemplate(input: z.infer<typeof templateInputSchema>) {
  const t = (
    await query<Template>(
      `INSERT INTO content_templates (platform_id, destination_id, kind, name, title, body, is_default, media, links, product_media)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        input.platform_id, input.destination_id ?? null, input.kind, input.name, input.title, input.body, input.is_default,
        JSON.stringify(input.media), JSON.stringify(input.links), input.product_media,
      ],
    )
  )[0];
  if (t.is_default) await clearOtherDefaults(t);
  return t;
}

export async function updateTemplate(id: number, input: Partial<z.infer<typeof templateInputSchema>>) {
  const cur = await getTemplate(id);
  if (!cur) return undefined;
  const n = { ...cur, ...input };
  const t = (
    await query<Template>(
      `UPDATE content_templates SET destination_id=$2, kind=$3, name=$4, title=$5, body=$6, is_default=$7,
         media=$8, links=$9, product_media=$10
       WHERE id=$1 RETURNING *`,
      [id, n.destination_id ?? null, n.kind, n.name, n.title, n.body, n.is_default,
        JSON.stringify(n.media || []), JSON.stringify(n.links || []), n.product_media || 'main'],
    )
  )[0];
  if (t.is_default) await clearOtherDefaults(t);
  return t;
}

export async function deleteTemplate(id: number) {
  return (await query(`DELETE FROM content_templates WHERE id=$1 RETURNING id`, [id])).length > 0;
}

/**
 * Picks the template to use: destination-specific default > platform default > any platform template
 * of that kind > built-in fallback.
 */
export async function resolveTemplate(platform: Platform, kind: Kind, destinationId?: number | null) {
  const rows = await query<Template>(
    `SELECT * FROM content_templates
     WHERE platform_id=$1 AND kind=$2 AND (destination_id IS NULL OR destination_id IS NOT DISTINCT FROM $3::int)
     ORDER BY (destination_id IS NOT DISTINCT FROM $3::int) DESC, (destination_id IS NULL) DESC, is_default DESC, id
     LIMIT 1`,
    [platform.id, kind, destinationId ?? null],
  );
  if (rows[0]) return rows[0];
  const b = builtinTemplate(platform.key, kind);
  return { id: null, title: b.title || '', body: b.body, name: 'قالب پیش‌فرض', media: [] as MediaItem[], links: [] as LinkItem[], product_media: 'main' as ProductMediaMode };
}

/** Creates the starter templates for a platform (one default per kind) */
export async function seedTemplatesFor(p: Platform) {
  for (const kind of KIND_KEYS) {
    const b = builtinTemplate(p.key, kind);
    await query(
      `INSERT INTO content_templates (platform_id, kind, name, title, body, is_default) VALUES ($1,$2,$3,$4,$5,TRUE)`,
      [p.id, kind, 'قالب پیش‌فرض', b.title || '', b.body],
    );
  }
}
