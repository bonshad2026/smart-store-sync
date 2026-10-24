import { tr } from '../i18n';
import { useEffect, useState } from 'react';
import { api, fa } from '../api';
import Icon from '../components/Icon';
import { JourneyData, journeySteps } from '../components/Journey';
import { Card, PageHeader } from '../components/ui';
import { href } from '../router';

interface Guide {
  how: string[];
  tip: string;
  cta: string;
}

const GUIDES: Record<string, Guide> = {
  products: {
    how: [
      tr("از منوی «محصولات» روی «محصول جدید» بزنید یا فایل اکسل (CSV) کاتالوگ را وارد کنید."),
      tr("نام، قیمت، قیمت تخفیفی، موجودی و عکس یا فیلم محصول را وارد کنید."),
      tr("از این به بعد هر تغییر قیمت و موجودی به‌صورت خودکار ثبت می‌شود."),
    ],
    tip: tr("فایل نمونه ۲۰ محصول در پوشه sample-data هست؛ برای شروع سریع همان را وارد کنید."),
    cta: tr("رفتن به محصولات"),
  },
  channels: {
    how: [
      tr("در «کانال‌های انتشار» شبکه موردنظر (تلگرام، اینستاگرام، سایت، پیامک، ایمیل) را فعال کنید."),
      tr("وارد شبکه شوید و در تب «تعریف مقصدها» کانال، پیج یا لیست گیرنده را اضافه کنید."),
      tr("برای تلگرام با «ارسال آزمایشی» از درستی اتصال مطمئن شوید."),
    ],
    tip: tr("برای هر شبکه می‌توانید چند مقصد داشته باشید؛ مثلاً دو کانال تلگرام."),
    cta: tr("رفتن به کانال‌ها"),
  },
  templates: {
    how: [
      tr("در صفحه هر شبکه تب «قالب‌های محتوا» را باز کنید."),
      tr("برای هر نوع پیام (معرفی، تخفیف، موجود شد، تغییر قیمت) متن با متغیرها بنویسید."),
      tr("عکس، فیلم و دکمه لینک ثابت را هم به قالب اضافه کنید."),
    ],
    tip: tr("این مرحله اختیاری است؛ قالب‌های پیش‌فرض از ابتدا آماده‌اند."),
    cta: tr("ویرایش قالب‌ها"),
  },
  create: {
    how: [
      tr("وارد صفحه یک محصول شوید و «ساخت محتوا» را بزنید."),
      tr("در سه مرحله نوع پیام، شبکه‌ها و نوع محتوا را انتخاب و در پایان مرور کنید."),
      tr("یا با «محتوای دستی» متن، عکس، فیلم، صدا و لینک دلخواه بسازید."),
    ],
    tip: tr("با تغییر قیمت یا موجودی، محتوا خودکار ساخته و در صف تأیید قرار می‌گیرد."),
    cta: tr("انتخاب محصول"),
  },
  publish: {
    how: [
      tr("در «محتوا و انتشار» متن‌ها را بخوانید و در صورت نیاز ویرایش کنید."),
      tr("«تأیید و انتشار» را بزنید؛ امکان زمان‌بندی انتشار هم هست."),
      tr("برای شبکه‌های دستی (مثل اینستاگرام) متن را کپی و پس از انتشار «منتشر کردم» را بزنید."),
    ],
    tip: tr("ارسال‌های ناموفق در «تاریخچه عملیات» با یک کلیک دوباره امتحان می‌شوند."),
    cta: tr("رفتن به صف انتشار"),
  },
};

const FAQ: [string, string][] = [
  [tr("بدون کلید هوش مصنوعی هم کار می‌کند؟"), tr("بله. متن‌ها از روی قالب‌های هر شبکه ساخته می‌شوند و قبل از انتشار قابل ویرایش‌اند.")],
  [tr("چیزی بدون اجازه من منتشر می‌شود؟"), tr("خیر. هر محتوا ابتدا در صف تأیید قرار می‌گیرد و فقط پس از «تأیید و انتشار» ارسال می‌شود.")],
  [tr("چطور یک شبکه جدید مثل واتساپ اضافه کنم؟"), tr("در «کانال‌های انتشار» روی «شبکه جدید» بزنید و روش ارسال را وب‌هوک یا دستی انتخاب کنید.")],
  [tr("رنگ و لوگوی پنل را کجا تغییر دهم؟"), tr("در «تنظیمات»؛ رنگ برند، لوگو، اسلایدهای داشبورد و زبان پنل همان‌جا هستند.")],
];

