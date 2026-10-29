import { tr } from '../i18n';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRoute } from '../router';
import { api, cleanLinks, Delivery, linkInvalid, DELIVERY_LABELS, Destination, fa, Kind, KIND_HINTS, KIND_LABELS, Platform, PRODUCT_MEDIA_LABELS, Template } from '../api';
import { AttachmentsEditor, AttachmentsValue } from '../components/Attachments';
import Icon from '../components/Icon';
import PlatformFields, { PlatformDraft } from '../components/PlatformForm';
import {
  Badge, Button, Card, EmptyState, ErrorBox, Field, IconButton, Modal, PageHeader, PlatformIcon, Skeleton, StepTabs, Switch, Truncate, useLoad, useUi,
} from '../components/ui';
import { ContentPreview } from '../components/ContentCard';
import { navigate } from '../router';
import InstagramAccounts from './InstagramAccounts';
import TelegramChannels from './TelegramChannels';

interface Details { platform: Platform; destinations: Destination[]; templates: Template[] }
type Tab = 'destinations' | 'templates' | 'settings';

export default function PlatformDetail({ id }: { id: number }) {
  const { data, error, loading, reload } = useLoad(() => api.get<Details>(`/platforms/${id}`), [id]);
  const { query } = useRoute();
  const initial = (query.get('tab') as Tab) || 'destinations';
  const [tab, setTab] = useState<Tab>(['destinations', 'templates', 'settings'].includes(initial) ? initial : 'destinations');
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Card><Skeleton h={260} /></Card>;
  if (!data) return null;
  const p = data.platform;
  return (
    <>
      <PageHeader
        back="/channels"
        title={<span className="row gap-12 align-center"><PlatformIcon icon={p.icon} color={p.color} size={40} />{p.name}{!p.enabled && <Badge>{tr("غیرفعال")}</Badge>}</span>}
        subtitle={DELIVERY_LABELS[p.delivery]}
      />
      <StepTabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'destinations', title: tr("تعریف مقصدها"), desc: `${tr("کانال، لیست گیرنده یا حساب‌های")} ${p.name}`, count: data.destinations.length, done: data.destinations.some((d) => d.enabled) },
          { value: 'templates', title: tr("قالب‌های محتوا"), desc: tr("متن، عکس، فیلم و لینک ثابت هر نوع پیام"), count: data.templates.length, done: data.templates.length > 0 },
          { value: 'settings', title: tr("تنظیمات شبکه"), desc: tr("نام، آیکون، سبک نوشتن و روش ارسال"), optional: true, done: true },
        ]}
      />
      {tab === 'destinations' && (p.key === 'telegram'
        ? <TelegramDestinations platform={p} items={data.destinations} reload={reload} />
        : p.delivery === 'instagram'
          ? <InstagramDestinations platform={p} items={data.destinations} reload={reload} />
          : <Destinations platform={p} items={data.destinations} reload={reload} />)}
      {tab === 'templates' && <Templates platform={p} items={data.templates} destinations={data.destinations} reload={reload} />}
      {tab === 'settings' && <PlatformSettings platform={p} reload={reload} />}
    </>
  );
}

// ================================================================ destinations

/** Telegram: channels are connected through the bot; older hand-entered destinations stay listed below */
function TelegramDestinations({ platform, items, reload }: { platform: Platform; items: Destination[]; reload: () => void }) {
  const manual = items.filter((d) => !d.config?.tg_channel);
  return (
    <>
      <TelegramChannels color={platform.color} onChange={reload} />
      {manual.length > 0 && (
        <div className="tg-manual">
          <h4>{tr("مقصدهای تعریف‌شده با شناسه")}</h4>
          <Destinations platform={platform} items={manual} reload={reload} />
        </div>
      )}
    </>
  );
}

/** Instagram: pages are connected by signing in to Instagram; older hand-made destinations stay listed below */
function InstagramDestinations({ platform, items, reload }: { platform: Platform; items: Destination[]; reload: () => void }) {
  const manual = items.filter((d) => !d.config?.ig_account_id);
  return (
    <>
      <InstagramAccounts color={platform.color} onChange={reload} />
      {manual.length > 0 && (
        <div className="tg-manual">
          <h4>{tr("مقصدهای انتشار دستی")}</h4>
          <Destinations platform={platform} items={manual} reload={reload} />
        </div>
      )}
    </>
  );
}

