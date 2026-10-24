import { tr } from '../i18n';
import { useEffect, useState } from 'react';
import { api, Change, Content, fa, faDate, FIELD_LABELS, isVideoUrl, Kind, KIND_LABELS, Platform, Product, timeAgo, toman } from '../api';
import { AttachmentsEditor, AttachmentsValue } from '../components/Attachments';
import ContentCard from '../components/ContentCard';
import GenerateWizard from '../components/GenerateWizard';
import Icon from '../components/Icon';
import ProductForm from '../components/ProductForm';
import {
  Badge, Button, Card, EmptyState, ErrorBox, Field, Modal, PageHeader, ProductImage, Skeleton, Tabs, useLoad, useUi,
} from '../components/ui';
import { goBack, href, navigate, setQueryParam, useRoute } from '../router';
import { cleanLinks, CONTENT_STATUS, InteractionSession, linkInvalid, stripTags } from '../api';
import { PlatformIcon, Truncate } from '../components/ui';
import { Price, StockBadge } from './Products';

interface Details { product: Product; changes: Change[]; contents: Content[] }

export default function ProductDetail({ id }: { id: number }) {
  const { toast, confirm } = useUi();
  const { data, error, loading, reload, setData } = useLoad(() => api.get<Details>(`/products/${id}/details`), [id]);
  const [active, setActive] = useState(0);
  const [tab, setTab] = useState<'contents' | 'changes'>('contents');
  const [editOpen, setEditOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const { query } = useRoute();
  const openId = Number(query.get('content') || 0);
  const iaStats = useLoad(() => api.get<{ content_id: number; taps: number; sessions: number; completed: number }[]>(`/interactions/by-product/${id}`), [id]);
  const statFor = (cid: number) => iaStats.data?.find((x) => x.content_id === cid);
  useEffect(() => setActive(0), [id]);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) {
    return (
      <div className="detail-grid">
        <Card><Skeleton h={380} /></Card>
        <Card><div className="stack-12"><Skeleton h={28} w="60%" /><Skeleton h={18} w="30%" /><Skeleton h={120} /></div></Card>
      </div>
    );
  }
  if (!data) return null;
  const p = data.product;
  const images = p.images?.length ? p.images : p.image_url ? [p.image_url] : [];
  const current = images[Math.min(active, Math.max(images.length - 1, 0))];

  const setImages = async (next: string[], msg: string) => {
    try {
      const updated = await api.put<Product>(`/products/${p.id}/images`, { images: next });
      setData({ ...data, product: updated });
      toast(msg);
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const fd = new FormData();
    Array.from(files).forEach((f) => fd.append('images', f));
    setUploading(true);
    try {
      const updated = await api.upload<Product>(`/products/${p.id}/images`, fd);
      setData({ ...data, product: updated });
      setActive(updated.images.length - 1);
      toast(`${fa(files.length)} ${tr("تصویر اضافه شد")}`);
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    if (!(await confirm(tr("حذف محصول"), `«${p.name}» ${tr("و تمام محتواهای مرتبط با آن حذف شود؟")}`, true))) return;
    try {
      await api.del(`/products/${p.id}`);
      toast(tr("محصول حذف شد"));
      navigate('/products');
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  };

  const pending = data.contents.filter((c) => c.status === 'pending').length;

  return (
    <>
      <PageHeader
        back="/products"
        title={p.name}
        subtitle={<span className="row gap-8 align-center wrap"><span className="mono-sm">{p.sku}</span>{p.category && <Badge>{p.category}</Badge>}<span className="muted">{tr("به‌روزرسانی")} {timeAgo(p.updated_at)}</span></span>}
        actions={
          <>
            <Button variant="secondary" icon="edit" onClick={() => setEditOpen(true)}>{tr("ویرایش")}</Button>
            <Button variant="ghost" icon="trash" className="text-danger" onClick={remove}>{tr("حذف")}</Button>
            <Button icon="sparkles" onClick={() => setGenOpen(true)}>{tr("ساخت محتوا")}</Button>
          </>
        }
      />

      <div className="detail-grid">
        <Card className="gallery-card">
          <div className="gallery-main">
            <ProductImage src={current} name={p.name} rounded={14} controls />
            {images.length > 1 && (
              <>
                <button className="gallery-nav prev" onClick={() => setActive((active - 1 + images.length) % images.length)} aria-label={tr("قبلی")}><Icon name="chevronRight" /></button>
                <button className="gallery-nav next" onClick={() => setActive((active + 1) % images.length)} aria-label={tr("بعدی")}><Icon name="chevronLeft" /></button>
              </>
            )}
          </div>
          <div className="gallery-thumbs">
            {images.map((img, i) => (
              <div key={img} className={`gallery-thumb ${i === active ? 'active' : ''}`} onClick={() => setActive(i)}>
                {isVideoUrl(img) ? <video src={`${img}#t=0.1`} muted preload="metadata" /> : <img src={img} alt="" />}
                {isVideoUrl(img) && <span className="thumb-video"><Icon name="video" size={12} /></span>}
                {i === 0 && <span className="main-tag">{tr("اصلی")}</span>}
                <div className="thumb-actions" onClick={(e) => e.stopPropagation()}>
                  {i !== 0 && <button title={tr("رسانه اصلی شود")} onClick={() => { setImages([img, ...images.filter((x) => x !== img)], tr("تصویر اصلی تغییر کرد")); setActive(0); }}><Icon name="star" size={13} /></button>}
                  <button title={tr("حذف تصویر")} onClick={async () => { if (await confirm(tr("حذف تصویر"), tr("این تصویر حذف شود؟"), true)) { setImages(images.filter((x) => x !== img), tr("تصویر حذف شد")); setActive(0); } }}><Icon name="trash" size={13} /></button>
                </div>
              </div>
            ))}
            <label className={`gallery-add ${uploading ? 'is-loading' : ''}`} title={tr("افزودن عکس یا فیلم")}>
              {uploading ? <span className="spinner" /> : <Icon name="plus" size={22} />}
              <input type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
            </label>
          </div>
        </Card>

        <div className="stack-16">
          <Card>
            <div className="info-top">
              <Price p={p} large />
              <StockBadge stock={p.stock} />
            </div>
            {p.description && <p className="product-desc">{p.description}</p>}
            <dl className="spec-list">
              <div><dt>{tr("کد کالا")}</dt><dd className="mono-sm">{p.sku}</dd></div>
              <div><dt>{tr("دسته‌بندی")}</dt><dd>{p.category || '—'}</dd></div>
              <div><dt>{tr("قیمت اصلی")}</dt><dd>{toman(p.price)}</dd></div>
              <div><dt>{tr("موجودی")}</dt><dd>{fa(p.stock)} {tr("عدد")}</dd></div>
              {Object.entries(p.attributes || {}).map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>
              ))}
              <div><dt>{tr("منبع")}</dt><dd>{p.source === 'csv' ? tr("فایل CSV") : p.source === 'manual' ? tr("ثبت دستی") : p.source}</dd></div>
            </dl>
          </Card>
          <Card className="cta-card">
            <div className="row gap-12 align-center">
              <span className="cta-icon"><Icon name="sparkles" size={22} /></span>
              <div className="grow">
                <strong>{tr("محتوای این محصول را برای کانال‌ها بسازید")}</strong>
                <p className="muted">{tr("برای هر شبکه متن مخصوص خودش ساخته می‌شود و پس از تأیید شما منتشر می‌شود.")}</p>
              </div>
            </div>
            <div className="row gap-8 wrap">
              <Button icon="sparkles" onClick={() => setGenOpen(true)}>{tr("ساخت خودکار")}</Button>
              <Button variant="secondary" icon="paperclip" onClick={() => setManualOpen(true)}>{tr("محتوای دستی (متن، عکس، فیلم، صدا)")}</Button>
            </div>
          </Card>
        </div>
      </div>

      <div className="section-gap">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'contents', label: tr("محتواهای این محصول"), count: pending || data.contents.length },
            { value: 'changes', label: tr("تاریخچه تغییرات"), count: data.changes.length },
          ]}
        />
        {tab === 'contents' ? (
          data.contents.length === 0 ? (
            <Card><EmptyState icon="sparkles" title={tr("هنوز محتوایی ساخته نشده")} text={tr("با «ساخت محتوا» برای هر شبکه متن اختصاصی بسازید.")} action={<Button icon="sparkles" onClick={() => setGenOpen(true)}>{tr("ساخت محتوا")}</Button>} /></Card>
          ) : (
            <div className="content-tiles">
              {data.contents.map((c) => <ContentTile key={c.id} c={c} fallbackImage={p.image_url} stat={statFor(c.id)} onOpen={() => setQueryParam('content', String(c.id))} />)}
            </div>
          )
        ) : (
          <Card>
            {data.changes.length === 0 ? (
              <EmptyState icon="history" title={tr("تغییری ثبت نشده")} text={tr("تغییرات قیمت، تخفیف و موجودی این محصول اینجا نمایش داده می‌شود.")} />
            ) : (
              <ul className="timeline">
                {data.changes.map((ch) => (
                  <li key={ch.id}>
                    <span className="timeline-dot" />
                    <div>
                      <strong>{FIELD_LABELS[ch.field] || ch.field}</strong>{' '}
                      <span className="old-val">{fmt(ch.field, ch.old_value)}</span>
                      <Icon name="chevronLeft" size={14} className="muted" />
                      <span className="new-val">{fmt(ch.field, ch.new_value)}</span>
                      <div className="muted small">{faDate(ch.created_at)} · {ch.source === 'csv' ? tr("از CSV") : tr("دستی")}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      {(() => {
        const oc = openId ? data.contents.find((c) => c.id === openId) : undefined;
        return (
          <Modal open={!!oc} onClose={() => goBack(`/products/${id}`)} size="lg"
            title={oc ? <span className="row gap-8 align-center"><PlatformIcon icon={oc.platform_icon} color={oc.platform_color} size={28} />{oc.platform_name} — {KIND_LABELS[oc.kind]}</span> : ''}
            subtitle={oc ? `${tr("ساخته‌شده")} ${timeAgo(oc.created_at)}` : undefined}
            footer={<Button variant="secondary" icon="arrowRight" onClick={() => goBack(`/products/${id}`)}>{tr("بازگشت به محتواها")}</Button>}>
            {oc && <ContentCard key={oc.id} c={oc} showProduct={false} onChanged={() => { reload(); iaStats.reload(); }} />}
            {oc && <ContentInteractions contentId={oc.id} />}
          </Modal>
        );
      })()}

      <ProductForm open={editOpen} product={p} onClose={() => setEditOpen(false)} onSaved={() => { setEditOpen(false); reload(); }} />
      <GenerateWizard open={genOpen} product={p} onClose={() => setGenOpen(false)} onDone={() => { setGenOpen(false); setTab('contents'); reload(); }} />
      <ManualContentModal open={manualOpen} product={p} onClose={() => setManualOpen(false)} onDone={() => { setManualOpen(false); setTab('contents'); reload(); }} />
    </>
  );
}

const fmt = (field: string, v: string | null) =>
  v === null ? '—' : field.includes('price') ? toman(v) : field === 'stock' ? fa(v) : v;

function ManualContentModal({ open, product, onClose, onDone }: { open: boolean; product: Product; onClose: () => void; onDone: () => void }) {
  const { toast } = useUi();
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [platformId, setPlatformId] = useState(0);
  const [kind, setKind] = useState<Kind>('intro');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [att, setAtt] = useState<AttachmentsValue>({ media: [], links: [], product_media: 'main' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setBody('');
    setAtt({ media: [], links: [], product_media: 'main' });
    setTitle('');
    api.get<Platform[]>('/platforms').then((p) => {
      const en = p.filter((x) => x.enabled);
      setPlatforms(en);
      setPlatformId(en[0]?.id || 0);
    }).catch(() => undefined);
  }, [open]);
  const platform = platforms.find((p) => p.id === platformId);
  const save = async () => {
    setBusy(true);
    try {
      if (att.links.some(linkInvalid)) {
        throw new Error(tr("عنوان، آدرس یا پاسخ همه دکمه‌ها را کامل کنید"));
      }
      await api.post('/contents', { productId: product.id, platformId, kind, title, body, ...att, links: cleanLinks(att.links) });
      toast(tr("محتوا ذخیره شد و آماده انتشار است"));
      onDone();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} size="lg" title={tr("ساخت محتوای دستی")} subtitle={`${product.name} — ${tr("متن، عکس، فیلم، صدا و لینک")}`}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("انصراف")}</Button><Button icon="check" loading={busy} disabled={(!body.trim() && !att.media.length) || !platformId} onClick={save}>{tr("ذخیره محتوا")}</Button></>}>
      <div className="form-grid">
        <Field label={tr("شبکه")}>
          <select value={platformId} onChange={(e) => setPlatformId(Number(e.target.value))}>
            {platforms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label={tr("نوع پیام")}>
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {(Object.keys(KIND_LABELS) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </select>
        </Field>
        {platform?.delivery === 'email' && <Field label={tr("موضوع ایمیل")} full><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>}
        <Field label={tr("متن")} full hint={platform?.max_length ? `${fa(body.length)} / ${fa(platform.max_length)} ${tr("کاراکتر")}` : undefined}>
          <textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} placeholder={tr("متن خود را بنویسید…")} />
        </Field>
        <div className="full">
          <AttachmentsEditor value={att} onChange={setAtt} productGallery={product.images?.length ? product.images : product.image_url ? [product.image_url] : []} />
        </div>
      </div>
    </Modal>
  );
}


function ContentTile({ c, fallbackImage, onOpen, stat }: { c: Content; fallbackImage: string; onOpen: () => void; stat?: { taps: number; sessions: number; completed: number } }) {
  const interactions = (stat?.taps || 0) + (stat?.sessions || 0);
  const st = CONTENT_STATUS[c.status];
  const img = c.media?.find((m) => m.type === 'image' || m.type === 'video')?.url || (c.product_media !== 'none' ? c.product_image || fallbackImage : '');
  const sent = c.publications?.filter((x) => x.status === 'sent').length || 0;
  return (
    <button type="button" className="content-tile" onClick={onOpen}>
      <div className="ct-media">
        {img ? <ProductImage src={img} name={c.product_name} rounded={0} /> : <div className="ct-text-only"><Icon name="file" size={28} /></div>}
        <span className={`ct-status ct-${st?.tone || 'neutral'}`}>{st?.label || c.status}</span>
        <span className="ct-logo"><PlatformIcon icon={c.platform_icon} color={c.platform_color} size={30} /></span>
        <span className="card-cta">{tr("مشاهده جزئیات")}</span>
      </div>
      <div className="ct-body">
        <div className="pc-title">
          <span className="pc-title-ico"><Icon name="sparkles" size={14} /></span>
          <h4><Truncate text={`${KIND_LABELS[c.kind]} · ${c.platform_name}`} max={34} /></h4>
        </div>
        <p className="ct-snippet">{stripTags(c.title || c.body).slice(0, 90)}</p>
        <div className="pc-foot">
          <span className="pc-cat"><Icon name="clock" size={13} />{timeAgo(c.created_at)}</span>
          <span className="pc-cat"><Icon name="send" size={13} />{fa(sent)} {tr("ارسال")}</span>
          {(c.media?.length || 0) > 0 && <span className="pc-cat"><Icon name="paperclip" size={13} />{fa(c.media.length)}</span>}
          {interactions > 0 && <span className="ct-ia" title={tr("تعامل کاربران با دکمه‌های این پست")}><Icon name="zap" size={12} />{fa(interactions)}</span>}
        </div>
      </div>
    </button>
  );
}

/** Who interacted with this post's buttons */
function ContentInteractions({ contentId }: { contentId: number }) {
  const s = useLoad(() => api.get<InteractionSession[]>(`/interactions/sessions?content_id=${contentId}`), [contentId]);
  const f = useLoad(() => api.get<{ id: number; button_title: string; tg_name: string; tg_username: string; created_at: string; content_id: number | null }[]>('/feedback?kind=click'), [contentId]);
  const taps = (f.data || []).filter((x) => x.content_id === contentId);
  const sessions = s.data || [];
  return (
    <div className="ci-box">
      <div className="row gap-8 align-center">
        <Icon name="zap" size={16} />
        <strong>{tr("تعامل کاربران با این پست")}</strong>
        <span className="grow" />
        <a className="link-sm" href={href('/interactions?tab=responses')}>{tr("همه پاسخ‌ها")}</a>
      </div>
      {!s.data ? <Skeleton h={50} /> : sessions.length + taps.length === 0 ? (
        <small className="muted">{tr("هنوز کسی با دکمه‌های این پست تعامل نکرده است.")}</small>
      ) : (
        <ul className="ci-list">
          {sessions.map((x) => (
            <li key={`s${x.id}`}>
              <span className="ci-emoji">{x.interaction_emoji || '⚡'}</span>
              <span className="grow min-0"><strong>{x.tg_name || x.tg_username || tr("کاربر تلگرام")}</strong> · {x.interaction_title}
                {x.answers.length > 0 && <small className="muted"> — <Truncate text={x.answers.map((a) => `${a.key || a.question}: ${a.answer}`).join(' | ')} max={70} /></small>}
              </span>
              <Badge tone={x.status === 'completed' ? 'success' : x.status === 'active' ? 'warning' : 'neutral'}>
                {x.status === 'completed' ? tr("تکمیل شده") : x.status === 'active' ? tr("در حال گفتگو") : tr("لغو شده")}
              </Badge>
              <small className="muted nowrap">{timeAgo(x.updated_at)}</small>
            </li>
          ))}
          {taps.map((x) => (
            <li key={`f${x.id}`}>
              <span className="ci-emoji">👆</span>
              <span className="grow min-0"><strong>{x.tg_name || x.tg_username || tr("کاربر تلگرام")}</strong> · {x.button_title}</span>
              <Badge tone="info">{tr("کلیک")}</Badge>
              <small className="muted nowrap">{timeAgo(x.created_at)}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
