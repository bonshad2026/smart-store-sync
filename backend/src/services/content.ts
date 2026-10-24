import { z } from 'zod';
import { query } from '../db/pool';
import { aiEnabled, generateText } from './ai';
import { deliver } from './delivery';
import { LinkItem, linksSchema, MediaItem, mediaSchema, ProductMediaMode, productMediaSchema } from './media';
import { runOperation } from './operations';
import {
  Destination, getDestination, getPlatform, getPlatformByKey, getTemplate, listDestinations, listPlatforms, resolveTemplate,
} from './platforms';
import { getProduct } from './products';
import { getSettings } from './settings';
import { Kind, KIND_KEYS } from './templates';

export interface Content {
  id: number;
  product_id: number;
  channel: string; // platform key
  kind: Kind;
  title: string;
  body: string;
  status: 'pending' | 'approved' | 'rejected' | 'published';
  generated_by: string;
  template_id: number | null;
  destination_id: number | null;
  created_at: string;
  reviewed_at: string | null;
  published_at: string | null;
  media: MediaItem[];
  links: LinkItem[];
  use_product_image: boolean;
  product_media: ProductMediaMode;
}

export interface Publication {
  id: number;
  content_id: number;
  destination_id: number;
  status: 'scheduled' | 'sending' | 'sent' | 'failed' | 'manual';
  scheduled_at: string | null;
  sent_at: string | null;
  message: string;
  external_id: string | null;
  attempts: number;
  created_at: string;
}

// ---------------------------------------------------------------- generation

export const generateSchema = z.object({
  productId: z.coerce.number().int().positive(),
  kind: z.enum(KIND_KEYS as [Kind, ...Kind[]]).default('intro'),
  targets: z
    .array(
      z.object({
        platformId: z.coerce.number().int().positive(),
        destinationId: z.coerce.number().int().positive().nullable().optional(),
        templateId: z.coerce.number().int().positive().nullable().optional(),
        mode: z.enum(['ai', 'template']).default('template'),
      }),
    )
    .min(1, 'حداقل یک شبکه را انتخاب کنید'),
  oldPrice: z.union([z.string(), z.number()]).nullable().optional(),
});
export type GenerateRequest = z.infer<typeof generateSchema>;