const DEST_HELP: Record<Delivery, string> = {
  telegram: tr("هر کانال یا گروه تلگرام یک مقصد است. ربات باید در کانال «ادمین» با دسترسی ارسال پیام باشد."),
  instagram: tr("هر پیج اینستاگرام یک مقصد است."),
  email: tr("هر لیست گیرنده یک مقصد است؛ مثلاً «مشتریان VIP» یا «خبرنامه عمومی»."),
  webhook: tr("محتوا به آدرس API شما ارسال می‌شود؛ مناسب پنل‌های پیامک، n8n یا هر سرویس دیگر."),
  manual: tr("مثلاً هر پیج یا حساب کاربری یک مقصد است؛ متن آماده می‌شود تا آن را کپی و منتشر کنید."),
};

function destSummary(d: Destination) {
  const c = d.config || {};
  if (d.delivery === 'telegram') return c.chat_id;
  if (d.delivery === 'email') return `${fa(String(c.recipients || '').split(/[\s,،;]+/).filter(Boolean).length)} ${tr("گیرنده")} · ${c.smtp_host}`;
  if (d.delivery === 'webhook') {
    const n = String(c.recipients || '').split(/[\s,،;]+/).filter(Boolean).length;
    return `${c.method || 'POST'} ${c.url}${n ? ` · ${fa(n)} ${tr("گیرنده")}` : ''}`;
  }
  return c.handle || c.note || tr("انتشار دستی");
}

