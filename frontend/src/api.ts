import { LOCALE, localizeData, tr } from './i18n';
// ------------------------------------------------------------------ types

export type Kind = 'intro' | 'discount' | 'restock' | 'price_change';
export type Delivery = 'telegram' | 'instagram' | 'email' | 'webhook' | 'manual';

export interface Product {
  id: number;
  sku: string;
  name: string;
  description: string;
  price: string | number;
  discount_price: string | number | null;
  stock: number;
  category: string;
  image_url: string;
  images: string[];
  attributes: Record<string, string>;
  source: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

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
  destinations_count?: number;
  templates_count?: number;
}

export interface Destination {
  id: number;
  platform_id: number;
  name: string;
  config: Record<string, any>;
  enabled: boolean;
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
  media: MediaItem[];
  links: LinkItem[];
  product_media: ProductMediaMode;
}

export interface PublicationBrief {
  id: number;
  destination_id: number;
  destination_name: string;
  status: PubStatus;
  scheduled_at: string | null;
  sent_at: string | null;
  message: string;
}
export type PubStatus = 'scheduled' | 'sending' | 'sent' | 'failed' | 'manual';

export type MediaType = 'image' | 'video' | 'audio';
export type ProductMediaMode = 'none' | 'main' | 'all';
export interface MediaItem {
  type: MediaType;
  url: string;
  name?: string;
  mime?: string;
  size?: number;
}
export interface LinkItem {
  title: string;
  url: string;
  /** 'reply' = interactive Telegram button that answers the user */
  kind?: 'link' | 'reply' | 'interaction';
  id?: string;
  interaction_id?: number;
  reply?: string;
  mode?: 'popup' | 'chat';
}

export const isReplyButton = (l: LinkItem) => l.kind === 'reply';

export type StepType = 'message' | 'text' | 'choice' | 'contact' | 'payment';
export interface InteractionStep { type: StepType; text: string; key?: string; options?: string[]; button?: string; url?: string }
export interface Interaction {
  id: number;
  title: string;
  emoji: string;
  description: string;
  mode: 'flow' | 'popup';
  popup_text: string;
  steps: InteractionStep[];
  final_message: string;
  notify_admin: boolean;
  enabled: boolean;
  sort_order: number;
  taps?: number;
  started?: number;
  completed?: number;
}
export interface InteractionSession {
  id: number;
  interaction_id: number;
  interaction_title: string;
  interaction_emoji: string;
  total_steps: number;
  content_id: number | null;
  tg_name: string;
  tg_username: string;
  chat_id: string;
  step: number;
  answers: { key: string; question: string; answer: string }[];
  status: 'active' | 'completed' | 'cancelled';
  reply: string;
  seen: boolean;
  created_at: string;
  updated_at: string;
  product_id: number | null;
  product_name: string | null;
  product_image: string | null;
  platform_name: string | null;
}
/** true when a link / interactive button is incomplete */
export const linkInvalid = (l: LinkItem) =>
  l.kind === 'interaction' ? !l.interaction_id : isReplyButton(l)
    ? !l.title.trim() || !(l.reply || '').trim() || ((l.mode || 'popup') === 'popup' && (l.reply || '').trim().length > 200)
    : !l.title.trim() || !/^https?:\/\//.test(l.url.trim());
/** Trimmed copy of the buttons for saving */
export const cleanLinks = (links: LinkItem[]) =>
  links.map((l) =>
    l.kind === 'interaction'
      ? { kind: 'interaction' as const, interaction_id: l.interaction_id, title: l.title, url: '' }
      : isReplyButton(l)
      ? { kind: 'reply' as const, id: l.id, title: l.title.trim(), url: '', reply: (l.reply || '').trim(), mode: l.mode || 'popup' }
      : { title: l.title.trim(), url: l.url.trim() });

export interface Content {
  id: number;
  product_id: number;
  product_name: string;
  product_image: string;
  sku: string;
  channel: string;
  kind: Kind;
  title: string;
  body: string;
  status: 'pending' | 'approved' | 'rejected' | 'published';
  generated_by: 'ai' | 'template' | 'manual';
  platform_id: number;
  platform_name: string;
  platform_color: string;
  platform_icon: string;
  platform_delivery: Delivery;
  max_length: number | null;
  publications: PublicationBrief[];
  created_at: string;
  media: MediaItem[];
  links: LinkItem[];
  use_product_image: boolean;
  product_media: ProductMediaMode;
  product_images: string[];
}

