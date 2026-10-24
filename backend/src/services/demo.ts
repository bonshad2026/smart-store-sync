import { query } from '../db/pool';
import { getSetting, saveSettings } from './settings';

const setSetting = (key: string, value: string) => saveSettings({ [key]: value });

/**
 * Demo data so the dashboard, history and charts are not empty on a fresh install.
 * Runs once (guarded by the `demo_seeded` setting). Nothing here is delivered to a
 * real channel: demo publications only target manual destinations (Instagram / website)
 * and are inserted as already-finished records.
 */

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const daysAgo = (d: number, h = 0) => new Date(Date.now() - d * 86400000 - h * 3600000).toISOString();
const fmt = (n: number) => Number(n).toLocaleString('fa-IR');

interface P { id: number; name: string; price: string; discount_price: string | null; stock: number; category: string }

async function ensurePlatformDest(key: string, name: string, config: Record<string, string>) {
  const [p] = await query<{ id: number }>(`UPDATE platforms SET enabled = TRUE WHERE key = $1 RETURNING id`, [key]);
  if (!p) return null;
  const [d] = await query<{ id: number }>(`SELECT id FROM destinations WHERE platform_id = $1 ORDER BY id LIMIT 1`, [p.id]);
  if (d) return d.id;
  const [n] = await query<{ id: number }>(
    `INSERT INTO destinations (platform_id, name, config) VALUES ($1, $2, $3) RETURNING id`,
    [p.id, name, JSON.stringify(config)],
  );
  return n.id;
}

function body(p: P, kind: string, channel: string) {
  const price = Number(p.discount_price || p.price);
  const tags = channel === 'instagram' ? `\n\n#${p.category.replace(/\s+/g, '_')} #خرید_آنلاین #بن‌شاد` : '';
  if (kind === 'discount' && p.discount_price) {
    const pct = Math.round((1 - Number(p.discount_price) / Number(p.price)) * 100);
    return `🔥 تخفیف ویژه ${p.name}\n\nقیمت قبل: ${fmt(Number(p.price))} تومان\nقیمت جدید: ${fmt(price)} تومان (${fmt(pct)}٪ تخفیف)\n\nفرصت محدود است؛ همین حالا سفارش دهید.${tags}`;
  }
  if (kind === 'restock') return `✅ ${p.name} دوباره موجود شد!\n\nقیمت: ${fmt(price)} تومان\nموجودی محدود — تا تمام نشده سفارش دهید.${tags}`;
  if (kind === 'price_change') return `📢 قیمت جدید ${p.name}\n\n${fmt(price)} تومان\nبا ضمانت اصالت کالا و ارسال سریع.${tags}`;
  return `✨ معرفی ${p.name}\n\nدسته: ${p.category || 'لوازم خانگی'}\nقیمت: ${fmt(price)} تومان\n\nکیفیت بالا، گارانتی معتبر و ارسال به سراسر کشور.${tags}`;
}

