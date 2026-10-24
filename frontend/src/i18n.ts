import { EN } from './i18n.en';

export type Lang = 'fa' | 'en';

const read = (): Lang => {
  try {
    return localStorage.getItem('sss_lang') === 'en' ? 'en' : 'fa';
  } catch {
    return 'fa';
  }
};

/** Current UI language (switching reloads the page, so this is constant for a session) */
export const LANG: Lang = read();
export const DIR: 'rtl' | 'ltr' = LANG === 'fa' ? 'rtl' : 'ltr';
/** Locale for numbers & dates */
export const LOCALE = LANG === 'fa' ? 'fa-IR' : 'en-US';

/** Translates a Persian UI string (the Persian text itself is the key) */
export function tr(fa: string): string {
  if (LANG === 'fa') return fa;
  return EN[fa] ?? EN[fa.trim()] ?? fa;
}

export function setLang(lang: Lang) {
  try {
    localStorage.setItem('sss_lang', lang);
  } catch {
    /* ignore */
  }
  window.location.reload();
}

/** English names for the built-in networks (their names are stored in Persian in the database) */
const PLATFORM_EN: Record<string, string> = {
  telegram: 'Telegram',
  instagram: 'Instagram',
  website: 'Website',
  sms: 'SMS',
  email: 'Email',
};

/**
 * Localises data returned by the API: built-in platform names are translated
 * (the original is kept in `name_orig` so edit forms save the stored value).
 */
export function localizeData<T>(data: T): T {
  if (LANG === 'fa' || data === null || typeof data !== 'object') return data;
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== 'object') return v;
    const out: any = {};
    for (const [k, val] of Object.entries(v)) out[k] = typeof val === 'object' ? walk(val) : val;
    if (typeof out.key === 'string' && PLATFORM_EN[out.key] && typeof out.name === 'string' && out.is_builtin !== false) {
      out.name_orig = out.name;
      out.name = PLATFORM_EN[out.key];
    }
    const pk = out.platform_key || out.channel;
    if (typeof pk === 'string' && PLATFORM_EN[pk] && typeof out.platform_name === 'string') out.platform_name = PLATFORM_EN[pk];
    return out;
  };
  return walk(data);
}
