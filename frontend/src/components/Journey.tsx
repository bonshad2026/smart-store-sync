import { LOCALE, tr } from '../i18n';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { href } from '../router';
import Icon from './Icon';

export interface JourneyData {
  products: number;
  platforms: number;
  destinations: number;
  custom_templates: number;
  contents: number;
  published: number;
  first_platform_id: number | null;
  last_product_id: number | null;
}

export type JourneyStep = 'products' | 'channels' | 'templates' | 'create' | 'publish';

interface StepDef {
  key: JourneyStep;
  title: string;
  desc: string;
  icon: string;
  href: string;
  done: boolean;
  optional?: boolean;
}

export function journeySteps(j: JourneyData): StepDef[] {
  return [
    { key: 'products', title: tr("محصولات"), desc: tr("محصولات را اضافه یا از CSV وارد کنید"), icon: 'box', href: '/products', done: j.products > 0 },
    { key: 'channels', title: tr("کانال‌ها و مقصدها"), desc: tr("شبکه را انتخاب و کانال یا لیست گیرنده تعریف کنید"), icon: 'share', href: '/channels', done: j.destinations > 0 },
    {
      key: 'templates', title: tr("قالب محتوا"), desc: tr("متن، عکس و لینک ثابت هر شبکه"), icon: 'file',
      href: j.first_platform_id ? `/channels/${j.first_platform_id}?tab=templates` : '/channels',
      done: j.destinations > 0 && (j.custom_templates > 0 || j.contents > 0), optional: true,
    },
    {
      key: 'create', title: tr("ساخت محتوا"), desc: tr("در صفحه محصول، برای شبکه‌ها محتوا بسازید"), icon: 'sparkles',
      href: j.last_product_id ? `/products/${j.last_product_id}` : '/products', done: j.contents > 0,
    },
    { key: 'publish', title: tr("تأیید و انتشار"), desc: tr("محتوا را بررسی و در مقصدها منتشر کنید"), icon: 'send', href: '/content', done: j.published > 0 },
  ];
}

let cache: JourneyData | null = null;

/** Workflow progress bar shown at the top of every related page */
export default function Journey({ current, variant = 'bar' }: { current?: JourneyStep; variant?: 'bar' | 'hero' }) {
  const [data, setData] = useState<JourneyData | null>(cache);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sss_journey_collapsed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    api.get<JourneyData>('/journey').then((d) => { cache = d; setData(d); }).catch(() => undefined);
  }, [current]);
  if (!data) return <div className="journey journey-skeleton" />;

  const steps = journeySteps(data);
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done && !s.optional) || steps.find((s) => !s.done);
  const toggle = () => {
    setCollapsed(!collapsed);
    try { localStorage.setItem('sss_journey_collapsed', collapsed ? '0' : '1'); } catch { /* ignore */ }
  };

  return (
    <section className={`journey journey-${variant} ${collapsed && variant === 'bar' ? 'collapsed' : ''}`} aria-label={tr("مراحل انجام کار")}>
      <header className="journey-head">
        <div className="journey-title">
          <strong>{variant === 'hero' ? tr("مراحل راه‌اندازی و انتشار") : tr("مسیر کار")}</strong>
          <span className="journey-progress"><i style={{ width: `${(doneCount / steps.length) * 100}%` }} /></span>
          <small>{doneCount.toLocaleString(LOCALE)} {tr("از")} {steps.length.toLocaleString(LOCALE)} {tr("مرحله")}</small>
        </div>
        <div className="row gap-8 align-center">
          {next && (
            <a className="journey-next" href={href(next.href)}>
              {tr("گام بعد:")} <b>{next.title}</b> <Icon name="chevronLeft" size={14} />
            </a>
          )}
          {!next && <span className="journey-all-done"><Icon name="check" size={14} /> {tr("همه مراحل انجام شده")}</span>}
          {variant === 'bar' && (
            <button className="icon-btn" onClick={toggle} aria-label={collapsed ? tr("نمایش مراحل") : tr("جمع کردن مراحل")} title={collapsed ? tr("نمایش مراحل") : tr("جمع کردن")}>
              <Icon name="chevronDown" size={16} className={collapsed ? '' : 'flip'} />
            </button>
          )}
        </div>
      </header>
      {!(collapsed && variant === 'bar') && (
        <ol className="journey-steps">
          {steps.map((s, i) => {
            const state = s.key === current ? 'current' : s.done ? 'done' : 'todo';
            return (
              <li key={s.key} className={`journey-step ${state}`}>
                <a href={href(s.href)} aria-current={state === 'current' ? 'step' : undefined}>
                  <span className="js-num">{s.done && state !== 'current' ? <Icon name="check" size={14} strokeWidth={2.6} /> : (i + 1).toLocaleString(LOCALE)}</span>
                  <span className="js-text">
                    <strong>{s.title}{s.optional && <em> {tr("(اختیاری)")}</em>}</strong>
                    <small>{s.desc}</small>
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
