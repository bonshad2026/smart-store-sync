import { config } from '../config';
import { toman } from './format';
import type { Platform } from './platforms';
import type { Product } from './products';
import { Kind, KINDS, renderTemplate } from './templates';

export const aiEnabled = () => !!config.ai.apiKey;

const KIND_GUIDE: Record<Kind, string> = {
  intro: 'هدف: معرفی محصول و ترغیب به خرید.',
  discount: 'هدف: اطلاع‌رسانی تخفیف ویژه؛ قیمت قبل و بعد از تخفیف و محدود بودن فرصت را برجسته کن.',
  restock: 'هدف: اطلاع‌رسانی اینکه محصول دوباره موجود شده است.',
  price_change: 'هدف: اطلاع‌رسانی قیمت جدید محصول.',
};

/** Fact sheet built from REAL product data so the model does not invent prices or features */
export function productFacts(p: Product, oldPrice?: string | number | null): string {
  const lines = [
    `نام: ${p.name}`,
    `کد کالا: ${p.sku}`,
    `قیمت: ${toman(p.price)}`,
    p.discount_price ? `قیمت با تخفیف: ${toman(p.discount_price)}` : '',
    oldPrice ? `قیمت قبلی: ${toman(oldPrice)}` : '',
    `موجودی: ${Number(p.stock) > 0 ? `${p.stock} عدد موجود` : 'ناموجود'}`,
    p.category ? `دسته‌بندی: ${p.category}` : '',
    p.description ? `توضیحات: ${p.description}` : '',
    ...Object.entries(p.attributes || {}).map(([k, v]) => `${k}: ${v}`),
  ];
  return lines.filter(Boolean).join('\n');
}

export interface GenerateArgs {
  product: Product;
  platform: Platform;
  kind: Kind;
  template: { title: string; body: string };
  storeName: string;
  tone: string;
  useAi: boolean;
  oldPrice?: string | number | null;
}

export interface GeneratedText {
  title: string;
  body: string;
  generatedBy: 'ai' | 'template';
}

/**
 * Produces the text for one platform:
 *  - template mode: fills the template with real product data
 *  - AI mode: the model writes a new text following the platform style, using the filled template as reference
 */
export async function generateText(a: GenerateArgs): Promise<GeneratedText> {
  const ctx = { storeName: a.storeName, oldPrice: a.oldPrice };
  const filled = { title: renderTemplate(a.template.title || '', a.product, ctx), body: renderTemplate(a.template.body, a.product, ctx) };
  if (!a.useAi || !aiEnabled()) return { ...filled, generatedBy: 'template' };

  const system =
    `تو یک کپی‌رایتر حرفه‌ای فارسی‌زبان برای فروشگاه «${a.storeName}» هستی. لحن برند: ${a.tone}.\n` +
    'قوانین مهم: فقط از اطلاعات داده‌شده استفاده کن. هیچ قیمت، ویژگی، گارانتی یا ادعایی را از خودت اضافه نکن. ' +
    'اعداد قیمت را دقیقاً همان‌طور که داده شده بنویس. فقط متن نهایی را بدون توضیح اضافه برگردان.' +
    (a.platform.delivery === 'telegram' ? ' برای تأکید فقط از تگ‌های <b> و <s> استفاده کن.' : ' از هیچ تگ HTML استفاده نکن.');
  const user = [
    `شبکه: ${a.platform.name}`,
    `سبک نوشتن برای این شبکه: ${a.platform.style_guide || 'متن تبلیغاتی کوتاه و جذاب'}`,
    a.platform.max_length ? `حداکثر طول متن: ${a.platform.max_length} کاراکتر` : '',
    `نوع پیام: ${KINDS[a.kind]} — ${KIND_GUIDE[a.kind]}`,
    '',
    'اطلاعات محصول:',
    productFacts(a.product, a.oldPrice),
    '',
    'نمونه ساختار مورد نظر (از ساختار و لحن آن الهام بگیر، اما متن را بازنویسی و جذاب‌تر کن):',
    filled.body,
  ]
    .filter((l) => l !== undefined)
    .join('\n');

  const res = await fetch(`${config.ai.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.ai.apiKey}` },
    body: JSON.stringify({
      model: config.ai.model,
      max_tokens: config.ai.maxTokens,
      temperature: 0.7,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`AI API error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  let body = data.choices?.[0]?.message?.content?.trim();
  if (!body) throw new Error('AI API returned empty content');
  if (a.platform.max_length && body.length > a.platform.max_length) body = body.slice(0, a.platform.max_length);
  return { title: filled.title, body, generatedBy: 'ai' };
}
