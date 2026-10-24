import { useEffect, useState } from 'react';

const readHash = () => window.location.hash.replace(/^#/, '') || '/';

/** Minimal hash router: #/products/12?q=x -> { path: '/products/12', parts: ['products','12'], query } */
export function useRoute() {
  const [hash, setHash] = useState(readHash);
  useEffect(() => {
    const on = () => {
      const next = readHash();
      if (next.split('?')[0] !== hash.split('?')[0]) window.scrollTo(0, 0);
      setHash(next);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [hash]);
  const [path, qs = ''] = hash.split('?');
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(qs) };
}

export const navigate = (path: string) => {
  window.location.hash = path;
};

export const href = (path: string) => `#${path}`;

// ---- in-app history depth, so "back" buttons can return to the previous page ----
const idx = () => (window.history.state && typeof window.history.state.sssIdx === 'number' ? window.history.state.sssIdx : null);
let lastIdx = idx() ?? 0;
if (idx() === null) window.history.replaceState({ ...(window.history.state || {}), sssIdx: 0 }, '');
window.addEventListener('hashchange', () => {
  const cur = idx();
  if (cur === null) {
    lastIdx += 1;
    window.history.replaceState({ ...(window.history.state || {}), sssIdx: lastIdx }, '');
  } else lastIdx = cur;
});

/** Goes back inside the app when possible, otherwise to `fallback` */
export function goBack(fallback = '/') {
  if ((idx() ?? 0) > 0) window.history.back();
  else navigate(fallback);
}

/** Sets (or removes) one query parameter of the current hash route */
export function setQueryParam(key: string, value: string | null, replace = false) {
  const [path, qs = ''] = readHash().split('?');
  const q = new URLSearchParams(qs);
  if (value === null) q.delete(key);
  else q.set(key, value);
  const next = `#${path}${q.toString() ? `?${q}` : ''}`;
  if (replace) {
    window.history.replaceState(window.history.state, '', next);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else window.location.hash = next.slice(1);
}