export async function seedDemoData() {
  if ((await getSetting('demo_seeded')) === 'true') return;
  const products = await query<P>(`SELECT id, name, price, discount_price, stock, category FROM products ORDER BY id LIMIT 20`);
  if (products.length < 3) return; // nothing to build on yet; try again on next start

  if (!(await getSetting('logo_url'))) await setSetting('logo_url', '/brand/bonshad-logo.png');

  const insta = await ensurePlatformDest('instagram', 'پیج اصلی اینستاگرام', { account: '@bonshad_shop' });
  const web = await ensurePlatformDest('website', 'صفحه محصولات سایت', { account: 'bonshad.ir/products' });
  const dests = [insta, web].filter(Boolean) as number[];

  // 1) product change history (last 14 days)
  for (let i = 0; i < 18; i++) {
    const p = pick(products);
    const d = Math.floor(rnd() * 14);
    const field = pick(['price', 'stock', 'discount_price', 'stock']);
    const base = Number(p.price);
    const [oldV, newV] = field === 'stock'
      ? [String(Math.floor(rnd() * 6)), String(5 + Math.floor(rnd() * 30))]
      : field === 'price'
        ? [String(Math.round(base * (1 + rnd() * 0.12) / 10000) * 10000), String(base)]
        : [null, String(Math.round(base * (0.8 + rnd() * 0.1) / 10000) * 10000)];
    await query(
      `INSERT INTO product_changes (product_id, field, old_value, new_value, source, processed, created_at)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6)`,
      [p.id, field, oldV, newV, pick(['csv', 'manual', 'store']), daysAgo(d, rnd() * 10)],
    );
  }

  // 2) contents + publications
  const kinds = ['intro', 'discount', 'restock', 'price_change'];
  for (let i = 0; i < 26; i++) {
    const p = products[i % products.length];
    const channel = i % 3 === 0 ? 'website' : 'instagram';
    const dest = channel === 'website' ? web : insta;
    if (!dest) continue;
    const kind = p.discount_price && rnd() > 0.4 ? 'discount' : pick(kinds.filter((k) => k !== 'discount'));
    const d = Math.floor(rnd() * 14);
    const status = i < 4 ? 'pending' : i < 6 ? 'approved' : 'published';
    const created = daysAgo(d + 0.3, rnd() * 6);
    const [c] = await query<{ id: number }>(
      `INSERT INTO contents (product_id, channel, body, status, generated_by, kind, title, destination_id, created_at, reviewed_at, published_at)
       VALUES ($1,$2,$3,$4,$5,$6,'',$7,$8,$9,$10) RETURNING id`,
      [p.id, channel, body(p, kind, channel), status, pick(['template', 'template', 'manual']), kind, dest, created,
        status === 'pending' ? null : daysAgo(d), status === 'published' ? daysAgo(d) : null],
    );
    if (status === 'published') {
      await query(
        `INSERT INTO publications (content_id, destination_id, status, sent_at, attempts, message, created_at)
         VALUES ($1, $2, 'sent', $3, 1, 'منتشر شد', $3)`,
        [c.id, dest, daysAgo(d, rnd() * 8)],
      );
    } else if (status === 'approved') {
      await query(
        `INSERT INTO publications (content_id, destination_id, status, attempts, message, created_at)
         VALUES ($1, $2, 'manual', 0, 'آماده انتشار دستی', NOW())`,
        [c.id, pick(dests)],
      );
    }
  }

  // 3) operations log
  const ops: [string, string, string, number][] = [
    ['import_csv', 'success', 'ورود ۲۰ محصول از فایل home-appliances-20.csv — ۲۰ جدید، ۰ به‌روزرسانی', 13],
    ['generate_content', 'success', 'ساخت ۶ محتوا برای اینستاگرام و وب‌سایت از روی قالب‌های پیش‌فرض', 12],
    ['publish', 'success', 'انتشار دستی در «پیج اصلی اینستاگرام» ثبت شد', 11],
    ['import_csv', 'failed', 'خطا در ردیف ۱۴: مقدار ستون price عدد معتبر نیست («۱۲٬۵۰۰٬۰۰۰ تومان»). اعداد را بدون واحد و جداکننده وارد کنید و فایل را دوباره بارگذاری کنید؛ سایر ردیف‌ها با موفقیت وارد شدند.', 9],
    ['generate_content', 'success', 'ساخت ۴ محتوای تخفیف پس از تغییر قیمت محصولات', 8],
    ['sync', 'success', 'همگام‌سازی موجودی ۲۰ محصول با کاتالوگ مرکزی انجام شد', 6],
    ['publish', 'success', 'انتشار در «صفحه محصولات سایت» ثبت شد', 5],
    ['sync', 'failed', 'اتصال به سرویس همگام‌سازی برقرار نشد (timeout پس از ۳۰ ثانیه). سرویس n8n در دسترس نیست یا آدرس N8N_WEBHOOK_URL در فایل .env تنظیم نشده است.', 3],
    ['generate_content', 'success', 'ساخت ۳ محتوای معرفی محصول جدید', 2],
    ['publish', 'success', 'انتشار دستی در «پیج اصلی اینستاگرام» ثبت شد', 1],
    ['import_csv', 'success', 'به‌روزرسانی قیمت ۵ محصول از فایل CSV', 0],
  ];
  for (const [type, status, message, d] of ops) {
    const t = daysAgo(d, rnd() * 5);
    await query(
      `INSERT INTO operations (type, status, payload, message, attempts, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6)`,
      [type, status, JSON.stringify({ demo: true }), message, status === 'failed' ? 2 : 1, t],
    );
  }

  await setSetting('demo_seeded', 'true');
  console.log('✔ Demo data added (contents, history, operations)');
}
