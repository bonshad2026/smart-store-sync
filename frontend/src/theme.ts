import { tr } from './i18n';
import { useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
const MODE_KEY = 'sss_theme';
const BRAND_KEY = 'sss_brand';
export const DEFAULT_BRAND = '#5b4cf0';

/** Ready-made brand colours offered in Settings */
export const BRAND_PRESETS = [
  { color: '#111111', name: tr("مشکی کلاسیک") },
  { color: '#5b4cf0', name: tr("بنفش سلطنتی") },
  { color: '#2563eb', name: tr("آبی اقیانوسی") },
  { color: '#0891b2', name: tr("فیروزه‌ای") },
  { color: '#059669', name: tr("زمردی") },
  { color: '#ca8a04', name: tr("طلایی") },
  { color: '#ea580c', name: tr("نارنجی") },
  { color: '#e11d48', name: tr("قرمز یاقوتی") },
  { color: '#db2777', name: tr("صورتی") },
  { color: '#9333ea', name: tr("ارغوانی") },
  { color: '#334155', name: tr("خاکستری ذغالی") },
];

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

const media = () => window.matchMedia?.('(prefers-color-scheme: dark)');

export function resolvedTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') return media()?.matches ? 'dark' : 'light';
  return mode;
}

export function applyTheme(mode: ThemeMode) {
  document.documentElement.dataset.theme = resolvedTheme(mode);
}

export function isValidColor(c: string) {
  return /^#[0-9a-f]{6}$/i.test(c);
}

/** Relative luminance (0 = black, 1 = white) */
export function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/**
 * Sets the brand colour for the whole panel. Shades are derived in CSS; here we pick
 * a readable text colour for it and a substitute for dark mode when the brand is near-black.
 */
export function applyBrand(color: string) {
  const c = isValidColor(color) ? color : DEFAULT_BRAND;
  const root = document.documentElement.style;
  const lum = luminance(c);
  root.setProperty('--brand', c);
  root.setProperty('--on-brand', lum > 0.45 ? '#000000' : '#ffffff');
  root.setProperty('--brand-d', lum < 0.03 ? '#f2f2f2' : c);
  root.setProperty('--on-brand-d', lum < 0.03 || lum > 0.45 ? '#000000' : '#ffffff');
  write(BRAND_KEY, c);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', c);
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => (read(MODE_KEY) as ThemeMode) || 'system');
  // keep every useTheme() instance in sync (topbar toggle <-> settings page)
  useEffect(() => {
    const on = () => setModeState((read(MODE_KEY) as ThemeMode) || 'system');
    window.addEventListener('sss:theme', on);
    return () => window.removeEventListener('sss:theme', on);
  }, []);
  useEffect(() => {
    applyTheme(mode);
    if (mode !== 'system') return;
    const m = media();
    const on = () => applyTheme('system');
    m?.addEventListener?.('change', on);
    return () => m?.removeEventListener?.('change', on);
  }, [mode]);
  const setMode = (m: ThemeMode) => {
    write(MODE_KEY, m);
    setModeState(m);
    window.dispatchEvent(new Event('sss:theme'));
  };
  const toggle = () => setMode(resolvedTheme(mode) === 'dark' ? 'light' : 'dark');
  return { mode, setMode, toggle, resolved: resolvedTheme(mode) };
}
