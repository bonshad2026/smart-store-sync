import { tr } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { api, cleanLinks, Content, linkInvalid, CONTENT_STATUS, Destination, fa, KIND_LABELS, LinkItem, MediaItem, productMediaItems, ProductMediaMode, PUB_STATUS, stripTags, timeAgo } from '../api';
import { href } from '../router';
import { AttachmentsEditor, AttachmentsValue, MediaPreview } from './Attachments';
import Icon from './Icon';
import { Badge, Button, copyText, IconButton, Modal, PlatformChip, ProductImage, Switch, useUi } from './ui';

/** Renders Telegram-style HTML (<b>, <s>, ...) safely for previews */
function richPreview(text: string) {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.replace(/&lt;(\/?)(b|i|s|u|code)&gt;/g, '<$1$2>').replace(/\n/g, '<br/>');
}

export function ContentPreview({ c, body, title, media = [], links = [], productMedia = 'main', productGallery }: {
  c: Pick<Content, 'platform_delivery' | 'channel' | 'product_image' | 'platform_color'>;
  body: string;
  title?: string;
  media?: MediaItem[];
  links?: LinkItem[];
  productMedia?: ProductMediaMode;
  productGallery?: string[];
}) {
  const isTelegram = c.platform_delivery === 'telegram' || c.channel === 'telegram';
  const seen = new Set<string>();
  const all: MediaItem[] = [...productMediaItems(productGallery, productMedia, c.product_image), ...media]
    .filter((m) => (seen.has(m.url) ? false : (seen.add(m.url), true)))
    .slice(0, 10);
  const validLinks = links.filter((l) => l.title && l.url);
  if (c.channel === 'sms') {
    return (
      <div className="preview preview-sms">
        <div className="sms-bubble">
          {stripTags(body)}
          {validLinks.map((l, i) => <div key={i} className="sms-link">{l.url}</div>)}
        </div>
      </div>
    );
  }
  if (c.channel === 'email' || c.platform_delivery === 'email') {
    return (
      <div className="preview preview-email">
        <div className="email-subject">{title || tr("بدون عنوان")}</div>
        <MediaPreview media={all} />
        <div className="email-body">{stripTags(body)}</div>
        <MediaPreview media={[]} links={validLinks} />
      </div>
    );
  }
  return (
    <div className={`preview ${isTelegram ? 'preview-telegram' : 'preview-post'}`}>
      <div className="post-bubble">
        <MediaPreview media={all} />
        {body.trim() && <div dangerouslySetInnerHTML={{ __html: richPreview(body) }} />}
      </div>
      {validLinks.length > 0 && <MediaPreview media={[]} links={validLinks} />}
    </div>
  );
}

