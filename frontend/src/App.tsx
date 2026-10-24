import { LANG, LOCALE, setLang, tr } from './i18n';
import { FormEvent, useEffect, useState } from 'react';
import { api } from './api';
import Icon from './components/Icon';
import { UiProvider } from './components/ui';
import { href, navigate, useRoute } from './router';
import { applyBrand, useTheme } from './theme';
import Channels from './pages/Channels';
import Contents from './pages/Contents';
import Dashboard from './pages/Dashboard';
import Operations from './pages/Operations';
import PlatformDetail from './pages/PlatformDetail';
import ProductDetail from './pages/ProductDetail';
import Products from './pages/Products';
import Settings from './pages/Settings';
import Help from './pages/Help';
import Feedback from './pages/Feedback';
import Interactions from './pages/Interactions';
import Automation from './pages/Automation';
import { AppMark } from './components/BrandLogo';

const NAV = [
  { group: tr("اصلی"), items: [
    { path: '/', label: tr("داشبورد"), icon: 'dashboard' },
    { path: '/products', label: tr("محصولات"), icon: 'box' },
    { path: '/content', label: tr("محتوا و انتشار"), icon: 'sparkles', badge: 'pending' },
    { path: '/interactions', label: tr("تعامل خودکار"), icon: 'zap', badge: 'interactions' },
    { path: '/feedback', label: tr("بازخورد کاربران"), icon: 'inbox', badge: 'feedback' },
  ] },
  { group: tr("پیکربندی"), items: [
    { path: '/channels', label: tr("کانال‌های انتشار"), icon: 'share' },
    { path: '/automation', label: tr("اتوماسیون (n8n)"), icon: 'layers' },
    { path: '/operations', label: tr("تاریخچه عملیات"), icon: 'history', badge: 'failed' },
    { path: '/settings', label: tr("تنظیمات"), icon: 'settings' },
  ] },
  { group: tr("پشتیبانی"), items: [
    { path: '/help', label: tr("راهنمای کار با سایت"), icon: 'help' },
  ] },
];

function Page({ parts }: { parts: string[] }) {
  const [a, b] = parts;
  if (a === 'products' && b) return <ProductDetail id={Number(b)} />;
  if (a === 'products') return <Products />;
  if (a === 'content') return <Contents />;
  if (a === 'channels' && b) return <PlatformDetail id={Number(b)} />;
  if (a === 'channels') return <Channels />;
  if (a === 'operations') return <Operations />;
  if (a === 'settings') return <Settings />;
  if (a === 'help') return <Help />;
  if (a === 'feedback') return <Feedback />;
  if (a === 'interactions') return <Interactions />;
  if (a === 'automation') return <Automation />;
  return <Dashboard />;
}

