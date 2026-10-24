import { LANG, setLang, tr } from '../i18n';
import { FormEvent, useEffect, useState } from 'react';
import { api, getApiKey, MediaItem, setApiKey } from '../api';
import { HeroSlide, parseSlides } from '../components/HeroSlider';
import Icon from '../components/Icon';
import { Button, Card, Field, IconButton, PageHeader, Switch, useUi } from '../components/ui';
import { href } from '../router';
import { applyBrand, BRAND_PRESETS, DEFAULT_BRAND, isValidColor, ThemeMode, useTheme } from '../theme';

let brandTimer: ReturnType<typeof setTimeout> | undefined;

export default function Settings() {
  const { toast } = useUi();
  const [values, setValues] = useState<Record<string, string>>({});
  const [key, setKey] = useState(getApiKey());
  const [health, setHealth] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const theme = useTheme();
  const brand = values.brand_color && isValidColor(values.brand_color) ? values.brand_color : DEFAULT_BRAND;

  const saveBrand = async (color: string) => {
    applyBrand(color);
    setValues((s) => ({ ...s, brand_color: color }));
    try {
      await api.put('/settings', { brand_color: color });
      window.dispatchEvent(new Event('sss:settings'));
      toast(tr("رنگ برند ذخیره شد"));
    } catch (err) {
      toast((err as Error).message, 'danger');
    }
  };

  useEffect(() => {
    api.get<Record<string, string>>('/settings').then(setValues).catch((e) => toast(e.message, 'danger'));
    api.get<Record<string, string>>('/health').then(setHealth).catch(() => undefined);
  }, [toast]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      setValues(await api.put<Record<string, string>>('/settings', values));
      toast(tr("تنظیمات ذخیره شد"));
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };
  const v = (k: string) => ({ value: values[k] ?? '', onChange: (e: { target: { value: string } }) => setValues((s) => ({ ...s, [k]: e.target.value })) });

  return (
    <>
      <PageHeader icon="settings" title={tr("تنظیمات")} subtitle={tr("هویت فروشگاه، لحن برند و رفتار خودکار سیستم")} />
      <Card className="appearance-card" title={<span className="row gap-8 align-center"><Icon name="palette" /> {tr("ظاهر پنل")}</span>} subtitle={tr("رنگ برند برای همه کاربران این فروشگاه اعمال می‌شود؛ حالت روشن/تاریک برای هر کاربر جداگانه ذخیره می‌شود.")}>
        <div className="appearance-grid single">
          <div className="stack-16">
            <div>
              <span className="field-label">{tr("زبان پنل")}</span>
              <div className="segmented" role="radiogroup" aria-label={tr("زبان پنل")}>
                {([['fa', 'فارسی'], ['en', 'English']] as const).map(([l, label]) => (
                  <button key={l} type="button" role="radio" aria-checked={LANG === l} className={LANG === l ? 'active' : ''} onClick={() => LANG !== l && setLang(l)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="field-label">{tr("حالت نمایش")}</span>
              <div className="theme-options">
                {([['light', tr("روشن"), 'sun'], ['dark', tr("تیره"), 'moon'], ['system', tr("خودکار"), 'monitor']] as [ThemeMode, string, string][]).map(([m, label, icon]) => (
                  <button key={m} type="button" className={`theme-option ${theme.mode === m ? 'active' : ''}`} onClick={() => theme.setMode(m)}>
                    <span className={`theme-thumb theme-thumb-${m}`}><i /><i /><i /></span>
                    <span className="row gap-8 align-center"><Icon name={icon} size={16} />{label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className="field-label">{tr("رنگ برند")}</span>
              <div className="brand-swatches">
                {BRAND_PRESETS.map((b) => (
                  <button key={b.color} type="button" title={b.name} aria-label={b.name}
                    className={`brand-swatch ${brand.toLowerCase() === b.color ? 'active' : ''}`}
                    style={{ background: b.color }} onClick={() => saveBrand(b.color)}>
                    {brand.toLowerCase() === b.color && <Icon name="check" size={16} strokeWidth={3} />}
                  </button>
                ))}
                <label className={`brand-swatch custom ${BRAND_PRESETS.some((b) => b.color === brand.toLowerCase()) ? '' : 'active'}`} title={tr("رنگ دلخواه")}>
                  <input type="color" value={brand} onChange={(e) => { const c = e.target.value; applyBrand(c); setValues((s) => ({ ...s, brand_color: c })); clearTimeout(brandTimer); brandTimer = setTimeout(() => saveBrand(c), 700); }} />
                  <Icon name="plus" size={16} />
                </label>
              </div>
              <span className="field-hint">{tr("رنگ لوگوی فروشگاه خود را انتخاب کنید تا پنل «مال خودتان» به نظر برسد.")}</span>
            </div>
          </div>
        </div>
      </Card>

      <BrandingSettings />

      <div className="settings-grid">
        <Card title={tr("فروشگاه و برند")} subtitle={tr("در همه متن‌های تولیدشده استفاده می‌شود")}>
          <form onSubmit={save} className="form-grid">
            <Field label={tr("نام فروشگاه")}><input {...v('store_name')} /></Field>
            <Field label={tr("لحن و سبک نوشتاری")}><input {...v('brand_tone')} placeholder={tr("مثلاً: صمیمی، جوان‌پسند، کوتاه")} /></Field>
            <Field label={tr("رفتار خودکار")} full hint={tr("با تغییر قیمت، تخفیف یا موجودی، برای همه شبکه‌های دارای مقصد فعال، محتوا ساخته و در صف تأیید قرار می‌گیرد.")}>
              <div className="field-switch">
                <Switch checked={values.auto_generate_on_change === 'true'} onChange={(on) => setValues((s) => ({ ...s, auto_generate_on_change: on ? 'true' : 'false' }))} label={tr("ساخت خودکار محتوا پس از تغییر محصول")} />
              </div>
            </Field>
            <div className="form-actions full"><span className="grow" /><Button type="submit" icon="check" loading={busy}>{tr("ذخیره")}</Button></div>
          </form>
        </Card>

        <Card title={tr("وضعیت اتصال‌ها")}>
          <ul className="status-list">
            <li><span className={`status-dot ${health.telegram === 'configured' ? 'ok' : 'warn'}`} /><div className="grow"><strong>{tr("ربات تلگرام")}</strong><small>{tr("توکن در فایل ‎.env (TELEGRAM_BOT_TOKEN)")}</small></div></li>
            <li><span className={`status-dot ${health.ai === 'configured' ? 'ok' : 'warn'}`} /><div className="grow"><strong>{tr("هوش مصنوعی")}</strong><small>{health.ai === 'configured' ? tr("فعال") : tr("غیرفعال — متن‌ها از روی قالب ساخته می‌شوند (AI_API_KEY)")}</small></div></li>
            <li><span className={`status-dot ${health.n8n === 'configured' ? 'ok' : 'off'}`} /><div className="grow"><strong>n8n</strong><small>{health.n8n === 'configured' ? tr("متصل") : tr("غیرفعال (اختیاری)")}</small></div></li>
          </ul>
          <a className="btn btn-soft btn-md full-w" href={href('/channels')}><Icon name="share" size={17} /><span>{tr("مدیریت کانال‌های انتشار")}</span></a>
        </Card>

        <Card title={tr("کلید دسترسی داشبورد")} subtitle={tr("اگر API_KEY را در ‎.env تنظیم کرده‌اید، همان را اینجا وارد کنید (فقط در همین مرورگر ذخیره می‌شود).")}>
          <div className="row gap-8">
            <input className="grow" dir="ltr" type="password" value={key} onChange={(e) => setKey(e.target.value)} />
            <Button variant="secondary" onClick={() => { setApiKey(key); toast(tr("کلید ذخیره شد؛ صفحه را دوباره بارگذاری کنید"), 'info'); }}>{tr("ذخیره کلید")}</Button>
          </div>
        </Card>

        <Card title={tr("امنیت")}>
          <p className="muted"><Icon name="key" size={15} /> {tr("توکن ربات، کلید هوش مصنوعی و رمز پایگاه داده فقط در فایل ‎.env سمت سرور نگهداری می‌شوند. رمزهای SMTP و کلیدهای وب‌هوک مقصدها در پایگاه داده ذخیره و در پنل به‌صورت مخفی نمایش داده می‌شوند.")}</p>
        </Card>
      </div>
    </>
  );
}

/** Uploads one image through /media and returns its URL */
async function uploadImage(file: File) {
  const fd = new FormData();
  fd.append('files', file);
  const [m] = await api.upload<MediaItem[]>('/media', fd);
  if (!m || m.type !== 'image') throw new Error(tr("فقط فایل تصویری قابل قبول است"));
  return m.url;
}

const EMPTY_SLIDE: HeroSlide = { image: '', title: '', subtitle: '', link: '', link_label: '' };

/** Store logo + dashboard hero slides */
function BrandingSettings() {
  const { toast } = useUi();
  const [logo, setLogo] = useState('');
  const [slides, setSlides] = useState<HeroSlide[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

  useEffect(() => {
    api.get<Record<string, string>>('/settings').then((s) => {
      setLogo(s.logo_url || '');
      setSlides(parseSlides(s.hero_slides));
    }).catch(() => undefined);
  }, []);

  const pick = (key: string, onUrl: (url: string) => void) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      setUploading(key);
      try {
        onUrl(await uploadImage(f));
      } catch (e) {
        toast((e as Error).message, 'danger');
      } finally {
        setUploading(null);
      }
    };
    input.click();
  };

  const setSlide = (i: number, patch: Partial<HeroSlide>) => setSlides((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, d: number) => setSlides((s) => {
    const a = [...s];
    const j = i + d;
    if (j < 0 || j >= a.length) return a;
    [a[i], a[j]] = [a[j], a[i]];
    return a;
  });

  const save = async () => {
    const bad = slides.find((sl) => !sl.title.trim() && !sl.image);
    if (bad) return toast(tr("هر اسلاید باید عنوان یا عکس داشته باشد"), 'danger');
    setBusy(true);
    try {
      await api.put('/settings', { logo_url: logo, hero_slides: JSON.stringify(slides) });
      window.dispatchEvent(new Event('sss:settings'));
      toast(tr("لوگو و اسلایدها ذخیره شد"));
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      className="branding-card"
      title={<span className="row gap-8 align-center"><Icon name="image" /> {tr("لوگو و اسلایدر داشبورد")}</span>}
      subtitle={tr("لوگوی فروشگاه در منو و بنر نمایش داده می‌شود. اگر اسلایدی تعریف نکنید، خوش‌آمدگویی و عکس محصولات به‌صورت خودکار نمایش داده می‌شود.")}
      actions={<Button icon="check" loading={busy} onClick={save}>{tr("ذخیره لوگو و اسلایدها")}</Button>}
    >
      <div className="logo-row">
        <div className="logo-preview">{logo ? <img src={logo} alt={tr("لوگو")} /> : <Icon name="store" size={26} />}</div>
        <div className="grow">
          <strong>{tr("لوگوی فروشگاه")}</strong>
          <small className="muted">{tr("PNG شفاف یا مربعی، حداقل ۲۵۶×۲۵۶ پیکسل")}</small>
        </div>
        <Button variant="secondary" size="sm" icon="upload" loading={uploading === 'logo'} onClick={() => pick('logo', setLogo)}>{logo ? tr("تغییر لوگو") : tr("آپلود لوگو")}</Button>
        {logo && <IconButton icon="trash" label={tr("حذف لوگو")} tone="danger" onClick={() => setLogo('')} />}
      </div>

      <div className="slides-head">
        <strong>{tr("اسلایدها")}</strong>
        <small className="muted">{tr("ترتیب نمایش از بالا به پایین؛ هر ۶ ثانیه اسلاید بعدی نمایش داده می‌شود.")}</small>
      </div>
      <div className="slide-list">
        {slides.map((sl, i) => (
          <div key={i} className="slide-row">
            <button type="button" className="slide-image" onClick={() => pick(`s${i}`, (url) => setSlide(i, { image: url }))} title={tr("انتخاب عکس")}>
              {sl.image ? <img src={sl.image} alt="" /> : <span className="slide-noimg"><Icon name="image" size={22} /><small>{tr("رنگ برند")}</small></span>}
              <span className="slide-upload">{uploading === `s${i}` ? <span className="spinner" /> : <Icon name="upload" size={14} />}</span>
            </button>
            <div className="slide-fields">
              <input placeholder={tr("عنوان اسلاید (مثلاً حراج پاییزه)")} value={sl.title} onChange={(e) => setSlide(i, { title: e.target.value })} />
              <input placeholder={tr("زیرعنوان (اختیاری)")} value={sl.subtitle || ''} onChange={(e) => setSlide(i, { subtitle: e.target.value })} />
              <div className="slide-link">
                <input placeholder={tr("متن دکمه (مثلاً مشاهده)")} value={sl.link_label || ''} onChange={(e) => setSlide(i, { link_label: e.target.value })} />
                <input dir="ltr" placeholder={tr("/products یا https://...")} value={sl.link || ''} onChange={(e) => setSlide(i, { link: e.target.value })} />
              </div>
              <input dir="ltr" className="slide-url" placeholder={tr("یا آدرس عکس: https://...")} value={sl.image.startsWith('/uploads/') ? '' : sl.image}
                onChange={(e) => setSlide(i, { image: e.target.value })} />
            </div>
            <div className="slide-actions">
              <IconButton icon="chevronDown" label={tr("پایین")} onClick={() => move(i, 1)} disabled={i === slides.length - 1} />
              <IconButton icon="chevronUp" label={tr("بالا")} onClick={() => move(i, -1)} disabled={i === 0} />
              <IconButton icon="trash" label={tr("حذف اسلاید")} tone="danger" onClick={() => setSlides(slides.filter((_, j) => j !== i))} />
            </div>
          </div>
        ))}
        {slides.length < 8 && (
          <button type="button" className="add-row" onClick={() => setSlides([...slides, { ...EMPTY_SLIDE }])}><Icon name="plus" /> {tr("افزودن اسلاید")}</button>
        )}
      </div>
    </Card>
  );
}