export default function ContentCard({ c, onChanged, showProduct = true }: { c: Content; onChanged: () => void; showProduct?: boolean }) {
  const { toast, confirm } = useUi();
  const [body, setBody] = useState(c.body);
  const [title, setTitle] = useState(c.title);
  const [preview, setPreview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const initialAtt = (): AttachmentsValue => ({
    media: c.media || [],
    links: c.links || [],
    product_media: c.product_media || (c.use_product_image === false ? 'none' : 'main'),
  });
  const [att, setAtt] = useState<AttachmentsValue>(initialAtt);
  useEffect(() => { setBody(c.body); setTitle(c.title); setAtt(initialAtt()); }, [c]);

  const attDirty = JSON.stringify(att) !== JSON.stringify(initialAtt());
  const dirty = body !== c.body || title !== c.title || attDirty;
  const badLink = att.links.some(linkInvalid);
  const over = c.max_length ? stripTags(body).length > c.max_length : false;
  const isEmail = c.channel === 'email' || c.platform_delivery === 'email';
  const st = CONTENT_STATUS[c.status] || CONTENT_STATUS.pending;

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(msg);
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const payload = () => ({ body, title, ...att, links: cleanLinks(att.links) });
  const saveText = () => act(() => api.patch(`/contents/${c.id}`, payload()), tr("تغییرات ذخیره شد"));
  const openPublish = async () => {
    if (badLink) return toast(tr("عنوان، آدرس یا پاسخ همه دکمه‌ها را کامل کنید"), 'danger');
    if (dirty) {
      try { await api.patch(`/contents/${c.id}`, payload()); } catch (e) { return toast((e as Error).message, 'danger'); }
    }
    setPublishOpen(true);
  };

  return (
    <article className={`content-card status-${c.status}`}>
      <header className="content-card-head">
        <div className="row gap-8 wrap align-center">
          <PlatformChip name={c.platform_name || c.channel} icon={c.platform_icon || 'globe'} color={c.platform_color || '#6366f1'} />
          <Badge tone="brand">{KIND_LABELS[c.kind] || c.kind}</Badge>
          <Badge tone={st.tone} dot>{st.label}</Badge>
        </div>
        <div className="row gap-4">
          <IconButton icon={preview ? 'edit' : 'eye'} label={preview ? tr("ویرایش متن و پیوست‌ها") : tr("پیش‌نمایش")} onClick={() => setPreview(!preview)} />
          <IconButton icon="copy" label={tr("کپی متن")} onClick={() => { copyText(stripTags(body)); toast(tr("متن کپی شد"), 'info'); }} />
          <IconButton icon="trash" label={tr("حذف")} tone="danger" onClick={async () => {
            if (await confirm(tr("حذف محتوا"), tr("این محتوا و سوابق انتشار آن حذف شود؟"), true)) act(() => api.del(`/contents/${c.id}`), tr("محتوا حذف شد"));
          }} />
        </div>
      </header>

      {showProduct && (
        <a className="content-product" href={href(`/products/${c.product_id}`)}>
          <ProductImage src={c.product_image} name={c.product_name} className="thumb-32" rounded={8} />
          <span>{c.product_name}</span>
        </a>
      )}

      {preview ? (
        <div onDoubleClick={() => setPreview(false)}>
          <ContentPreview c={c} body={body} title={title} media={att.media} links={att.links} productMedia={att.product_media} productGallery={c.product_images} />
        </div>
      ) : (
        <div className="content-editor">
          {isEmail && <input className="title-input" placeholder={tr("موضوع ایمیل")} value={title} onChange={(e) => setTitle(e.target.value)} />}
          <textarea rows={9} value={body} onChange={(e) => setBody(e.target.value)} />
          <AttachmentsEditor value={att} onChange={setAtt} productGallery={c.product_images || (c.product_image ? [c.product_image] : [])} compact />
        </div>
      )}

      <div className="content-meta">
        <span>{c.generated_by === 'ai' ? tr("🤖 هوش مصنوعی") : c.generated_by === 'manual' ? tr("✍️ دستی") : tr("📄 قالب")}</span>
        <span>·</span>
        <span>{timeAgo(c.created_at)}</span>
        {(att.media.length > 0 || att.links.length > 0) && (
          <span className="meta-attach"><Icon name="paperclip" size={12} />{fa(att.media.length)} {tr("فایل")}{att.links.length ? ` · ${fa(att.links.length)} ${tr("لینک")}` : ''}</span>
        )}
        <span className={`char-count ${over ? 'over' : ''}`}>
          {fa(stripTags(body).length)}{c.max_length ? ` / ${fa(c.max_length)}` : ''} {tr("کاراکتر")}
        </span>
      </div>

      {c.publications.length > 0 && (
        <div className="pub-list">
          {c.publications.map((p) => {
            const ps = PUB_STATUS[p.status] || PUB_STATUS.scheduled;
            return (
              <span key={p.id} className={`pub-chip pub-${p.status}`} title={p.message}>
                <Icon name={p.status === 'sent' ? 'check' : p.status === 'failed' ? 'alert' : p.status === 'manual' ? 'copy' : 'clock'} size={13} />
                {p.destination_name} — {ps.label}
              </span>
            );
          })}
        </div>
      )}

      <footer className="content-card-foot">
        {dirty && <Button variant="secondary" size="sm" icon="check" loading={busy} disabled={badLink} onClick={saveText}>{tr("ذخیره تغییرات")}</Button>}
        {c.status === 'pending' && (
          <Button variant="ghost" size="sm" icon="x" disabled={busy} onClick={() => act(() => api.patch(`/contents/${c.id}`, { status: 'rejected' }), tr("محتوا رد شد"))}>{tr("رد")}</Button>
        )}
        {c.status === 'rejected' && (
          <Button variant="ghost" size="sm" icon="refresh" disabled={busy} onClick={() => act(() => api.patch(`/contents/${c.id}`, { status: 'pending' }), tr("به صف بررسی برگشت"))}>{tr("بازگردانی")}</Button>
        )}
        <span className="grow" />
        <Button size="sm" icon="send" disabled={busy || over} onClick={openPublish}>
          {c.status === 'pending' ? tr("تأیید و انتشار") : c.publications.length ? tr("انتشار در مقصد دیگر") : tr("انتشار")}
        </Button>
      </footer>

      <PublishDialog open={publishOpen} content={c} onClose={() => setPublishOpen(false)} onDone={() => { setPublishOpen(false); onChanged(); }} />
    </article>
  );
}

// ------------------------------------------------------------------ publish dialog

interface PublishResult { results: { id: number; status: string; message?: string; destination?: string }[] }

export function PublishDialog({ open, content, onClose, onDone }: { open: boolean; content: Content; onClose: () => void; onDone: () => void }) {
  const { toast } = useUi();
  const [dests, setDests] = useState<Destination[] | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [later, setLater] = useState(false);
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);

  const alreadySent = useMemo(
    () => new Set(content.publications.filter((p) => p.status === 'sent' || p.status === 'manual').map((p) => p.destination_id)),
    [content.publications],
  );

  useEffect(() => {
    if (!open) return;
    setLater(false);
    setWhen('');
    api.get<Destination[]>(`/destinations?platform_id=${content.platform_id}`).then((d) => {
      setDests(d);
      setSelected(d.filter((x) => x.enabled && !alreadySent.has(x.id)).map((x) => x.id));
    }).catch((e) => toast(e.message, 'danger'));
  }, [open, content.platform_id, alreadySent, toast]);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post<PublishResult>(`/contents/${content.id}/publish`, {
        destinationIds: selected,
        scheduledAt: later && when ? new Date(when).toISOString() : null,
      });
      const ok = r.results.filter((x) => x.status === 'sent').length;
      const manual = r.results.filter((x) => x.status === 'manual').length;
      const scheduled = r.results.filter((x) => x.status === 'scheduled').length;
      const failed = r.results.filter((x) => x.status === 'failed');
      if (ok) toast(`${fa(ok)} ${tr("مقصد با موفقیت ارسال شد")}`);
      if (manual) toast(`${fa(manual)} ${tr("مقصد برای انتشار دستی آماده شد — متن را کپی و منتشر کنید")}`, 'info');
      if (scheduled) toast(`${fa(scheduled)} ${tr("مقصد در صف زمان‌بندی قرار گرفت")}`, 'info');
      failed.forEach((f) => toast(f.message || tr("ارسال ناموفق بود"), 'danger'));
      onDone();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={tr("انتشار محتوا")}
      subtitle={`${content.platform_name} — ${content.product_name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{tr("انصراف")}</Button>
          <Button icon={later ? 'clock' : 'send'} loading={busy} disabled={!selected.length || (later && !when)} onClick={submit}>
            {later ? tr("زمان‌بندی انتشار") : `${tr("انتشار در")} ${fa(selected.length)} ${tr("مقصد")}`}
          </Button>
        </>
      }
    >
      <h4 className="section-label">{tr("مقصدها")}</h4>
      {!dests ? (
        <p className="muted">{tr("در حال بارگذاری…")}</p>
      ) : dests.length === 0 ? (
        <div className="alert alert-warning">
          <Icon name="alert" />
          <span>{tr("برای")} {content.platform_name} {tr("هنوز مقصدی تعریف نشده است.")}</span>
          <a className="btn btn-soft btn-sm" href={href(`/channels/${content.platform_id}`)}>{tr("تعریف مقصد")}</a>
        </div>
      ) : (
        <div className="check-list">
          {dests.map((d) => (
            <label key={d.id} className={`check-item ${!d.enabled ? 'disabled' : ''}`}>
              <input type="checkbox" disabled={!d.enabled} checked={selected.includes(d.id)}
                onChange={(e) => setSelected(e.target.checked ? [...selected, d.id] : selected.filter((x) => x !== d.id))} />
              <div>
                <strong>{d.name}</strong>
                <small>{d.config.chat_id || d.config.recipients || d.config.url || (d.delivery === 'manual' ? tr("انتشار دستی") : '')}</small>
              </div>
              {alreadySent.has(d.id) && <Badge tone="success">{tr("قبلاً منتشر شده")}</Badge>}
              {!d.enabled && <Badge>{tr("غیرفعال")}</Badge>}
            </label>
          ))}
        </div>
      )}

      <h4 className="section-label">{tr("زمان انتشار")}</h4>
      <div className="row gap-12 wrap align-center">
        <Switch checked={later} onChange={setLater} label={tr("انتشار در زمان مشخص")} />
        {later && <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />}
      </div>
      {content.platform_delivery === 'manual' && (
        <p className="hint-box"><Icon name="copy" size={16} /> {tr("این شبکه انتشار خودکار ندارد؛ پس از انتشار، متن در صف «آماده انتشار دستی» قرار می‌گیرد تا آن را کپی و منتشر کنید.")}</p>
      )}
    </Modal>
  );
}