/** Generates one content item per target (platform / destination). Saved as `pending` for human review. */
export async function generateContents(req: GenerateRequest, operationId?: number): Promise<Content[]> {
  return runOperation(
    'generate_content',
    req as unknown as Record<string, unknown>,
    async () => {
      const product = await getProduct(req.productId);
      if (!product) throw new Error(`محصول ${req.productId} یافت نشد`);
      const s = await getSettings();
      const out: Content[] = [];
      for (const t of req.targets) {
        const platform = await getPlatform(t.platformId);
        if (!platform) throw new Error(`شبکه ${t.platformId} یافت نشد`);
        const template = t.templateId ? await getTemplate(t.templateId) : await resolveTemplate(platform, req.kind, t.destinationId);
        if (!template) throw new Error('قالب انتخاب‌شده یافت نشد');
        const text = await generateText({
          product,
          platform,
          kind: req.kind,
          template,
          storeName: s.store_name || 'فروشگاه',
          tone: s.brand_tone || 'حرفه‌ای',
          useAi: t.mode === 'ai',
          oldPrice: req.oldPrice,
        });
        const row = (
          await query<Content>(
            `INSERT INTO contents (product_id, channel, kind, title, body, generated_by, template_id, destination_id,
                                   media, links, product_media, use_product_image)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
            [
              product.id, platform.key, req.kind, text.title, text.body, text.generatedBy, template.id ?? null, t.destinationId ?? null,
              JSON.stringify(template.media || []), JSON.stringify(template.links || []),
              template.product_media || 'main', (template.product_media || 'main') !== 'none',
            ],
          )
        )[0];
        out.push(row);
      }
      return out;
    },
    operationId,
  );
}

/** Targets used for automatic generation: every enabled platform that has at least one enabled destination */
export async function autoTargets(): Promise<GenerateRequest['targets']> {
  const platforms = (await listPlatforms()).filter((p) => p.enabled);
  const dests = await listDestinations();
  return platforms
    .filter((p) => dests.some((d) => d.platform_id === p.id && d.enabled))
    .map((p) => ({ platformId: p.id, mode: aiEnabled() ? ('ai' as const) : ('template' as const) }));
}

export const manualContentSchema = z.object({
  productId: z.coerce.number().int().positive(),
  platformId: z.coerce.number().int().positive(),
  kind: z.enum(KIND_KEYS as [Kind, ...Kind[]]).default('intro'),
  title: z.string().default(''),
  body: z.string().default(''),
  media: mediaSchema.default([]),
  links: linksSchema.default([]),
  product_media: productMediaSchema.default('main'),
}).refine((v) => v.body.trim() || v.media.length, { message: 'متن یا حداقل یک فایل لازم است' });

export async function createManualContent(input: z.infer<typeof manualContentSchema>) {
  const p = await getPlatform(input.platformId);
  if (!p) throw Object.assign(new Error('شبکه یافت نشد'), { status: 404 });
  const row = (
    await query<Content>(
      `INSERT INTO contents (product_id, channel, kind, title, body, generated_by, media, links, product_media, use_product_image)
       VALUES ($1,$2,$3,$4,$5,'manual',$6,$7,$8,$9) RETURNING id`,
      [
        input.productId, p.key, input.kind, input.title, input.body, JSON.stringify(input.media), JSON.stringify(input.links),
        input.product_media, input.product_media !== 'none',
      ],
    )
  )[0];
  return getContent(row.id);
}

// ------------------------------------------------------------------ queries

const CONTENT_SELECT = `
  SELECT c.*, p.name AS product_name, p.sku, p.image_url AS product_image, p.images AS product_images,
         pl.id AS platform_id, pl.name AS platform_name, pl.color AS platform_color, pl.icon AS platform_icon,
         pl.delivery AS platform_delivery, pl.max_length,
         COALESCE((
           SELECT json_agg(json_build_object('id', pb.id, 'destination_id', pb.destination_id, 'destination_name', d.name,
                    'status', pb.status, 'scheduled_at', pb.scheduled_at, 'sent_at', pb.sent_at, 'message', pb.message)
                  ORDER BY pb.id)
           FROM publications pb JOIN destinations d ON d.id = pb.destination_id WHERE pb.content_id = c.id
         ), '[]'::json) AS publications
  FROM contents c
  JOIN products p ON p.id = c.product_id
  LEFT JOIN platforms pl ON pl.key = c.channel`;

export async function listContents(f: { status?: string; productId?: number; platform?: string } = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.status) {
    params.push(f.status);
    where.push(`c.status = $${params.length}`);
  }
  if (f.productId) {
    params.push(f.productId);
    where.push(`c.product_id = $${params.length}`);
  }
  if (f.platform) {
    params.push(f.platform);
    where.push(`c.channel = $${params.length}`);
  }
  return query(`${CONTENT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.id DESC LIMIT 300`, params);
}

export async function getContent(id: number) {
  return (await query(`${CONTENT_SELECT} WHERE c.id = $1`, [id]))[0];
}

export async function updateContent(
  id: number,
  data: {
    title?: string; body?: string; status?: 'approved' | 'rejected' | 'pending';
    media?: MediaItem[]; links?: LinkItem[]; product_media?: ProductMediaMode;
  },
) {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (data.media !== undefined) {
    params.push(JSON.stringify(data.media));
    sets.push(`media=$${params.length}`);
  }
  if (data.links !== undefined) {
    params.push(JSON.stringify(data.links));
    sets.push(`links=$${params.length}`);
  }
  if (data.product_media !== undefined) {
    params.push(data.product_media);
    sets.push(`product_media=$${params.length}`);
    params.push(data.product_media !== 'none');
    sets.push(`use_product_image=$${params.length}`);
  }
  if (data.title !== undefined) {
    params.push(data.title);
    sets.push(`title=$${params.length}`);
  }
  if (data.body !== undefined) {
    params.push(data.body);
    sets.push(`body=$${params.length}`);
  }
  if (data.status !== undefined) {
    params.push(data.status);
    sets.push(`status=$${params.length}`, 'reviewed_at=NOW()');
  }
  if (sets.length) {
    params.push(id);
    await query(`UPDATE contents SET ${sets.join(', ')} WHERE id=$${params.length}`, params);
  }
  return getContent(id);
}

export async function deleteContent(id: number) {
  return (await query(`DELETE FROM contents WHERE id=$1 RETURNING id`, [id])).length > 0;
}

// ---------------------------------------------------------------- publishing

export const publishSchema = z.object({
  destinationIds: z.array(z.coerce.number().int().positive()).min(1, 'حداقل یک مقصد را انتخاب کنید'),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
});

/**
 * Approves a content item and queues it for the selected destinations.
 * Without a schedule it is delivered right away and the results are returned.
 */
export async function publishContent(contentId: number, input: z.infer<typeof publishSchema>) {
  const c = (await query<Content>(`SELECT * FROM contents WHERE id=$1`, [contentId]))[0];
  if (!c) throw Object.assign(new Error('محتوا یافت نشد'), { status: 404 });
  const platform = await getPlatformByKey(c.channel);
  const pubs: Publication[] = [];
  for (const destId of input.destinationIds) {
    const d = await getDestination(destId);
    if (!d) throw Object.assign(new Error(`مقصد ${destId} یافت نشد`), { status: 404 });
    if (platform && d.platform_id !== platform.id) {
      throw Object.assign(new Error(`مقصد «${d.name}» متعلق به شبکه ${d.platform_name} است، نه ${platform.name}`), { status: 400 });
    }
    pubs.push(
      (
        await query<Publication>(
          `INSERT INTO publications (content_id, destination_id, status, scheduled_at) VALUES ($1,$2,'scheduled',$3) RETURNING *`,
          [contentId, destId, input.scheduledAt ?? null],
        )
      )[0],
    );
  }
  await query(`UPDATE contents SET status='approved', reviewed_at=COALESCE(reviewed_at, NOW()) WHERE id=$1`, [contentId]);

  const immediate = !input.scheduledAt || new Date(input.scheduledAt) <= new Date();
  const results: { id: number; status: string; message?: string; destination?: string }[] = [];
  for (const p of pubs) {
    if (!immediate) {
      results.push({ id: p.id, status: 'scheduled' });
      continue;
    }
    try {
      results.push(await processPublication(p.id));
    } catch (e) {
      results.push({ id: p.id, status: 'failed', message: (e as Error).message });
    }
  }
  return { content: await getContent(contentId), results };
}

/** Delivers a single publication and records the result */
export async function processPublication(id: number, operationId?: number) {
  return runOperation(
    'publish',
    { publicationId: id },
    async () => {
      const pub = (await query<Publication>(`SELECT * FROM publications WHERE id=$1`, [id]))[0];
      if (!pub) throw new Error(`انتشار ${id} یافت نشد`);
      if (pub.status === 'sent') return { id, status: 'sent', message: 'قبلاً ارسال شده است' };
      const content = (await query<Content>(`SELECT * FROM contents WHERE id=$1`, [pub.content_id]))[0];
      const destination = (await getDestination(pub.destination_id)) as Destination;
      const product = await getProduct(content.product_id);
      await query(`UPDATE publications SET status='sending', attempts=attempts+1 WHERE id=$1`, [id]);
      try {
        const r = await deliver({
          destination,
          title: content.title,
          body: content.body,
          product,
          media: content.media,
          links: content.links,
          contentId: content.id,
          productMedia: content.product_media || (content.use_product_image ? 'main' : 'none'),
        });
        await query(
          `UPDATE publications SET status=$2::varchar, message=$3, external_id=$4,
             sent_at=CASE WHEN $2::varchar='sent' THEN NOW() ELSE sent_at END WHERE id=$1`,
          [id, r.status, r.message, r.external_id ?? null],
        );
        await refreshContentStatus(content.id);
        return { id, status: r.status as string, message: r.message, destination: destination.name };
      } catch (err) {
        await query(`UPDATE publications SET status='failed', message=$2 WHERE id=$1`, [id, (err as Error).message]);
        throw err;
      }
    },
    operationId,
  );
}

/** A content is "published" once every publication is sent (or handed over for manual posting) */
async function refreshContentStatus(contentId: number) {
  await query(
    `UPDATE contents SET status='published', published_at=NOW()
     WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM publications WHERE content_id=$1 AND status NOT IN ('sent','manual'))`,
    [contentId],
  );
}

/** Delivers queued publications whose time has come (called by the scheduler / n8n) */
export async function publishDue() {
  const due = await query<{ id: number }>(
    `SELECT id FROM publications WHERE status='scheduled' AND (scheduled_at IS NULL OR scheduled_at <= NOW()) ORDER BY id LIMIT 30`,
  );
  const results: { id: number; ok: boolean; error?: string }[] = [];
  for (const { id } of due) {
    try {
      await processPublication(id);
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

export async function listPublications(status?: string) {
  return query(
    `SELECT pb.*, d.name AS destination_name, c.title, c.body, c.channel, c.kind, c.product_id,
            c.media, c.links, c.use_product_image, c.product_media, p.images AS product_images,
            p.name AS product_name, p.image_url AS product_image,
            pl.name AS platform_name, pl.color AS platform_color, pl.icon AS platform_icon
     FROM publications pb
     JOIN destinations d ON d.id = pb.destination_id
     JOIN contents c ON c.id = pb.content_id
     JOIN products p ON p.id = c.product_id
     LEFT JOIN platforms pl ON pl.id = d.platform_id
     ${status ? 'WHERE pb.status = $1' : ''}
     ORDER BY COALESCE(pb.sent_at, pb.scheduled_at, pb.created_at) DESC LIMIT 300`,
    status ? [status] : [],
  );
}

export async function markPublicationSent(id: number) {
  const r = await query<Publication>(
    `UPDATE publications SET status='sent', sent_at=NOW(), message='به‌صورت دستی منتشر شد' WHERE id=$1 RETURNING *`,
    [id],
  );
  if (r[0]) await refreshContentStatus(r[0].content_id);
  return r[0];
}

export async function cancelPublication(id: number) {
  return (await query(`DELETE FROM publications WHERE id=$1 AND status IN ('scheduled','failed') RETURNING id`, [id])).length > 0;
}

/** Sends a test message to a destination (used from the channel settings page) */
export async function testDestination(id: number) {
  const d = await getDestination(id);
  if (!d) throw Object.assign(new Error('مقصد یافت نشد'), { status: 404 });
  const s = await getSettings();
  return deliver({
    destination: d,
    title: `پیام آزمایشی ${s.store_name || ''}`.trim(),
    body: `✅ اتصال «${d.name}» به فروشگاه‌یار هوشمند برقرار است.`,
    product: null,
  });
}
