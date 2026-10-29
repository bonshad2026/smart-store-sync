import { Router, Request, Response, NextFunction } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import { config } from '../config';
import { query } from '../db/pool';
import { aiEnabled } from '../services/ai';
import {
  cancelPublication, createManualContent, deleteContent, generateContents, generateSchema, getContent, listContents,
  listPublications, manualContentSchema, markPublicationSent, processPublication, publishContent, publishDue, publishSchema,
  testDestination, updateContent,
} from '../services/content';
import { importCsv } from '../services/csvImport';
import { feedbackStats, listFeedback, markSeen, replyToFeedback } from '../services/feedback';
import {
  createInteraction, deleteInteraction, interactionSchema, listInteractions, listSessions, markSessionsSeen, replyToSession,
  setInteractionEnabled, statsByProduct, unseenSessions, updateInteraction,
} from '../services/interactions';
import { linksSchema, mediaSchema, mediaTypeOf, productMediaSchema } from '../services/media';
import { listOperations } from '../services/operations';
import {
  createDestination, createPlatform, createTemplate, deleteDestination, deletePlatform, deleteTemplate,
  destinationInputSchema, getDestination, getPlatform, listDestinations, listPlatforms, listTemplates,
  platformInputSchema, templateInputSchema, updateDestination, updatePlatform, updateTemplate,
} from '../services/platforms';
import {
  deleteProduct, getProduct, listCategories, listChanges, listProducts, markChangesProcessed, productInputSchema,
  setProductImages, upsertProduct,
} from '../services/products';
import { retryAllFailed, retryOperation } from '../services/retry';
import {
  channelDetails, connectStatus, createConnectLink, disconnectChannel, listChannels, refreshChannel,
} from '../services/telegramChannels';
import { asMainBot, getBotInfo } from '../services/telegram';
import { botLinkStatus, canManageBots, createBotLink, listBots } from '../services/telegramBots';
import { getSettings, saveSettings } from '../services/settings';
import { KINDS, PLACEHOLDERS, renderTemplate, SAMPLE_PRODUCT } from '../services/templates';

export const api = Router();
const csvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

fs.mkdirSync(config.uploadDir, { recursive: true });
const imageUpload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.jpg').toLowerCase().replace(/[^.a-z0-9]/g, '');
      cb(null, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype) || /^video\//.test(file.mimetype)),
});

