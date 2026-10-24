import { toman } from './format';
import type { Product } from './products';

/** Types of marketing messages */
export const KINDS = {
  intro: 'معرفی محصول',
  discount: 'تخفیف ویژه',
  restock: 'موجود شد',
  price_change: 'تغییر قیمت',
} as const;
export type Kind = keyof typeof KINDS;
export const KIND_KEYS = Object.keys(KINDS) as Kind[];

/** Placeholders usable inside templates: {name}, {price}, ... */
export const PLACEHOLDERS: { key: string; label: string }[] = [
  { key: 'name', label: 'نام محصول' },
  { key: 'final_price', label: 'قیمت نهایی' },
  { key: 'price', label: 'قیمت اصلی' },
  { key: 'discount_price', label: 'قیمت با تخفیف' },
  { key: 'discount_percent', label: 'درصد تخفیف' },
  { key: 'old_price', label: 'قیمت قبلی' },
  { key: 'stock_status', label: 'وضعیت موجودی' },
  { key: 'stock', label: 'تعداد موجودی' },
  { key: 'description', label: 'توضیحات' },
  { key: 'category', label: 'دسته‌بندی' },
  { key: 'attributes', label: 'ویژگی‌ها' },
  { key: 'sku', label: 'کد کالا' },
  { key: 'store_name', label: 'نام فروشگاه' },
  { key: 'hashtags', label: 'هشتگ‌ها' },
];

export interface RenderContext {
  storeName: string;
  oldPrice?: string | number | null;
}

const tag = (s: string) => `#${s.trim().replace(/[\s‌]+/g, '_')}`;

export function productValues(p: Product, ctx: RenderContext): Record<string, string> {
  const price = Number(p.price);
  const disc = p.discount_price !== null && p.discount_price !== undefined ? Number(p.discount_price) : null;
  const hasDiscount = disc !== null && disc > 0 && disc < price;
  const percent = hasDiscount ? Math.round(((price - disc!) / price) * 100) : 0;
  const attrs = Object.entries(p.attributes || {})
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => `${k}: ${v}`);
  const hashtags = [p.category, p.name, ctx.storeName, 'خرید_آنلاین'].filter(Boolean).map((x) => tag(String(x)));
  return {
    name: p.name,
    sku: p.sku,
    price: toman(price),
    discount_price: hasDiscount ? toman(disc) : '',
    final_price: toman(hasDiscount ? disc : price),
    discount_percent: hasDiscount ? `${percent.toLocaleString('fa-IR')}٪` : '',
    old_price: ctx.oldPrice ? toman(ctx.oldPrice) : '',
    stock: Number(p.stock).toLocaleString('fa-IR'),
    stock_status: Number(p.stock) > 0 ? 'موجود' : 'ناموجود',
    description: p.description || '',
    category: p.category || '',
    attributes: attrs.join('\n'),
    store_name: ctx.storeName,
    hashtags: Array.from(new Set(hashtags)).join(' '),
  };
}

/**
 * Fills {placeholders}. A line whose placeholders are ALL empty is removed,
 * so e.g. a "price before discount" line disappears when there is no discount.
 */