export interface Publication extends PublicationBrief {
  content_id: number;
  title: string;
  body: string;
  channel: string;
  kind: Kind;
  product_id: number;
  product_name: string;
  product_image: string;
  platform_name: string;
  platform_color: string;
  platform_icon: string;
  attempts: number;
  created_at: string;
  media: MediaItem[];
  links: LinkItem[];
  use_product_image: boolean;
  product_media: ProductMediaMode;
  product_images: string[];
}

export interface Change {
  id: number;
  product_id: number;
  product_name: string;
  sku: string;
  image_url?: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  source: string;
  created_at: string;
}

export interface Operation {
  id: number;
  type: string;
  status: 'success' | 'failed' | 'retrying';
  payload: Record<string, unknown>;
  message: string;
  attempts: number;
  created_at: string;
  updated_at: string;
}

// ------------------------------------------------------------------ client

// ---- login session: an HttpOnly cookie set by the server (never readable from JavaScript) ----

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'member';
  email_verified: boolean;
  created_at: string;
  last_login_at: string | null;
  password_changed_at: string | null;
}

export interface SessionInfo {
  id: number;
  user_agent: string;
  ip: string;
  created_at: string;
  last_used_at: string;
  expires_at: string;
  current: boolean;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  // same-origin fetch sends the session cookie automatically
  const res = await fetch(`/api${url}`, { method, headers, body: payload });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  // Session expired / revoked, or e-mail not verified yet: let the app switch screens
  if (!url.startsWith('/auth/')) {
    if (res.status === 401 && data.code === 'unauthenticated') window.dispatchEvent(new Event('sss:logout'));
    if (res.status === 403 && data.code === 'unverified') window.dispatchEvent(new Event('sss:unverified'));
  }
  if (!res.ok) {
    const details = Array.isArray(data.details) ? ` (${data.details.join(tr("، "))})` : '';
    throw new Error((data.error || `${tr("خطای")} ${res.status}`) + details);
  }
  return localizeData(data) as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  del: (url: string) => request<void>('DELETE', url),
  upload: <T>(url: string, form: FormData) => request<T>('POST', url, form),
};

export const authApi = {
  status: () => api.get<{ has_users: boolean; registration_open: boolean }>('/auth/status'),
  me: () => api.get<{ user: User }>('/auth/me'),
  login: (email: string, password: string) => api.post<{ user: User }>('/auth/login', { email, password }),
  register: (name: string, email: string, password: string) => api.post<{ user: User }>('/auth/register', { name, email, password }),
  logout: () => api.post<void>('/auth/logout').catch(() => undefined),
  verifyEmail: (token: string) => api.post<{ ok: true }>('/auth/verify-email', { token }),
  resendVerification: () => api.post<{ ok: true }>('/auth/resend-verification'),
  forgotPassword: (email: string) => api.post<{ ok: true }>('/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) => api.post<{ ok: true }>('/auth/reset-password', { token, password }),
  updateProfile: (body: { name: string; email: string; current_password?: string }) => api.put<{ user: User }>('/auth/profile', body),
  changePassword: (current_password: string, new_password: string) =>
    api.post<{ revoked: number }>('/auth/change-password', { current_password, new_password }),
  sessions: () => api.get<SessionInfo[]>('/auth/sessions'),
  revokeSession: (id: number) => api.del(`/auth/sessions/${id}`),
  revokeOtherSessions: () => api.post<{ revoked: number }>('/auth/sessions/revoke-others'),
};

// ------------------------------------------------------------------ helpers

export const fa = (n: number | string | null | undefined) =>
  n === null || n === undefined || n === '' ? '—' : Number(n).toLocaleString(LOCALE);

export const toman = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === '' ? '—' : `${Number(v).toLocaleString(LOCALE)} ${tr("تومان")}`;

export const faDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString(LOCALE, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export function timeAgo(d: string | null | undefined) {
  if (!d) return '—';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return tr("لحظاتی پیش");
  const m = Math.round(s / 60);
  if (m < 60) return `${fa(m)} ${tr("دقیقه پیش")}`;
  const h = Math.round(m / 60);
  if (h < 24) return `${fa(h)} ${tr("ساعت پیش")}`;
  const days = Math.round(h / 24);
  if (days < 30) return `${fa(days)} ${tr("روز پیش")}`;
  return faDate(d);
}

export const finalPrice = (p: Product) =>
  p.discount_price && Number(p.discount_price) > 0 && Number(p.discount_price) < Number(p.price) ? Number(p.discount_price) : Number(p.price);

export const discountPercent = (p: Product) =>
  finalPrice(p) < Number(p.price) ? Math.round(((Number(p.price) - finalPrice(p)) / Number(p.price)) * 100) : 0;

export const KIND_LABELS: Record<Kind, string> = {
  intro: tr("معرفی محصول"),
  discount: tr("تخفیف ویژه"),
  restock: tr("موجود شد"),
  price_change: tr("تغییر قیمت"),
};

export const KIND_HINTS: Record<Kind, string> = {
  intro: tr("معرفی کامل محصول با قیمت و ویژگی‌ها"),
  discount: tr("اطلاع‌رسانی تخفیف با قیمت قبل و بعد"),
  restock: tr("خبر موجود شدن دوباره محصول"),
  price_change: tr("اطلاع‌رسانی قیمت جدید"),
};

export const DELIVERY_LABELS: Record<Delivery, string> = {
  telegram: tr("ارسال خودکار با ربات تلگرام"),
  instagram: tr("انتشار خودکار در پیج اینستاگرام"),
  email: tr("ارسال خودکار ایمیل (SMTP)"),
  webhook: tr("ارسال خودکار به وب‌هوک / API"),
  manual: tr("آماده‌سازی متن برای انتشار دستی"),
};

export const CONTENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: tr("در انتظار تأیید"), tone: 'warning' },
  approved: { label: tr("تأیید شده"), tone: 'info' },
  rejected: { label: tr("رد شده"), tone: 'neutral' },
  published: { label: tr("منتشر شده"), tone: 'success' },
};

