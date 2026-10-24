import { LOCALE, tr } from '../i18n';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { href } from '../router';
import Icon from './Icon';

export interface HeroSlide {
  image: string;
  title: string;
  subtitle?: string;
  link?: string;
  link_label?: string;
}

export function parseSlides(raw?: string): HeroSlide[] {
  try {
    const v = JSON.parse(raw || '[]');
    return Array.isArray(v) ? v.filter((s) => s && (s.image || s.title)) : [];
  } catch {
    return [];
  }
}

const isInternal = (link: string) => link.startsWith('/') || link.startsWith('#');

/**
 * Dashboard hero: full-width slider with the store logo, configurable slides
 * (image, title, subtitle, button) and an optional side panel.
 */
export default function HeroSlider({ slides, logo, storeName, side, interval = 6500 }: {
  slides: HeroSlide[];
  logo?: string;
  storeName: string;
  side?: ReactNode;
  interval?: number;
}) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = slides.length;
  const touch = useRef<number | null>(null);

  useEffect(() => setI(0), [n]);
  useEffect(() => {
    if (paused || n < 2) return;
    const t = setTimeout(() => setI((x) => (x + 1) % n), interval);
    return () => clearTimeout(t);
  }, [i, paused, n, interval]);

  const go = (d: number) => setI((x) => (x + d + n) % n);

  return (
    <section
      className="hero-slider"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => (touch.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touch.current === null) return;
        const dx = e.changedTouches[0].clientX - touch.current;
        if (Math.abs(dx) > 40) go(dx > 0 ? 1 : -1);
        touch.current = null;
      }}
      aria-roledescription="carousel"
    >
      {slides.map((s, k) => (
        <div key={k} className={`hs-slide ${k === i ? 'active' : ''}`} aria-hidden={k !== i}>
          {s.image ? <img className="hs-bg" src={s.image} alt="" /> : <div className="hs-bg hs-bg-brand" />}
        </div>
      ))}
      <div className="hs-shade" />

      <div className="hs-top">
        <div className="hs-brand">
          {logo ? <img src={logo} alt={storeName} /> : <span className="hs-brand-mark"><Icon name="store" size={18} /></span>}
          <strong>{storeName}</strong>
        </div>
        {n > 1 && (
          <div className="hs-counter">
            {(i + 1).toLocaleString(LOCALE)} / {n.toLocaleString(LOCALE)}
          </div>
        )}
      </div>

      <div className="hs-body">
        <div className="hs-copy" key={i}>
          <h1>{slides[i]?.title}</h1>
          {slides[i]?.subtitle && <p>{slides[i].subtitle}</p>}
          {slides[i]?.link && (
            <a className="btn btn-light btn-md" href={isInternal(slides[i].link!) ? href(slides[i].link!.replace(/^#/, '')) : slides[i].link}
              target={isInternal(slides[i].link!) ? undefined : '_blank'} rel="noreferrer">
              <span>{slides[i].link_label || tr("مشاهده")}</span>
              <Icon name="chevronLeft" size={16} />
            </a>
          )}
        </div>
        {side && <div className="hs-side">{side}</div>}
      </div>

      {n > 1 && (
        <div className="hs-controls">
          <button className="hs-arrow" onClick={() => go(-1)} aria-label={tr("اسلاید قبلی")}><Icon name="chevronRight" size={18} /></button>
          <div className="hs-dots" role="tablist">
            {slides.map((_, k) => (
              <button key={k} role="tab" aria-selected={k === i} aria-label={`${tr("اسلاید")} ${(k + 1).toLocaleString(LOCALE)}`}
                className={k === i ? 'active' : ''} onClick={() => setI(k)}>
                {k === i && !paused && <i style={{ animationDuration: `${interval}ms` }} />}
              </button>
            ))}
          </div>
          <button className="hs-arrow" onClick={() => go(1)} aria-label={tr("اسلاید بعدی")}><Icon name="chevronLeft" size={18} /></button>
        </div>
      )}
    </section>
  );
}