// Content attachments: images, videos and audio (Telegram bots can upload up to 50 MB)
const mediaUpload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname) || '').toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 6);
      cb(null, `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => cb(null, !!mediaTypeOf(file.mimetype)),
});

/** Wraps async handlers so errors go to the error middleware */
const h =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const idParam = (req: Request) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw Object.assign(new Error('شناسه نامعتبر است'), { status: 400 });
  return id;
};
/** Only dashboard admins (not members, not the n8n API key) */
const requireAdmin = (req: Request, _res: Response, next: NextFunction) =>
  next(req.user?.role === 'admin' ? undefined : Object.assign(new Error('این کار فقط برای مدیر فروشگاه مجاز است'), { status: 403 }));

const notFound = (res: Response, what: string) => res.status(404).json({ error: `${what} یافت نشد` });

// ---------- Health & meta ----------
api.get('/health', h(async (_req, res) => {
  await query('SELECT 1');
  res.json({
    ok: true,
    ai: aiEnabled() ? 'configured' : 'template-mode',
    telegram: config.telegram.botToken ? 'configured' : 'not-configured',
    n8n: config.n8nWebhookUrl ? 'configured' : 'not-configured',
  });
}));

api.get('/meta', h(async (_req, res) => {
  res.json({ kinds: KINDS, placeholders: PLACEHOLDERS, ai: aiEnabled() });
}));

// ---------- Feedback (interactive Telegram buttons & private messages) ----------
api.get('/feedback', h(async (req, res) =>
  res.json(await listFeedback({ status: String(req.query.status || '') || undefined, kind: String(req.query.kind || '') || undefined }))));
api.get('/feedback/stats', h(async (_req, res) => res.json({ ...(await feedbackStats()), sessions_unseen: await unseenSessions() })));
api.post('/feedback/seen', h(async (req, res) => {
  const ids = z.object({ ids: z.array(z.number().int()).max(500) }).parse(req.body).ids;
  await markSeen(ids);
  res.json({ ok: true });
}));
api.post('/feedback/:id/reply', h(async (req, res) => {
  const { text } = z.object({ text: z.string().trim().min(1, 'متن پاسخ خالی است').max(4000) }).parse(req.body);
  res.json(await replyToFeedback(idParam(req), text));
}));

// ---------- Telegram channels connected through the bot ----------
api.get('/telegram/bot', h(async (_req, res) => {
  if (!config.telegram.botToken) return res.json({ configured: false, bots: [] });
  const main = await asMainBot(getBotInfo).catch(() => null);
  const canCreate = main ? await canManageBots().catch(() => false) : false;
  res.json({ configured: true, reachable: !!main, can_create_bots: canCreate, bots: await listBots() });
}));
// the store's own bot, created through the main bot
api.post('/telegram/bots/create', requireAdmin, h(async (req, res) => {
  if (!config.telegram.botToken) throw Object.assign(new Error('اتصال تلگرام هنوز فعال نشده است'), { status: 503 });
  res.status(201).json(await createBotLink(req.user!.id));
}));
api.get('/telegram/bots/create/:id', requireAdmin, h(async (req, res) => res.json(await botLinkStatus(idParam(req), req.user!.id))));
api.get('/telegram/channels', h(async (_req, res) => res.json(await listChannels())));
api.get('/telegram/channels/:id', h(async (req, res) => res.json(await channelDetails(idParam(req)))));
api.post('/telegram/channels/:id/refresh', h(async (req, res) => res.json(await refreshChannel(idParam(req)))));
api.post('/telegram/channels/:id/disconnect', requireAdmin, h(async (req, res) => res.json(await disconnectChannel(idParam(req)))));
api.post('/telegram/connect', requireAdmin, h(async (req, res) => {
  const { bot_id } = z.object({ bot_id: z.number().int().positive() }).parse(req.body);
  res.status(201).json(await createConnectLink(req.user!.id, bot_id));
}));
api.get('/telegram/connect/:id', requireAdmin, h(async (req, res) => res.json(await connectStatus(idParam(req), req.user!.id))));

// ---------- Interactions (reusable automatic buttons & conversations) ----------
api.get('/interactions', h(async (_req, res) => res.json(await listInteractions())));
api.post('/interactions', h(async (req, res) => res.status(201).json(await createInteraction(interactionSchema.parse(req.body)))));
api.get('/interactions/sessions', h(async (req, res) => res.json(await listSessions({
  interactionId: Number(req.query.interaction_id) || undefined,
  status: String(req.query.status || '') || undefined,
  productId: Number(req.query.product_id) || undefined,
  contentId: Number(req.query.content_id) || undefined,
}))));
api.post('/interactions/sessions/seen', h(async (req, res) => {
  await markSessionsSeen(z.object({ ids: z.array(z.number().int()).max(500) }).parse(req.body).ids);
  res.json({ ok: true });
}));
api.post('/interactions/sessions/:id/reply', h(async (req, res) => {
  const { text } = z.object({ text: z.string().trim().min(1, 'متن پاسخ خالی است').max(4000) }).parse(req.body);
  res.json(await replyToSession(idParam(req), text));
}));
api.get('/interactions/by-product/:id', h(async (req, res) => res.json(await statsByProduct(idParam(req)))));
api.put('/interactions/:id', h(async (req, res) => {
  const row = await updateInteraction(idParam(req), interactionSchema.parse(req.body));
  if (!row) return notFound(res, 'تعامل');
  res.json(row);
}));
api.patch('/interactions/:id/enabled', h(async (req, res) => {
  await setInteractionEnabled(idParam(req), z.object({ enabled: z.boolean() }).parse(req.body).enabled);
  res.json({ ok: true });
}));
api.delete('/interactions/:id', h(async (req, res) => {
  await deleteInteraction(idParam(req));
  res.status(204).end();
}));

// ---------- n8n (automation editor runs as its own service) ----------
api.get('/n8n/status', h(async (_req, res) => {
  const internal = (process.env.N8N_INTERNAL_URL || 'http://n8n:5678').replace(/\/$/, '');
  let reachable = false;
  try {
    const r = await fetch(`${internal}/healthz`, { signal: AbortSignal.timeout(3000) });
    reachable = r.ok;
  } catch { /* not running */ }
  res.json({
    reachable,
    editor_url: (process.env.N8N_EDITOR_URL || 'http://localhost:5678').replace(/\/$/, ''),
    product_webhook: config.n8nWebhookUrl ? 'configured' : 'not-configured',
  });
}));

const workflowDir = () =>
  [path.resolve(process.cwd(), 'n8n/workflows'), path.resolve(process.cwd(), '../n8n/workflows'), path.resolve(__dirname, '../../../n8n/workflows')]
    .find((d) => fs.existsSync(d));
api.get('/n8n/workflows', h(async (_req, res) => {
  const dir = workflowDir();
  if (!dir) return res.json([]);
  res.json(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((file) => {
    const wf = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    return { file, name: wf.name, nodes: (wf.nodes || []).map((n: { name: string; type: string }) => ({ name: n.name, type: n.type.replace('n8n-nodes-base.', '') })) };
  }));
}));
api.get('/n8n/workflows/:file', h(async (req, res) => {
  const dir = workflowDir();
  const file = path.basename(String(req.params.file));
  if (!dir || !file.endsWith('.json') || !fs.existsSync(path.join(dir, file))) return notFound(res, 'گردش‌کار');
  res.type('application/json').send(fs.readFileSync(path.join(dir, file), 'utf8'));
}));

// ---------- Journey (setup / workflow progress shown on every page) ----------
api.get('/journey', h(async (_req, res) => {
  const [j] = await query(`
    SELECT
      (SELECT COUNT(*) FROM products)::int AS products,
      (SELECT COUNT(*) FROM platforms WHERE enabled)::int AS platforms,
      (SELECT COUNT(*) FROM destinations d JOIN platforms p ON p.id = d.platform_id WHERE d.enabled AND p.enabled)::int AS destinations,
      (SELECT COUNT(*) FROM content_templates
        WHERE name <> 'قالب پیش‌فرض' OR media <> '[]'::jsonb OR links <> '[]'::jsonb)::int AS custom_templates,
      (SELECT COUNT(*) FROM contents)::int AS contents,
      (SELECT COUNT(*) FROM publications WHERE status IN ('sent','manual'))::int AS published,
      (SELECT d.platform_id FROM destinations d JOIN platforms p ON p.id = d.platform_id
        WHERE d.enabled AND p.enabled ORDER BY p.sort_order, d.id LIMIT 1) AS first_platform_id,
      (SELECT id FROM products ORDER BY updated_at DESC LIMIT 1) AS last_product_id
  `);
  res.json(j);
}));

// ---------- Dashboard ----------
api.get('/dashboard', h(async (_req, res) => {
  const [counts] = await query(`
    SELECT
      (SELECT COUNT(*) FROM products)::int                                   AS products,
      (SELECT COUNT(*) FROM products WHERE stock = 0)::int                   AS out_of_stock,
      (SELECT COUNT(*) FROM product_changes WHERE created_at > NOW() - INTERVAL '7 days')::int AS changes_7d,
      (SELECT COUNT(*) FROM contents WHERE status = 'pending')::int          AS pending_contents,
      (SELECT COUNT(*) FROM publications WHERE status = 'sent' AND sent_at > NOW() - INTERVAL '30 days')::int AS sent_30d,
      (SELECT COUNT(*) FROM publications WHERE status = 'scheduled')::int    AS scheduled,
      (SELECT COUNT(*) FROM publications WHERE status = 'manual')::int       AS manual_ready,
      (SELECT COUNT(*) FROM publications WHERE status = 'failed')::int       AS failed_publications,
      (SELECT COUNT(*) FROM destinations WHERE enabled)::int                 AS destinations,
      (SELECT COUNT(*) FROM operations)::int                                 AS total_operations,
      (SELECT COUNT(*) FROM operations WHERE status = 'success')::int        AS success_operations
  `);
  const platforms = await query(`
    SELECT p.id, p.key, p.name, p.color, p.icon, p.enabled,
      (SELECT COUNT(*) FROM destinations d WHERE d.platform_id = p.id AND d.enabled)::int AS destinations,
      (SELECT COUNT(*) FROM publications pb JOIN destinations d ON d.id = pb.destination_id
        WHERE d.platform_id = p.id AND pb.status = 'sent' AND pb.sent_at > NOW() - INTERVAL '30 days')::int AS sent_30d
    FROM platforms p WHERE p.enabled ORDER BY p.sort_order, p.id`);
  const pending = (await listContents({ status: 'pending' })).slice(0, 6);
  const recentChanges = await listChanges(8);
  const failed = (await listPublications('failed')).slice(0, 5);
  const activity = await query(`
    SELECT to_char(d::date, 'YYYY-MM-DD') AS day,
      (SELECT COUNT(*) FROM publications WHERE status='sent' AND sent_at::date = d::date)::int AS sent
    FROM generate_series(CURRENT_DATE - INTERVAL '13 days', CURRENT_DATE, INTERVAL '1 day') d`);
  res.json({ counts, platforms, pending, recentChanges, failed, activity });
}));

// ---------- Products ----------
api.get('/products', h(async (req, res) =>
  res.json(await listProducts(String(req.query.search || ''), String(req.query.category || '')))));
api.get('/categories', h(async (_req, res) => res.json(await listCategories())));

api.get('/products/:id', h(async (req, res) => {
  const p = await getProduct(idParam(req));
  if (!p) return notFound(res, 'محصول');
  res.json(p);
}));

api.get('/products/:id/details', h(async (req, res) => {
  const id = idParam(req);
  const product = await getProduct(id);
  if (!product) return notFound(res, 'محصول');
  const [changes, contents] = await Promise.all([listChanges(50, false, id), listContents({ productId: id })]);
  res.json({ product, changes, contents });
}));

api.post('/products', h(async (req, res) => {
  const data = productInputSchema.parse(req.body);
  const result = await upsertProduct(data, 'manual');
  res.status(result.created ? 201 : 200).json(result);
}));

api.put('/products/:id', h(async (req, res) => {
  const existing = await getProduct(idParam(req));
  if (!existing) return notFound(res, 'محصول');
  const data = productInputSchema.parse({ ...existing, ...req.body, sku: existing.sku });
  res.json(await upsertProduct(data, 'manual'));
}));

api.delete('/products/:id', h(async (req, res) => {
  const ok = await deleteProduct(idParam(req));
  res.status(ok ? 204 : 404).end();
}));

api.post('/products/import', csvUpload.single('file'), h(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'فایل CSV ارسال نشده است' });
  res.json(await importCsv(req.file.buffer, 'csv'));
}));

// Gallery: upload images (multipart field "images")
api.post('/products/:id/images', imageUpload.array('images', 10), h(async (req, res) => {
  const p = await getProduct(idParam(req));
  if (!p) return notFound(res, 'محصول');
  const files = (req.files as Express.Multer.File[]) || [];
  if (!files.length) return res.status(400).json({ error: 'هیچ عکس یا فیلم معتبری ارسال نشد (jpg، png، webp، mp4، …)' });
  res.json(await setProductImages(p.id, [...p.images, ...files.map((f) => `/uploads/${f.filename}`)]));
}));

// Gallery: reorder / remove / set main (send the full new list)
api.put('/products/:id/images', h(async (req, res) => {
  const p = await getProduct(idParam(req));
  if (!p) return notFound(res, 'محصول');
  const images = z.array(z.string()).parse(req.body.images);
  for (const removed of p.images.filter((i) => !images.includes(i) && i.startsWith('/uploads/'))) {
    fs.promises.unlink(path.join(config.uploadDir, path.basename(removed))).catch(() => undefined);
  }
  res.json(await setProductImages(p.id, images));
}));

// ---------- Changes ----------
api.get('/changes', h(async (req, res) => res.json(await listChanges(100, req.query.unprocessed === 'true'))));
api.post('/changes/mark-processed', h(async (req, res) => {
  const ids = z.array(z.number().int()).parse(req.body.ids);
  await markChangesProcessed(ids);
  res.json({ ok: true, count: ids.length });
}));

// ---------- Platforms (networks) ----------
api.get('/platforms', h(async (_req, res) => res.json(await listPlatforms())));
api.get('/platforms/:id', h(async (req, res) => {
  const p = await getPlatform(idParam(req));
  if (!p) return notFound(res, 'شبکه');
  res.json({ platform: p, destinations: await listDestinations(p.id), templates: await listTemplates(p.id) });
}));
api.post('/platforms', h(async (req, res) => res.status(201).json(await createPlatform(platformInputSchema.parse(req.body)))));
api.put('/platforms/:id', h(async (req, res) => {
  const p = await updatePlatform(idParam(req), platformInputSchema.partial().parse(req.body));
  if (!p) return notFound(res, 'شبکه');
  res.json(p);
}));
api.delete('/platforms/:id', h(async (req, res) => res.status((await deletePlatform(idParam(req))) ? 204 : 404).end()));

// ---------- Destinations (channels, lists, ...) ----------
api.get('/destinations', h(async (req, res) =>
  res.json(await listDestinations(req.query.platform_id ? Number(req.query.platform_id) : undefined))));
api.post('/destinations', h(async (req, res) =>
  res.status(201).json(await createDestination(destinationInputSchema.parse(req.body)))));
api.put('/destinations/:id', h(async (req, res) => {
  const d = await updateDestination(idParam(req), destinationInputSchema.partial().parse(req.body));
  if (!d) return notFound(res, 'مقصد');
  res.json(d);
}));
api.delete('/destinations/:id', h(async (req, res) => res.status((await deleteDestination(idParam(req))) ? 204 : 404).end()));
api.post('/destinations/:id/test', h(async (req, res) => {
  const d = await getDestination(idParam(req));
  if (!d) return notFound(res, 'مقصد');
  res.json(await testDestination(d.id));
}));

// ---------- Templates ----------
api.get('/templates', h(async (req, res) =>
  res.json(await listTemplates(req.query.platform_id ? Number(req.query.platform_id) : undefined))));
api.post('/templates', h(async (req, res) => res.status(201).json(await createTemplate(templateInputSchema.parse(req.body)))));
api.put('/templates/:id', h(async (req, res) => {
  const t = await updateTemplate(idParam(req), templateInputSchema.partial().parse(req.body));
  if (!t) return notFound(res, 'قالب');
  res.json(t);
}));
api.delete('/templates/:id', h(async (req, res) => res.status((await deleteTemplate(idParam(req))) ? 204 : 404).end()));

// Live preview of a template with a real product (or a sample product)
api.post('/templates/preview', h(async (req, res) => {
  const body = z.object({ title: z.string().default(''), body: z.string(), productId: z.number().int().optional() }).parse(req.body);
  const product = (body.productId && (await getProduct(body.productId))) || SAMPLE_PRODUCT;
  const s = await getSettings();
  const ctx = { storeName: s.store_name || 'فروشگاه', oldPrice: 550000 };
  res.json({ title: renderTemplate(body.title, product, ctx), body: renderTemplate(body.body, product, ctx) });
}));

// ---------- Contents ----------
api.get('/contents', h(async (req, res) =>
  res.json(
    await listContents({
      status: (req.query.status as string) || undefined,
      productId: req.query.product_id ? Number(req.query.product_id) : undefined,
      platform: (req.query.platform as string) || undefined,
    }),
  )));
api.get('/contents/:id', h(async (req, res) => {
  const c = await getContent(idParam(req));
  if (!c) return notFound(res, 'محتوا');
  res.json(c);
}));
api.post('/contents/generate', h(async (req, res) => res.status(201).json(await generateContents(generateSchema.parse(req.body)))));
api.post('/contents', h(async (req, res) => res.status(201).json(await createManualContent(manualContentSchema.parse(req.body)))));
api.patch('/contents/:id', h(async (req, res) => {
  const body = z
    .object({
      title: z.string().optional(),
      body: z.string().optional(),
      status: z.enum(['approved', 'rejected', 'pending']).optional(),
      media: mediaSchema.optional(),
      links: linksSchema.optional(),
      product_media: productMediaSchema.optional(),
    })
    .parse(req.body);
  const c = await updateContent(idParam(req), body);
  if (!c) return notFound(res, 'محتوا');
  res.json(c);
}));
api.delete('/contents/:id', h(async (req, res) => res.status((await deleteContent(idParam(req))) ? 204 : 404).end()));
api.post('/contents/:id/publish', h(async (req, res) => res.json(await publishContent(idParam(req), publishSchema.parse(req.body)))));
api.post('/contents/publish-due', h(async (_req, res) => res.json(await publishDue())));

// ---------- Media uploads (for content attachments) ----------
api.post('/media', mediaUpload.array('files', 10), h(async (req, res) => {
  const files = (req.files as Express.Multer.File[]) || [];
  if (!files.length) return res.status(400).json({ error: 'فایل معتبری ارسال نشد (عکس، فیلم یا صدا — حداکثر ۵۰ مگابایت)' });
  res.status(201).json(
    files.map((f) => ({
      type: mediaTypeOf(f.mimetype),
      url: `/uploads/${f.filename}`,
      name: Buffer.from(f.originalname, 'latin1').toString('utf8'),
      mime: f.mimetype,
      size: f.size,
    })),
  );
}));

// ---------- Publications (delivery queue) ----------
api.get('/publications', h(async (req, res) => res.json(await listPublications((req.query.status as string) || undefined))));
api.post('/publications/:id/retry', h(async (req, res) => {
  const id = idParam(req);
  await query(`UPDATE publications SET status='scheduled' WHERE id=$1 AND status='failed'`, [id]);
  res.json(await processPublication(id));
}));
api.post('/publications/:id/mark-sent', h(async (req, res) => {
  const p = await markPublicationSent(idParam(req));
  if (!p) return notFound(res, 'انتشار');
  res.json(p);
}));
api.delete('/publications/:id', h(async (req, res) => res.status((await cancelPublication(idParam(req))) ? 204 : 404).end()));

// ---------- Operations log ----------
api.get('/operations', h(async (req, res) => res.json(await listOperations(req.query.status as string | undefined))));
api.post('/operations/:id/retry', h(async (req, res) => res.json(await retryOperation(idParam(req)))));
api.post('/operations/retry-failed', h(async (_req, res) => res.json(await retryAllFailed())));

// ---------- Settings ----------
api.get('/settings', h(async (_req, res) => res.json(await getSettings())));
api.put('/settings', h(async (req, res) => {
  const values = z.record(z.string()).parse(req.body);
  await saveSettings(values);
  res.json(await getSettings());
}));