export default function Help() {
  const [data, setData] = useState<JourneyData | null>(null);
  const [open, setOpen] = useState<string>('products');
  useEffect(() => {
    api.get<JourneyData>('/journey').then(setData).catch(() => undefined);
  }, []);
  const steps = data ? journeySteps(data) : [];
  const doneCount = steps.filter((s) => s.done).length;
  const pct = steps.length ? Math.round((doneCount / steps.length) * 100) : 0;
  const next = steps.find((s) => !s.done && !s.optional) || steps.find((s) => !s.done);
  const goto = (k: string) => {
    setOpen(k);
    document.getElementById(`guide-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <>
      <PageHeader icon="help" title={tr("راهنمای کار با سایت")} subtitle={tr("مسیر کار با فروشگاه‌یار را قدم‌به‌قدم ببینید؛ هر مرحله را باز کنید تا توضیح کامل و لینک مستقیم آن را ببینید.")} />

      <section className="help-hero">
        <div className="help-hero-copy">
          <span className="help-kicker"><Icon name="rocket" size={15} /> {tr("مسیر کار")}</span>
          <h2>{tr("از محصول تا انتشار در ۵ مرحله")}</h2>
          <p>{tr("محصول را ثبت کنید، کانال‌ها را وصل کنید، محتوا بسازید و با یک تأیید در همه شبکه‌ها منتشر کنید.")}</p>
          {next && (
            <a className="btn btn-light btn-md" href={href(next.href)}>
              <span>{tr("گام بعدی شما:")} {next.title}</span>
              <Icon name="chevronLeft" size={16} />
            </a>
          )}
        </div>
        <div className="help-ring" style={{ ['--p' as string]: `${pct}%` }} aria-label={`${fa(pct)}٪`}>
          <div>
            <strong>{fa(doneCount)}/{fa(steps.length || 5)}</strong>
            <small>{tr("مرحله انجام شده")}</small>
          </div>
        </div>
      </section>

      {/* visual flow */}
      <ol className="flow">
        {steps.map((s, i) => (
          <li key={s.key} className={`flow-node ${s.done ? 'done' : ''} ${open === s.key ? 'active' : ''}`}>
            <button type="button" onClick={() => goto(s.key)}>
              <span className="flow-icon">
                <Icon name={s.icon} size={24} />
                <span className="flow-num">{s.done ? <Icon name="check" size={12} strokeWidth={3} /> : fa(i + 1)}</span>
              </span>
              <strong>{s.title}</strong>
              <small>{s.optional ? tr("(اختیاری)") : s.done ? tr("انجام شده") : tr("انجام نشده")}</small>
            </button>
            {i < steps.length - 1 && <span className="flow-arrow"><Icon name="chevronLeft" size={18} /></span>}
          </li>
        ))}
      </ol>

      {/* step details */}
      <div className="guide-list">
        {steps.map((s, i) => {
          const g = GUIDES[s.key];
          const isOpen = open === s.key;
          return (
            <section key={s.key} id={`guide-${s.key}`} className={`guide ${isOpen ? 'open' : ''} ${s.done ? 'done' : ''}`}>
              <button type="button" className="guide-head" onClick={() => setOpen(isOpen ? '' : s.key)} aria-expanded={isOpen}>
                <span className="guide-num">{s.done ? <Icon name="check" size={16} strokeWidth={3} /> : fa(i + 1)}</span>
                <span className="grow">
                  <strong>{s.title}{s.optional && <em> {tr("(اختیاری)")}</em>}</strong>
                  <small>{s.desc}</small>
                </span>
                <Icon name="chevronDown" size={18} className="guide-chev" />
              </button>
              {isOpen && (
                <div className="guide-body">
                  <div className="guide-art" aria-hidden="true">
                    <span className="ga-card ga-1" />
                    <span className="ga-card ga-2" />
                    <span className="ga-main"><Icon name={s.icon} size={36} /></span>
                  </div>
                  <div className="grow">
                    <ol className="guide-steps">
                      {g.how.map((h, k) => <li key={k}><span>{fa(k + 1)}</span>{h}</li>)}
                    </ol>
                    <p className="hint-box"><Icon name="star" size={16} /> {g.tip}</p>
                    <a className="btn btn-primary btn-md" href={href(s.href)}><span>{g.cta}</span><Icon name="chevronLeft" size={16} /></a>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="dash-grid">
        <Card title={<span className="row gap-8 align-center"><Icon name="zap" /> {tr("انتشار خودکار چطور کار می‌کند؟")}</span>}>
          <div className="auto-flow">
            {[
              ['trending', tr("تغییر قیمت یا موجودی")],
              ['sparkles', tr("ساخت خودکار محتوا")],
              ['inbox', tr("صف تأیید شما")],
              ['send', tr("انتشار در کانال‌ها")],
            ].map(([ic, label], i, arr) => (
              <div key={ic} className="af-item">
                <span className="af-ico"><Icon name={ic} size={20} /></span>
                <small>{label}</small>
                {i < arr.length - 1 && <Icon name="chevronLeft" size={16} className="af-arrow" />}
              </div>
            ))}
          </div>
        </Card>
        <Card title={<span className="row gap-8 align-center"><Icon name="help" /> {tr("پرسش‌های متداول")}</span>}>
          <div className="faq">
            {FAQ.map(([q, a]) => (
              <details key={q}>
                <summary>{q}<Icon name="chevronDown" size={16} /></summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