function Destinations({ platform, items, reload }: { platform: Platform; items: Destination[]; reload: () => void }) {
  const { toast, confirm } = useUi();
  const [editing, setEditing] = useState<Destination | null | 'new'>(null);
  const [testing, setTesting] = useState(0);

  const test = async (d: Destination) => {
    setTesting(d.id);
    try {
      const r = await api.post<{ status: string; message: string }>(`/destinations/${d.id}/test`);
      toast(r.status === 'manual' ? tr("این مقصد انتشار دستی دارد؛ اتصال نیاز به آزمون ندارد") : `${tr("آزمون موفق:")} ${r.message}`, r.status === 'manual' ? 'info' : 'success');
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setTesting(0);
    }
  };

  const toggle = async (d: Destination, enabled: boolean) => {
    try {
      await api.put(`/destinations/${d.id}`, { enabled });
      reload();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  };

  return (
    <>
      <div className="hint-box"><Icon name="bell" size={16} /> {DEST_HELP[platform.delivery]}</div>
      {items.length === 0 ? (
        <Card>
          <EmptyState icon="send" title={`${tr("هنوز مقصدی برای")} ${platform.name} ${tr("تعریف نشده")}`} text={tr("اولین مقصد را اضافه کنید تا بتوانید محتوا را منتشر کنید.")}
            action={<Button icon="plus" onClick={() => setEditing('new')}>{tr("افزودن مقصد")}</Button>} />
        </Card>
      ) : (
        <div className="dest-list">
          {items.map((d) => (
            <Card key={d.id} className={`dest-card ${d.enabled ? '' : 'disabled'}`}>
              <PlatformIcon icon={platform.icon} color={platform.color} size={42} />
              <div className="grow min-0">
                <div className="row gap-8 align-center"><strong>{d.name}</strong>{!d.enabled && <Badge>{tr("غیرفعال")}</Badge>}</div>
                <div className="muted small" dir="auto"><Truncate text={destSummary(d)} max={70} /></div>
              </div>
              <Switch checked={d.enabled} onChange={(v) => toggle(d, v)} />
              {platform.delivery !== 'manual' && <Button size="sm" variant="secondary" icon="zap" loading={testing === d.id} onClick={() => test(d)}>{tr("ارسال آزمایشی")}</Button>}
              <IconButton icon="edit" label={tr("ویرایش")} onClick={() => setEditing(d)} />
              <IconButton icon="trash" label={tr("حذف")} tone="danger" onClick={async () => {
                if (await confirm(tr("حذف مقصد"), `«${d.name}» ${tr("حذف شود؟ سوابق انتشار آن هم حذف می‌شود.")}`, true)) {
                  await api.del(`/destinations/${d.id}`).catch((e) => toast(e.message, 'danger'));
                  reload();
                }
              }} />
            </Card>
          ))}
          <button className="add-row" onClick={() => setEditing('new')}><Icon name="plus" /> {tr("افزودن مقصد دیگر برای")} {platform.name}</button>
        </div>
      )}
      <DestinationForm platform={platform} dest={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />
    </>
  );
}

function DestinationForm({ platform, dest, open, onClose, onSaved }: {
  platform: Platform; dest: Destination | null; open: boolean; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useUi();
  const [name, setName] = useState('');
  const [cfg, setCfg] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(dest?.name || '');
    setCfg(dest?.config || (platform.delivery === 'webhook' ? { method: 'POST' } : platform.delivery === 'email' ? { smtp_port: '587' } : {}));
  }, [open, dest, platform.delivery]);
  const c = (k: string) => ({ value: cfg[k] ?? '', onChange: (e: { target: { value: string } }) => setCfg((s) => ({ ...s, [k]: e.target.value })) });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (dest) await api.put(`/destinations/${dest.id}`, { name, config: cfg });
      else await api.post('/destinations', { platform_id: platform.id, name, config: cfg });
      toast(dest ? tr("مقصد به‌روزرسانی شد") : tr("مقصد جدید اضافه شد"));
      onSaved();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const d = platform.delivery;
  const isSms = platform.key === 'sms';
  return (
    <Modal open={open} onClose={onClose} size="lg" title={dest ? `${tr("ویرایش")} «${dest.name}»` : `${tr("مقصد جدید")} ${platform.name}`}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("انصراف")}</Button><Button form="dest-form" type="submit" icon="check" loading={busy}>{tr("ذخیره")}</Button></>}>
      <form id="dest-form" onSubmit={save} className="form-grid">
        <Field label={tr("نام مقصد")} full hint={tr("نامی که در پنل نمایش داده می‌شود")}>
          <input required value={name} onChange={(e) => setName(e.target.value)}
            placeholder={d === 'telegram' ? tr("مثلاً: کانال اصلی فروشگاه") : d === 'email' ? tr("مثلاً: خبرنامه مشتریان") : isSms ? tr("مثلاً: مشتریان وفادار") : tr("مثلاً: پیج اصلی")} />
        </Field>

        {d === 'telegram' && (
          <Field label={tr("شناسه کانال یا گروه")} full hint={tr("برای کانال عمومی: ‎@channel_name — برای کانال خصوصی: شناسه عددی مثل ‎-1001234567890")}>
            <input required dir="ltr" {...c('chat_id')} placeholder="@my_channel" />
          </Field>
        )}

        {d === 'email' && (
          <>
            <Field label={tr("گیرندگان")} full hint={tr("هر ایمیل در یک خط یا جدا با کاما؛ گیرندگان یکدیگر را نمی‌بینند (BCC)")}>
              <textarea required rows={3} dir="ltr" {...c('recipients')} placeholder={'customer1@mail.com\ncustomer2@mail.com'} />
            </Field>
            <Field label={tr("سرور SMTP")}><input required dir="ltr" {...c('smtp_host')} placeholder="smtp.gmail.com" /></Field>
            <Field label={tr("پورت")}><input dir="ltr" {...c('smtp_port')} placeholder="587" /></Field>
            <Field label={tr("نام کاربری")}><input dir="ltr" {...c('smtp_user')} placeholder="shop@mail.com" /></Field>
            <Field label={tr("رمز عبور / App Password")}><input type="password" dir="ltr" {...c('smtp_password')} autoComplete="new-password" /></Field>
            <Field label={tr("فرستنده (From)")} full hint={tr("مثلاً: \"فروشگاه من\" <shop@mail.com>")}><input dir="ltr" {...c('from')} /></Field>
          </>
        )}

        {d === 'webhook' && (
          <>
            <Field label={tr("آدرس وب‌هوک / API")} full hint={tr("می‌توانید از {text} {to} {title} {product_name} {image_url} در آدرس استفاده کنید (مقادیر خودکار encode می‌شوند)")}>
              <input required dir="ltr" {...c('url')} placeholder={isSms ? 'https://api.sms-panel.ir/send?to={to}&text={text}' : 'https://example.com/webhook'} />
            </Field>
            <Field label={tr("متد")}>
              <select {...c('method')}><option value="POST">POST</option><option value="GET">GET</option><option value="PUT">PUT</option></select>
            </Field>
            <Field label={tr("هدر Authorization (اختیاری)")}><input type="password" dir="ltr" {...c('auth_header')} placeholder="Bearer xxxxx" autoComplete="new-password" /></Field>
            {(isSms || cfg.recipients) && (
              <Field label={isSms ? tr("شماره‌های گیرنده") : tr("گیرندگان")} full hint={tr("هر شماره در یک خط یا جدا با کاما؛ در وب‌هوک با {to} در دسترس است")}>
                <textarea rows={3} dir="ltr" {...c('recipients')} placeholder={'09121234567\n09351234567'} />
              </Field>
            )}
            <Field label={tr("قالب بدنه درخواست (اختیاری)")} full hint={tr("خالی = JSON استاندارد شامل text، title، recipients و product. نمونه: {\"receptor\":\"{to}\",\"message\":\"{text}\"}")}>
              <textarea rows={3} dir="ltr" className="mono" {...c('body_template')} />
            </Field>
            <Field label={tr("هدرهای اضافه (JSON، اختیاری)")} full><input dir="ltr" className="mono" {...c('headers')} placeholder='{"apikey":"..."}' /></Field>
          </>
        )}

        {d === 'manual' && (
          <Field label={tr("شناسه / آدرس حساب (اختیاری)")} full hint={tr("فقط برای یادآوری؛ مثلاً ‎@my_shop یا آدرس صفحه")}>
            <input dir="ltr" {...c('handle')} placeholder="@my_shop" />
          </Field>
        )}
      </form>
    </Modal>
  );
}