export default function App() {
  const { path, parts } = useRoute();
  const [menuOpen, setMenuOpen] = useState(false);
  const [counts, setCounts] = useState<{ pending: number; failed: number; feedback: number; interactions: number }>({ pending: 0, failed: 0, feedback: 0, interactions: 0 });
  const [store, setStore] = useState(tr("فروشگاه من"));
  const [logo, setLogo] = useState('');
  const [q, setQ] = useState('');
  const theme = useTheme();

  useEffect(() => {
    setMenuOpen(false);
    const load = () =>
      Promise.all([
        api.get<{ counts: Record<string, number> }>('/dashboard'),
        api.get<{ unread: number; sessions_unseen: number }>('/feedback/stats').catch(() => ({ unread: 0, sessions_unseen: 0 })),
      ])
        .then(([d, f]) => setCounts({ pending: d.counts.pending_contents, failed: d.counts.failed_publications, feedback: f.unread, interactions: f.sessions_unseen }))
        .catch(() => undefined);
    load();
    window.addEventListener('sss:counts', load);
    return () => window.removeEventListener('sss:counts', load);
  }, [path]);
  useEffect(() => {
    const load = () =>
      api.get<Record<string, string>>('/settings').then((s) => {
        if (s.store_name) setStore(s.store_name);
        setLogo(s.logo_url || '');
        if (s.brand_color) applyBrand(s.brand_color);
      }).catch(() => undefined);
    load();
    window.addEventListener('sss:settings', load);
    return () => window.removeEventListener('sss:settings', load);
  }, []);

  const search = (e: FormEvent) => {
    e.preventDefault();
    navigate(`/products?q=${encodeURIComponent(q.trim())}`);
  };

  const active = (p: string) => (p === '/' ? path === '/' : path === p || path.startsWith(p + '/'));
  const title = NAV.flatMap((g) => g.items).find((it) => active(it.path))?.label || '';

  return (
    <UiProvider>
      <div className="layout">
        <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
          <div className="brand">
            <div className="brand-mark brand-mark-svg"><AppMark size={40} /></div>
            <div className="brand-text">
              <strong>{tr("فروشگاه‌یار")}</strong>
              <small>Smart Store Sync</small>
            </div>
          </div>
          <nav>
            {NAV.map((g) => (
              <div key={g.group} className="nav-group">
                <div className="nav-group-title">{g.group}</div>
                {g.items.map((it) => {
                  const n = it.badge ? counts[it.badge as 'pending' | 'failed' | 'feedback' | 'interactions'] : 0;
                  return (
                    <a key={it.path} href={href(it.path)} className={`nav-item ${active(it.path) ? 'active' : ''}`}>
                      <Icon name={it.icon} size={19} />
                      <span>{it.label}</span>
                      {n > 0 && <span className={`nav-badge ${it.badge === 'failed' || it.badge === 'feedback' || it.badge === 'interactions' ? 'danger' : ''}`}>{n.toLocaleString(LOCALE)}</span>}
                    </a>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="sidebar-foot">
            <div className="store-card">
              <div className="store-avatar">{logo ? <img src={logo} alt="" /> : <Icon name="store" size={18} />}</div>
              <div>
                <strong>{store}</strong>
                <small>{tr("پنل مدیریت فروشگاه")}</small>
              </div>
            </div>
          </div>
        </aside>
        {menuOpen && <div className="sidebar-backdrop" onClick={() => setMenuOpen(false)} />}
        <div className="main">
          <header className="topbar">
            <button className="icon-btn menu-btn" onClick={() => setMenuOpen(true)} aria-label={tr("منو")}><Icon name="menu" /></button>
            <div className="topbar-title">{title}</div>
            <form className="topbar-search" onSubmit={search} role="search">
              <Icon name="search" size={17} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("جستجوی محصول، کد کالا…")} aria-label={tr("جستجوی محصول")} />
              <kbd>Enter</kbd>
            </form>
            <div className="topbar-actions">
              <button className="icon-btn lang-btn" onClick={() => setLang(LANG === 'fa' ? 'en' : 'fa')} title={LANG === 'fa' ? 'English' : 'فارسی'} aria-label={tr("تغییر زبان")}>
                {LANG === 'fa' ? 'EN' : 'فا'}
              </button>
              <button className="icon-btn" onClick={theme.toggle} title={theme.resolved === 'dark' ? tr("حالت روشن") : tr("حالت تاریک")} aria-label={tr("تغییر تم")}>
                <Icon name={theme.resolved === 'dark' ? 'sun' : 'moon'} />
              </button>
              <a className="icon-btn notif" href={href('/content')} title={tr("در انتظار تأیید")} aria-label={tr("اعلان‌ها")}>
                <Icon name="bell" />
                {counts.pending + counts.failed > 0 && <span className="notif-dot">{(counts.pending + counts.failed).toLocaleString(LOCALE)}</span>}
              </a>
              <a className="avatar" href={href('/settings')} title={store}>{logo ? <img src={logo} alt="" /> : [...store.trim()][0] || tr("ف")}</a>
            </div>
          </header>
          <main className="content" key={path}>
            <Page parts={parts} />
          </main>
        </div>
      </div>
    </UiProvider>
  );
}
