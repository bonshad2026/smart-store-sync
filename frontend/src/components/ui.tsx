import { LOCALE, tr } from '../i18n';
import { ButtonHTMLAttributes, createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { isVideoUrl, Tone } from '../api';
import { BrandLogo, hasBrandLogo } from './BrandLogo';
import Icon from './Icon';
import { goBack, href } from '../router';

// ------------------------------------------------------------------ buttons

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'soft';
export function Button({
  children, variant = 'primary', icon, loading, size = 'md', className = '', ...rest
}: {
  children?: ReactNode; variant?: BtnVariant; icon?: string; loading?: boolean; size?: 'sm' | 'md' | 'lg';
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading ? <span className="spinner" /> : icon ? <Icon name={icon} size={size === 'sm' ? 15 : 17} /> : null}
      {children && <span>{children}</span>}
    </button>
  );
}

export function IconButton({ icon, label, tone, ...rest }: { icon: string; label: string; tone?: 'danger' } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`icon-btn ${tone === 'danger' ? 'icon-btn-danger' : ''}`} title={label} aria-label={label} {...rest}>
      <Icon name={icon} size={17} />
    </button>
  );
}

// ------------------------------------------------------------------ layout

export function Card({ title, subtitle, actions, children, className = '', padded = true }: {
  title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; padded?: boolean;
}) {
  return (
    <section className={`card ${padded ? '' : 'card-flush'} ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h3 className="card-title">{title}</h3>}
            {subtitle && <p className="card-subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="row gap-8 wrap">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: string; icon?: string }) {
  return (
    <div className="page-head">
      <div className="row gap-12 align-center">
        {back && (
          <a className="back-link" href={href(back)} aria-label={tr("بازگشت")} title={tr("بازگشت")}
            onClick={(e) => { e.preventDefault(); goBack(back); }}>
            <Icon name="arrowRight" size={18} />
          </a>
        )}
        {icon && <span className="page-icon"><Icon name={icon} size={22} /></span>}
        <div>
          <h1>{title}</h1>
          {subtitle && <p className="page-sub">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="row gap-8 wrap">{actions}</div>}
    </div>
  );
}

export function Badge({ tone = 'neutral', children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <i className="badge-dot" />}
      {children}
    </span>
  );
}

export function EmptyState({ icon = 'inbox', title, text, action }: { icon?: string; title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon"><Icon name={icon} size={28} /></div>
      <h4>{title}</h4>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%', r = 8 }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} />;
}

export function LoadingGrid({ n = 8 }: { n?: number }) {
  return (
    <div className="product-grid">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="card card-flush">
          <Skeleton h={180} r={0} />
          <div style={{ padding: 14, display: 'grid', gap: 8 }}>
            <Skeleton w="70%" />
            <Skeleton w="40%" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="alert alert-danger">
      <Icon name="alert" />
      <span>{error}</span>
      {onRetry && <Button variant="ghost" size="sm" icon="refresh" onClick={onRetry}>{tr("تلاش مجدد")}</Button>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: {
  value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number }[];
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => (
        <button key={it.value} role="tab" aria-selected={it.value === value} className={it.value === value ? 'active' : ''} onClick={() => onChange(it.value)}>
          {it.label}
          {it.count !== undefined && it.count > 0 && <span className="tab-count">{it.count.toLocaleString(LOCALE)}</span>}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={`switch ${disabled ? 'disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track"><span className="switch-thumb" /></span>
      {label && <span>{label}</span>}
    </label>
  );
}

export function Field({ label, hint, children, full, error }: { label: ReactNode; hint?: ReactNode; children: ReactNode; full?: boolean; error?: string }) {
  return (
    <label className={`field ${full ? 'full' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

// ------------------------------------------------------------------ platform & product visuals

export function PlatformIcon({ icon, color, size = 36 }: { icon: string; color: string; size?: number }) {
  if (hasBrandLogo(icon)) return <span className="platform-logo" style={{ width: size, height: size }}><BrandLogo icon={icon} size={size} /></span>;
  return (
    <span className="platform-icon" style={{ width: size, height: size, background: `${color}1a`, color }}>
      <Icon name={icon} size={Math.round(size * 0.52)} />
    </span>
  );
}

export function PlatformChip({ name, icon, color }: { name: string; icon: string; color: string }) {
  return (
    <span className="platform-chip" style={{ color, background: `${color}14`, borderColor: `${color}33` }}>
      <Icon name={icon} size={14} />
      {name}
    </span>
  );
}

const GRADIENTS = [
  ['#6366f1', '#a855f7'], ['#0ea5e9', '#6366f1'], ['#f59e0b', '#ef4444'], ['#10b981', '#0ea5e9'],
  ['#ec4899', '#f59e0b'], ['#14b8a6', '#22c55e'], ['#8b5cf6', '#ec4899'],
];

/** Product image with a graceful gradient placeholder (initial letter) when there is no photo */
export function ProductImage({ src, name, className = '', rounded = 12, controls }: { src?: string; name: string; className?: string; rounded?: number; controls?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (src && !failed && isVideoUrl(src)) {
    return (
      <video className={`product-img ${className}`} src={controls ? src : `${src}#t=0.1`} muted={!controls} controls={controls}
        playsInline preload="metadata" onError={() => setFailed(true)} style={{ borderRadius: rounded, objectFit: controls ? 'contain' : 'cover', background: '#000' }} />
    );
  }
  if (src && !failed) {
    return <img className={`product-img ${className}`} src={src} alt={name} loading="lazy" onError={() => setFailed(true)} style={{ borderRadius: rounded }} />;
  }
  const g = GRADIENTS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % GRADIENTS.length];
  return (
    <div className={`product-img product-placeholder ${className}`} style={{ background: `linear-gradient(135deg, ${g[0]}, ${g[1]})`, borderRadius: rounded }}>
      <span>{[...name.trim()][0] || '?'}</span>
    </div>
  );
}

// ------------------------------------------------------------------ modal

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md' }: {
  open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal modal-${size}`} role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton icon="x" label={tr("بستن")} onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ toasts & confirm

interface ToastItem { id: number; tone: 'success' | 'danger' | 'info'; text: string }
interface ConfirmState { text: string; title: string; danger?: boolean; resolve: (v: boolean) => void }

const UiCtx = createContext<{
  toast: (text: string, tone?: ToastItem['tone']) => void;
  confirm: (title: string, text: string, danger?: boolean) => Promise<boolean>;
}>({ toast: () => undefined, confirm: async () => false });

export const useUi = () => useContext(UiCtx);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirm] = useState<ConfirmState | null>(null);
  const seq = useRef(0);
  const toast = useCallback((text: string, tone: ToastItem['tone'] = 'success') => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'danger' ? 7000 : 3800);
  }, []);
  const confirm = useCallback(
    (title: string, text: string, danger?: boolean) => new Promise<boolean>((resolve) => setConfirm({ title, text, danger, resolve })),
    [],
  );
  const close = (v: boolean) => {
    confirmState?.resolve(v);
    setConfirm(null);
  };
  return (
    <UiCtx.Provider value={{ toast, confirm }}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <Icon name={t.tone === 'danger' ? 'alert' : t.tone === 'info' ? 'bell' : 'check'} />
            <span>{t.text}</span>
          </div>
        ))}
      </div>
      <Modal
        open={!!confirmState}
        onClose={() => close(false)}
        title={confirmState?.title}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => close(false)}>{tr("انصراف")}</Button>
            <Button variant={confirmState?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>{tr("تأیید")}</Button>
          </>
        }
      >
        <p className="muted">{confirmState?.text}</p>
      </Modal>
    </UiCtx.Provider>
  );
}

// ------------------------------------------------------------------ data hook

/** Loads data and exposes { data, error, loading, reload, setData } */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fn()
      .then((d) => {
        if (alive) {
          setData(d);
          setError('');
        }
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1), setData };
}

/** Remembers a value per browser (view mode, filters...) */
export function usePersistent<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = (nv: T) => {
    setV(nv);
    try {
      localStorage.setItem(key, JSON.stringify(nv));
    } catch {
      /* ignore */
    }
  };
  return [v, set];
}

export function copyText(text: string) {
  return navigator.clipboard?.writeText(text).catch(() => undefined);
}

// ------------------------------------------------------------------ truncated text + tooltip

/**
 * Shows the first `max` characters of a long text; the full text appears in a tooltip
 * on hover / keyboard focus. The tooltip is rendered in a portal so tables don't clip it.
 */
export function Truncate({ text, max = 80, className = '' }: { text?: string | null; max?: number; className?: string }) {
  const [tip, setTip] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  if (!text) return null;
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return <span className={className}>{clean}</span>;
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const below = r.top < 160;
    setTip({ x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below });
  };
  return (
    <>
      <span ref={ref} className={`truncate ${className}`} tabIndex={0} onMouseEnter={show} onMouseLeave={() => setTip(null)}
        onFocus={show} onBlur={() => setTip(null)} aria-label={clean}>
        {clean.slice(0, max).trimEnd()}…
      </span>
      {tip && createPortal(
        <div className={`tooltip ${tip.below ? 'below' : ''}`} role="tooltip" style={{ left: tip.x, top: tip.y }}>{clean}</div>,
        document.body,
      )}
    </>
  );
}

// ------------------------------------------------------------------ step tabs (numbered sub-steps of a page)

export function StepTabs<T extends string>({ value, onChange, items }: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; title: ReactNode; desc?: ReactNode; done?: boolean; count?: number; optional?: boolean }[];
}) {
  return (
    <ol className="step-tabs" role="tablist">
      {items.map((it, i) => (
        <li key={it.value} className={`${it.value === value ? 'active' : ''} ${it.done ? 'done' : ''}`}>
          <button role="tab" aria-selected={it.value === value} onClick={() => onChange(it.value)}>
            <span className="st-num">{it.done && it.value !== value ? <Icon name="check" size={13} strokeWidth={2.6} /> : (i + 1).toLocaleString(LOCALE)}</span>
            <span className="st-text">
              <strong>
                {it.title}
                {it.count !== undefined && it.count > 0 && <span className="tab-count">{it.count.toLocaleString(LOCALE)}</span>}
                {it.optional && <em>{tr("اختیاری")}</em>}
              </strong>
              {it.desc && <small>{it.desc}</small>}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