// ================================================================ templates

function Templates({ platform, items, destinations, reload }: { platform: Platform; items: Template[]; destinations: Destination[]; reload: () => void }) {
  const { toast, confirm } = useUi();
  const [kind, setKind] = useState<Kind>('intro');
  const [editing, setEditing] = useState<Template | null | 'new'>(null);
  const list = items.filter((t) => t.kind === kind);
  return (
    <>
      <div className="hint-box"><Icon name="file" size={16} /> {tr("برای هر نوع پیام، متن مخصوص")} {platform.name} {tr("را تعریف کنید. قالب پیش‌فرض (★) هنگام ساخت خودکار استفاده می‌شود؛ می‌توانید برای یک مقصد خاص هم قالب جدا بسازید.")}</div>
      <div className="kind-tabs">
        {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
          <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
            <strong>{KIND_LABELS[k]}</strong>
            <small>{fa(items.filter((t) => t.kind === k).length)} {tr("قالب")}</small>
          </button>
        ))}
      </div>
      <div className="template-grid">
        {list.map((t) => (
          <Card key={t.id} className="template-card">
            <div className="row gap-8 align-center wrap">
              <strong className="grow">{t.name}</strong>
              {t.is_default && <Badge tone="warning"><Icon name="star" size={12} /> {tr("پیش‌فرض")}</Badge>}
              {t.destination_id && <Badge tone="info">{tr("ویژه")} {destinations.find((d) => d.id === t.destination_id)?.name || tr("مقصد")}</Badge>}
            </div>
            <pre className="template-body">{t.body}</pre>
            <div className="template-meta">
              <span><Icon name="box" size={13} /> {PRODUCT_MEDIA_LABELS[t.product_media || 'main']}</span>
              {(t.media?.length || 0) > 0 && <span><Icon name="paperclip" size={13} /> {fa(t.media.length)} {tr("فایل ثابت")}</span>}
              {(t.links?.length || 0) > 0 && <span><Icon name="link" size={13} /> {fa(t.links.length)} {tr("دکمه")}</span>}
            </div>
            <div className="row gap-8">
              <Button size="sm" variant="secondary" icon="edit" onClick={() => setEditing(t)}>{tr("ویرایش")}</Button>
              {!t.is_default && <Button size="sm" variant="ghost" icon="star" onClick={async () => { await api.put(`/templates/${t.id}`, { is_default: true }).catch((e) => toast(e.message, 'danger')); reload(); }}>{tr("پیش‌فرض شود")}</Button>}
              <span className="grow" />
              <IconButton icon="trash" label={tr("حذف")} tone="danger" onClick={async () => {
                if (await confirm(tr("حذف قالب"), `${tr("قالب")} «${t.name}» ${tr("حذف شود؟")}`, true)) { await api.del(`/templates/${t.id}`).catch((e) => toast(e.message, 'danger')); reload(); }
              }} />
            </div>
          </Card>
        ))}
        <button className="template-card add" onClick={() => setEditing('new')}>
          <Icon name="plus" size={24} />
          <strong>{tr("قالب جدید")} «{KIND_LABELS[kind]}»</strong>
          <small className="muted">{KIND_HINTS[kind]}</small>
        </button>
      </div>
      <TemplateEditor
        open={editing !== null}
        platform={platform}
        destinations={destinations}
        template={editing === 'new' ? null : editing}
        kind={kind}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); reload(); }}
      />
    </>
  );
}