export function renderTemplate(body: string, p: Product, ctx: RenderContext): string {
  const values = productValues(p, ctx);
  const lines = body.split('\n').flatMap((line) => {
    const keys = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => k in values);
    if (keys.length && keys.every((k) => !values[k])) return [];
    return [line.replace(/\{(\w+)\}/g, (all, k) => (k in values ? values[k] : all))];
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Built-in starter templates for each platform and message kind */
export const DEFAULT_TEMPLATES: Record<string, Partial<Record<Kind, { title?: string; body: string }>>> = {
  telegram: {
    intro: { body: '🛍 <b>{name}</b>\n\n{description}\n\n{attributes}\n\n💰 قیمت: {final_price}\n📦 {stock_status}\n\n🆔 کد کالا: {sku}\n{hashtags}' },
    discount: { body: '🔥 <b>تخفیف ویژه {store_name}</b> 🔥\n\n{name}\n\n❌ قیمت قبل: <s>{price}</s>\n✅ قیمت با تخفیف: <b>{discount_price}</b> ({discount_percent} تخفیف)\n\n⏳ فرصت محدود است!\n{hashtags}' },
    restock: { body: '🎉 <b>{name}</b> دوباره موجود شد!\n\n💰 قیمت: {final_price}\n📦 تعداد محدود\n\nبرای سفارش عجله کنید 🛒' },
    price_change: { body: '📢 به‌روزرسانی قیمت\n\n<b>{name}</b>\nقیمت قبلی: <s>{old_price}</s>\nقیمت جدید: <b>{final_price}</b>' },
  },
  instagram: {
    intro: { body: '✨ {name} ✨\n\n{description}\n\n{attributes}\n\n💰 قیمت: {final_price}\n📦 {stock_status}\n\n📩 برای سفارش دایرکت بدید\n\n{hashtags}' },
    discount: { body: '🔥 فقط برای مدت محدود 🔥\n\n{name}\nقیمت قبل: {price}\nقیمت ویژه: {discount_price} 🎁 ({discount_percent} تخفیف)\n\n📩 سفارش از طریق دایرکت\n\n{hashtags} #تخفیف' },
    restock: { body: '🎉 {name} دوباره موجود شد!\n\nقیمت: {final_price}\nموجودی محدوده، از دستش نده 💫\n\n{hashtags}' },
    price_change: { body: '📢 {name}\nقیمت جدید: {final_price}\n\n{hashtags}' },
  },
  website: {
    intro: { body: '{name}\n\n{description}\n\nمشخصات:\n{attributes}\n\nقیمت: {final_price}' },
    discount: { body: '{name} — با {discount_percent} تخفیف\n\n{description}\n\nقیمت اصلی: {price}\nقیمت با تخفیف: {discount_price}' },
    restock: { body: '{name} مجدداً موجود شد.\n\n{description}\n\nقیمت: {final_price}' },
    price_change: { body: '{name}\n\nقیمت به‌روز شده: {final_price}' },
  },
  sms: {
    intro: { body: '{store_name}: {name}، فقط {final_price}. همین حالا سفارش دهید.' },
    discount: { body: '{store_name}: تخفیف {discount_percent} {name}، فقط {discount_price}. فرصت محدود!' },
    restock: { body: '{store_name}: {name} دوباره موجود شد. قیمت: {final_price}' },
    price_change: { body: '{store_name}: قیمت جدید {name}: {final_price}' },
  },
  email: {
    intro: { title: 'معرفی محصول جدید: {name}', body: 'سلام،\n\nبا افتخار {name} را معرفی می‌کنیم.\n\n{description}\n\n{attributes}\n\nقیمت: {final_price}\n\nبا احترام،\n{store_name}' },
    discount: { title: '🔥 {discount_percent} تخفیف روی {name}', body: 'سلام،\n\n{name} برای مدت محدود با تخفیف ویژه عرضه می‌شود.\n\nقیمت اصلی: {price}\nقیمت با تخفیف: {discount_price}\n\nبا احترام،\n{store_name}' },
    restock: { title: '{name} دوباره موجود شد', body: 'سلام،\n\n{name} که منتظرش بودید دوباره موجود شد.\nقیمت: {final_price}\n\nبا احترام،\n{store_name}' },
    price_change: { title: 'قیمت جدید {name}', body: 'سلام،\n\nقیمت {name} به {final_price} تغییر کرد.\n\nبا احترام،\n{store_name}' },
  },
};

/** Generic template used for user-defined platforms */
export const GENERIC_TEMPLATES: Record<Kind, { title?: string; body: string }> = {
  intro: { title: '{name}', body: '{name}\n\n{description}\n\nقیمت: {final_price}\n{stock_status}' },
  discount: { title: 'تخفیف {name}', body: '{name}\nقیمت قبل: {price}\nقیمت با تخفیف: {discount_price} ({discount_percent})' },
  restock: { title: '{name} موجود شد', body: '{name} دوباره موجود شد.\nقیمت: {final_price}' },
  price_change: { title: 'قیمت جدید {name}', body: '{name}\nقیمت جدید: {final_price}' },
};

export function builtinTemplate(platformKey: string, kind: Kind) {
  return DEFAULT_TEMPLATES[platformKey]?.[kind] || GENERIC_TEMPLATES[kind];
}

/** A realistic sample product used for live template previews in the dashboard */
export const SAMPLE_PRODUCT: Product = {
  id: 0,
  sku: 'TSH-001',
  name: 'تی‌شرت نخی مردانه',
  description: 'تی‌شرت ۱۰۰٪ نخ پنبه با دوخت تمیز و یقه گرد',
  price: 500000,
  discount_price: 450000,
  stock: 25,
  category: 'پوشاک مردانه',
  image_url: '',
  images: [],
  attributes: { رنگ: 'سفید', سایز: 'L' },
  is_active: true,
  source: 'sample',
  created_at: '',
  updated_at: '',
};