export const PUB_STATUS: Record<string, { label: string; tone: Tone }> = {
  scheduled: { label: tr("زمان‌بندی شده"), tone: 'info' },
  sending: { label: tr("در حال ارسال"), tone: 'info' },
  sent: { label: tr("ارسال شد"), tone: 'success' },
  failed: { label: tr("ناموفق"), tone: 'danger' },
  manual: { label: tr("آماده انتشار دستی"), tone: 'warning' },
};

export const OP_STATUS: Record<string, { label: string; tone: Tone }> = {
  success: { label: tr("موفق"), tone: 'success' },
  failed: { label: tr("ناموفق"), tone: 'danger' },
  retrying: { label: tr("در حال تلاش مجدد"), tone: 'info' },
};

export const OP_LABELS: Record<string, string> = {
  import_csv: tr("ورود CSV"),
  generate_content: tr("تولید محتوا"),
  publish: tr("انتشار"),
  publish_telegram: tr("انتشار تلگرام"),
  notify_n8n: tr("ارسال به n8n"),
  sync: tr("همگام‌سازی"),
};

export const FIELD_LABELS: Record<string, string> = {
  price: tr("قیمت"),
  discount_price: tr("قیمت تخفیفی"),
  stock: tr("موجودی"),
  name: tr("نام"),
  description: tr("توضیحات"),
};

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'brand';

export const stripTags = (s: string) => s.replace(/<\/?(b|i|s|u|code)>/g, '');

export const fileSize = (b?: number) =>
  !b ? '' : b > 1024 * 1024 ? `${(b / 1024 / 1024).toLocaleString(LOCALE, { maximumFractionDigits: 1 })} ${tr("مگابایت")}` : `${Math.round(b / 1024).toLocaleString(LOCALE)} ${tr("کیلوبایت")}`;

/** Product galleries store plain URLs; detect videos by extension */
export const isVideoUrl = (url?: string | null) =>
  !!url && (/^data:video\//.test(url) || /\.(mp4|webm|mov|m4v|ogv|mkv)(\?|$)/i.test(url));

/** Product media to include in a post, according to the content's product-media mode */
export function productMediaItems(gallery: string[] | null | undefined, mode: ProductMediaMode, fallback?: string): MediaItem[] {
  const urls = gallery?.length ? gallery : fallback ? [fallback] : [];
  const picked = mode === 'all' ? urls : mode === 'main' ? urls.slice(0, 1) : [];
  return picked.map((url) => ({ type: isVideoUrl(url) ? 'video' : 'image', url }));
}

export const PRODUCT_MEDIA_LABELS: Record<ProductMediaMode, string> = {
  none: tr("بدون رسانه محصول"),
  main: tr("رسانه اصلی محصول"),
  all: tr("کل گالری محصول"),
};