interface Meta { placeholders: { key: string; label: string }[] }

function TemplateEditor({ open, platform, destinations, template, kind, onClose, onSaved }: {
  open: boolean; platform: Platform; destinations: Destination[]; template: Template | null; kind: Kind; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useUi();
  const meta = useLoad(() => api.get<Meta>('/meta'));
  const [form, setForm] = useState({ name: '', kind, title: '', body: '', destination_id: '' as string, is_default: false });
  const [att, setAtt] = useState<AttachmentsValue>({ media: [], links: [], product_media: 'main' });
  const [preview, setPreview] = useState({ title: '', body: '' });
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setForm(template
      ? { name: template.name, kind: template.kind, title: template.title, body: template.body, destination_id: template.destination_id ? String(template.destination_id) : '', is_default: template.is_default }
      : { name: '', kind, title: '', body: '', destination_id: '', is_default: false });
    setAtt(template
      ? { media: template.media || [], links: template.links || [], product_media: template.product_media || 'main' }
      : { media: [], links: [], product_media: 'main' });
  }, [open, template, kind]);

  // live preview (debounced)
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      api.post<{ title: string; body: string }>('/templates/preview', { title: form.title, body: form.body || ' ' }).then(setPreview).catch(() => undefined);
    }, 300);
    return () => clearTimeout(t);
  }, [open, form.title, form.body]);

  const insert = (key: string) => {
    const el = ref.current;
    const token = `{${key}}`;
    if (!el) return setForm((f) => ({ ...f, body: f.body + token }));
    const start = el.selectionStart ?? form.body.length;
    const end = el.selectionEnd ?? form.body.length;
    const body = form.body.slice(0, start) + token + form.body.slice(end);
    setForm((f) => ({ ...f, body }));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (att.links.some(linkInvalid)) {
      setBusy(false);
      return toast(tr("عنوان، آدرس یا پاسخ همه دکمه‌ها را کامل کنید"), 'danger');
    }
    const payload = {
      ...form, ...att,
      links: cleanLinks(att.links),
      platform_id: platform.id,
      destination_id: form.destination_id ? Number(form.destination_id) : null,
    };
    try {
      if (template) await api.put(`/templates/${template.id}`, payload);
      else await api.post('/templates', payload);
      toast(tr("قالب ذخیره شد"));
      onSaved();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const isEmail = platform.delivery === 'email';
  return (
    <Modal open={open} onClose={onClose} size="xl" title={template ? tr("ویرایش قالب") : tr("قالب جدید")} subtitle={`${platform.name} — ${KIND_LABELS[form.kind]}`}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("انصراف")}</Button><Button form="tpl-form" type="submit" icon="check" loading={busy}>{tr("ذخیره قالب")}</Button></>}>
      <div className="editor-split">
        <form id="tpl-form" onSubmit={save} className="form-grid">
          <Field label={tr("نام قالب")}><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={tr("مثلاً: معرفی کوتاه")} /></Field>
          <Field label={tr("نوع پیام")}>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}>
              {(Object.keys(KIND_LABELS) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
            </select>
          </Field>
          <Field label={tr("مخصوص مقصد")} hint={tr("خالی = برای همه مقصدهای این شبکه")}>
            <select value={form.destination_id} onChange={(e) => setForm({ ...form, destination_id: e.target.value })}>
              <option value="">{tr("همه مقصدها")}</option>
              {destinations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label={tr("قالب پیش‌فرض")}>
            <div className="field-switch"><Switch checked={form.is_default} onChange={(v) => setForm({ ...form, is_default: v })} label={tr("هنگام ساخت خودکار استفاده شود")} /></div>
          </Field>
          {isEmail && <Field label={tr("موضوع ایمیل")} full><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={tr("مثلاً: 🔥 تخفیف ویژه {name}")} /></Field>}
          <Field label={tr("متن قالب")} full hint={platform.delivery === 'telegram' ? tr("برای متن پررنگ <b>…</b> و خط‌خورده <s>…</s>. خطی که همه متغیرهایش خالی باشد خودکار حذف می‌شود.") : tr("خطی که همه متغیرهایش خالی باشد (مثلاً تخفیف ندارد) خودکار حذف می‌شود.")}>
            <textarea ref={ref} required rows={12} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} placeholder={tr("متن خود را بنویسید و از متغیرهای زیر استفاده کنید…")} />
          </Field>
          <div className="full">
            <span className="field-label">{tr("متغیرها — برای درج کلیک کنید")}</span>
            <div className="placeholder-chips">
              {(meta.data?.placeholders || []).map((p) => (
                <button type="button" key={p.key} onClick={() => insert(p.key)} title={`{${p.key}}`}>{p.label}</button>
              ))}
            </div>
          </div>
          <div className="full">
            <AttachmentsEditor value={att} onChange={setAtt} forTemplate />
          </div>
        </form>
        <div className="editor-preview">
          <div className="row gap-8 align-center"><Icon name="eye" size={16} /><strong>{tr("پیش‌نمایش زنده")}</strong><small className="muted">{tr("با محصول نمونه")}</small></div>
          <ContentPreview c={{ platform_delivery: platform.delivery, channel: platform.key, product_image: '', platform_color: platform.color }}
            body={preview.body} title={preview.title} media={att.media} links={att.links} productMedia="none" />
          {att.product_media !== 'none' && (
            <small className="muted"><Icon name="box" size={13} /> {PRODUCT_MEDIA_LABELS[att.product_media]} {tr("هر محصول هم به ابتدای پست اضافه می‌شود.")}</small>
          )}
          {platform.max_length && (
            <div className={`char-count ${preview.body.length > platform.max_length ? 'over' : ''}`}>{fa(preview.body.length)} / {fa(platform.max_length)} {tr("کاراکتر")}</div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ================================================================ settings

function PlatformSettings({ platform, reload }: { platform: Platform; reload: () => void }) {
  const { toast, confirm } = useUi();
  const [draft, setDraft] = useState<PlatformDraft>(platform);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(platform), [platform]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const orig = (platform as Platform & { name_orig?: string }).name_orig;
      await api.put(`/platforms/${platform.id}`, orig && draft.name === platform.name ? { ...draft, name: orig } : draft);
      toast(tr("تنظیمات شبکه ذخیره شد"));
      reload();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <form onSubmit={save}>
        <PlatformFields value={draft} onChange={setDraft} platform={platform} />
        <div className="form-actions">
          {!platform.is_builtin && (
            <Button type="button" variant="ghost" icon="trash" className="text-danger" onClick={async () => {
              if (await confirm(tr("حذف شبکه"), `${tr("شبکه")} «${platform.name}» ${tr("با همه مقصدها و قالب‌هایش حذف شود؟")}`, true)) {
                await api.del(`/platforms/${platform.id}`).then(() => { toast(tr("شبکه حذف شد")); navigate('/channels'); }).catch((err) => toast(err.message, 'danger'));
              }
            }}>{tr("حذف شبکه")}</Button>
          )}
          <span className="grow" />
          <Button type="submit" icon="check" loading={busy}>{tr("ذخیره تنظیمات")}</Button>
        </div>
      </form>
    </Card>
  );
}
