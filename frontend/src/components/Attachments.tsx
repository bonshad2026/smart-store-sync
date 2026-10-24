import { LOCALE, tr } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { api, fa, fileSize, Interaction, isVideoUrl, LinkItem, MediaItem, MediaType, PRODUCT_MEDIA_LABELS, ProductMediaMode } from '../api';
import { href } from '../router';
import Icon from './Icon';
import { Button, IconButton, Switch, useUi } from './ui';

export interface AttachmentsValue {
  media: MediaItem[];
  links: LinkItem[];
  product_media: ProductMediaMode;
}

const ACCEPT: Record<MediaType, string> = { image: 'image/*', video: 'video/*', audio: 'audio/*' };
const LABEL: Record<MediaType, string> = { image: tr("عکس"), video: tr("فیلم"), audio: tr("صدا") };
const ICON: Record<MediaType, string> = { image: 'image', video: 'video', audio: 'music' };
const MAX_MEDIA = 10;

/** Editor for a content item's attachments: photos, videos, audio files and link buttons */
export function AttachmentsEditor({ value, onChange, productGallery, compact, forTemplate }: {
  value: AttachmentsValue;
  onChange: (v: AttachmentsValue) => void;
  /** the product's gallery (photos & videos); omitted in the template editor */
  productGallery?: string[];
  compact?: boolean;
  forTemplate?: boolean;
}) {
  const { toast } = useUi();
  const [uploading, setUploading] = useState<MediaType | null>(null);
  const [urlMode, setUrlMode] = useState(false);
  const [urlDraft, setUrlDraft] = useState<{ type: MediaType; url: string }>({ type: 'image', url: '' });
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<MediaType>('image');
  const set = (patch: Partial<AttachmentsValue>) => onChange({ ...value, ...patch });

  const pick = (t: MediaType) => {
    pending.current = t;
    if (input.current) {
      input.current.accept = ACCEPT[t];
      input.current.click();
    }
  };

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = MAX_MEDIA - value.media.length;
    if (room <= 0) return toast(`${tr("حداکثر")} ${fa(MAX_MEDIA)} ${tr("فایل برای هر محتوا")}`, 'danger');
    const list = Array.from(files).slice(0, room);
    const big = list.find((f) => f.size > 50 * 1024 * 1024);
    if (big) return toast(`«${big.name}» ${tr("بزرگ‌تر از ۵۰ مگابایت است (سقف ربات تلگرام)")}`, 'danger');
    const fd = new FormData();
    list.forEach((f) => fd.append('files', f));
    setUploading(pending.current);
    try {
      const items = await api.upload<MediaItem[]>('/media', fd);
      set({ media: [...value.media, ...items] });
      toast(`${fa(items.length)} ${tr("فایل اضافه شد")}`);
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setUploading(null);
    }
  };

  const addUrl = () => {
    const url = urlDraft.url.trim();
    if (!/^https?:\/\//.test(url)) return toast(tr("آدرس باید با http:// یا https:// شروع شود"), 'danger');
    set({ media: [...value.media, { type: urlDraft.type, url, name: url.split('/').pop()?.split('?')[0] || url }] });
    setUrlDraft({ ...urlDraft, url: '' });
    setUrlMode(false);
  };

  const move = (i: number, d: -1 | 1) => {
    const m = [...value.media];
    const j = i + d;
    if (j < 0 || j >= m.length) return;
    [m[i], m[j]] = [m[j], m[i]];
    set({ media: m });
  };

  return (
    <div className={`attach ${compact ? 'attach-compact' : ''}`}>
      <div className="attach-head">
        <span className="attach-title"><Icon name="paperclip" size={15} /> {forTemplate ? tr("پیوست‌های ثابت قالب") : tr("پیوست‌ها")}</span>
        <small className="muted">{fa(value.media.length)} / {fa(MAX_MEDIA)} {tr("فایل ·")} {fa(value.links.length)} {tr("لینک")}</small>
      </div>

      <div className="attach-product">
        <div className="attach-product-head">
          <strong><Icon name="box" size={15} /> {tr("رسانه محصول")}</strong>
          <small>{forTemplate ? tr("از گالری هر محصولی که با این قالب ساخته شود") : tr("عکس و فیلم‌های گالری همین محصول")}</small>
        </div>
        <div className="seg-mini" role="radiogroup" aria-label={tr("رسانه محصول")}>
          {(['none', 'main', 'all'] as ProductMediaMode[]).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={value.product_media === m}
              className={value.product_media === m ? 'active' : ''} onClick={() => set({ product_media: m })}>
              {PRODUCT_MEDIA_LABELS[m]}
            </button>
          ))}
        </div>
        {productGallery && productGallery.length > 0 && (
          <div className="gallery-pick">
            {productGallery.map((url, i) => {
              const included = value.product_media === 'all' || (value.product_media === 'main' && i === 0) || value.media.some((m) => m.url === url);
              return (
                <button key={url + i} type="button" className={`pick ${included ? 'on' : ''}`}
                  title={included ? tr("در پست هست") : tr("افزودن به پیوست‌ها")}
                  onClick={() => {
                    if (included) {
                      if (value.media.some((m) => m.url === url)) set({ media: value.media.filter((m) => m.url !== url) });
                      return;
                    }
                    if (value.media.length >= MAX_MEDIA) return toast(`${tr("حداکثر")} ${fa(MAX_MEDIA)} ${tr("فایل")}`, 'danger');
                    set({ media: [...value.media, { type: isVideoUrl(url) ? 'video' : 'image', url, name: `${tr("محصول")} ${fa(i + 1)}` }] });
                  }}>
                  {isVideoUrl(url) ? <video src={url} muted preload="metadata" /> : <img src={url} alt="" />}
                  {isVideoUrl(url) && <span className="pick-video"><Icon name="video" size={12} /></span>}
                  <span className="pick-check"><Icon name={included ? 'check' : 'plus'} size={12} strokeWidth={2.6} /></span>
                </button>
              );
            })}
          </div>
        )}
        {productGallery && productGallery.length === 0 && <small className="muted">{tr("این محصول هنوز عکس یا فیلمی در گالری ندارد.")}</small>}
      </div>

      {value.media.length > 0 && (
        <div className="attach-grid">
          {value.media.map((m, i) => (
            <div key={`${m.url}-${i}`} className={`attach-tile tile-${m.type}`}>
              {m.type === 'image' && <img src={m.url} alt={m.name || ''} />}
              {m.type === 'video' && <video src={m.url} preload="metadata" muted playsInline />}
              {m.type === 'audio' && (
                <div className="tile-audio"><Icon name="music" size={22} /><span>{m.name || tr("فایل صوتی")}</span></div>
              )}
              <span className="tile-badge"><Icon name={ICON[m.type]} size={12} />{LABEL[m.type]}{m.size ? ` · ${fileSize(m.size)}` : ''}</span>
              <div className="tile-actions">
                {i > 0 && <button type="button" title={tr("جابجایی به قبل")} onClick={() => move(i, -1)}><Icon name="chevronRight" size={13} /></button>}
                {i < value.media.length - 1 && <button type="button" title={tr("جابجایی به بعد")} onClick={() => move(i, 1)}><Icon name="chevronLeft" size={13} /></button>}
                <button type="button" title={tr("حذف")} onClick={() => set({ media: value.media.filter((_, j) => j !== i) })}><Icon name="x" size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      <input ref={input} type="file" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
      <div className="attach-actions">
        {(['image', 'video', 'audio'] as MediaType[]).map((t) => (
          <Button key={t} type="button" size="sm" variant="secondary" icon={ICON[t]} loading={uploading === t} disabled={!!uploading} onClick={() => pick(t)}>
            {LABEL[t]}
          </Button>
        ))}
        <Button type="button" size="sm" variant="ghost" icon="link" onClick={() => setUrlMode(!urlMode)}>{tr("فایل از آدرس اینترنتی")}</Button>
      </div>
      {urlMode && (
        <div className="attach-url">
          <select value={urlDraft.type} onChange={(e) => setUrlDraft({ ...urlDraft, type: e.target.value as MediaType })}>
            <option value="image">{tr("عکس")}</option><option value="video">{tr("فیلم")}</option><option value="audio">{tr("صدا")}</option>
          </select>
          <input dir="ltr" placeholder="https://example.com/video.mp4" value={urlDraft.url}
            onChange={(e) => setUrlDraft({ ...urlDraft, url: e.target.value })}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } }} />
          <Button type="button" size="sm" onClick={addUrl}>{tr("افزودن")}</Button>
        </div>
      )}

      <InteractionPicker links={value.links} onChange={(links) => set({ links })} />

      <div className="attach-links">
        <span className="attach-sub"><Icon name="link" size={14} /> {tr("دکمه‌های زیر پست")} <small className="muted">{tr("— لینک یا دکمه تعاملی که به کاربر پاسخ می‌دهد (تعاملی فقط در تلگرام)")}</small></span>
        {value.links.map((l, i) => {
          if (l.kind === 'interaction') return null;
          const upd = (patch: Partial<LinkItem>) => set({ links: value.links.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          const reply = l.kind === 'reply';
          const mode = l.mode || 'popup';
          const len = (l.reply || '').length;
          return (
            <div key={i} className={`link-row ${reply ? 'is-reply' : ''}`}>
              <span className={`link-kind ${reply ? 'reply' : ''}`} title={reply ? tr("دکمه تعاملی") : tr("دکمه لینک")}>
                <Icon name={reply ? 'zap' : 'link'} size={14} />
              </span>
              <input placeholder={reply ? tr("عنوان دکمه (مثلاً 👍 پسندیدم یا قیمت عمده؟)") : tr("عنوان دکمه (مثلاً خرید از سایت)")} value={l.title}
                onChange={(e) => upd({ title: e.target.value })} />
              {reply ? (
                <select value={mode} onChange={(e) => upd({ mode: e.target.value as 'popup' | 'chat' })} aria-label={tr("نحوه پاسخ")}>
                  <option value="popup">{tr("پاسخ در پنجره تلگرام")}</option>
                  <option value="chat">{tr("پاسخ در پیام خصوصی ربات")}</option>
                </select>
              ) : (
                <input dir="ltr" placeholder="https://..." value={l.url} onChange={(e) => upd({ url: e.target.value })} />
              )}
              <IconButton icon="x" label={tr("حذف دکمه")} onClick={() => set({ links: value.links.filter((_, j) => j !== i) })} />
              {reply && (
                <div className="reply-box">
                  <textarea rows={2} value={l.reply || ''} onChange={(e) => upd({ reply: e.target.value })}
                    placeholder={mode === 'popup' ? tr("پاسخی که با زدن دکمه در یک پنجره به کاربر نشان داده می‌شود…") : tr("پیامی که ربات در چت خصوصی برای کاربر می‌فرستد…")} />
                  <small className={mode === 'popup' && len > 200 ? 'text-danger' : 'muted'}>
                    {mode === 'popup' ? `${fa(len)} / ${fa(200)}` : tr("کاربر با زدن دکمه وارد ربات می‌شود و این پیام را دریافت می‌کند؛ بعد از آن می‌توانید از «بازخوردها» مستقیم جوابش را بدهید.")}
                  </small>
                </div>
              )}
            </div>
          );
        })}
        {value.links.length < 8 && (
          <div className="row gap-8 wrap">
            <Button type="button" size="sm" variant="ghost" icon="plus" onClick={() => set({ links: [...value.links, { title: '', url: '' }] })}>{tr("افزودن دکمه لینک")}</Button>
            <Button type="button" size="sm" variant="soft" icon="zap" onClick={() => set({ links: [...value.links, { kind: 'reply', title: '', url: '', reply: '', mode: 'popup' }] })}>{tr("افزودن دکمه تعاملی")}</Button>
          </div>
        )}
      </div>
    </div>
  );
}

let interactionsCache: Interaction[] | null = null;

/** Pick which ready-made interactions (review, order, payment, ...) appear as buttons under this post */
function InteractionPicker({ links, onChange }: { links: LinkItem[]; onChange: (links: LinkItem[]) => void }) {
  const [list, setList] = useState<Interaction[] | null>(interactionsCache);
  useEffect(() => {
    api.get<Interaction[]>('/interactions').then((r) => { interactionsCache = r; setList(r); }).catch(() => setList([]));
  }, []);
  const selected = new Set(links.filter((l) => l.kind === 'interaction').map((l) => l.interaction_id));
  const toggle = (it: Interaction) => {
    if (selected.has(it.id)) onChange(links.filter((l) => !(l.kind === 'interaction' && l.interaction_id === it.id)));
    else if (links.length < 8) onChange([...links, { kind: 'interaction', interaction_id: it.id, title: `${it.emoji} ${it.title}`.trim(), url: '' }]);
  };
  const enabled = (list || []).filter((it) => it.enabled || selected.has(it.id));
  return (
    <div className="attach-links">
      <span className="attach-sub">
        <Icon name="zap" size={14} /> {tr("کلیدهای تعاملی خودکار")}
        <small className="muted">{tr("— انتخاب کنید کدام تعامل‌ها زیر این پست باشند")}</small>
        <a className="link-sm" href={href('/interactions')} target="_blank" rel="noreferrer">{tr("مدیریت تعامل‌ها")}</a>
      </span>
      {list === null ? <small className="muted">{tr("در حال بارگذاری…")}</small> : enabled.length === 0 ? (
        <small className="muted">{tr("هنوز تعاملی تعریف نشده است.")}</small>
      ) : (
        <div className="ia-picker">
          {enabled.map((it) => {
            const on = selected.has(it.id);
            return (
              <button key={it.id} type="button" className={`ia-chip ${on ? 'on' : ''} ${it.enabled ? '' : 'off'}`} onClick={() => toggle(it)} aria-pressed={on}
                title={it.mode === 'popup' ? tr("پاسخ پنجره‌ای — فقط در تلگرام") : `${it.steps.length.toLocaleString(LOCALE)} ${tr("مرحله گفتگو با ربات")}`}>
                <span className="ia-check">{on && <Icon name="check" size={12} strokeWidth={3} />}</span>
                <span className="ia-emoji">{it.emoji || '⚡'}</span>
                <span>{it.title}</span>
                <small>{it.mode === 'popup' ? tr("پنجره") : `${it.steps.length.toLocaleString(LOCALE)} ${tr("مرحله")}`}</small>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Media + link buttons as they will appear in the post (used inside previews) */
export function MediaPreview({ media, links, max = 4 }: { media: MediaItem[]; links?: LinkItem[]; max?: number }) {
  const visual = media.filter((m) => m.type !== 'audio');
  const audio = media.filter((m) => m.type === 'audio');
  const shown = visual.slice(0, max);
  return (
    <>
      {shown.length > 0 && (
        <div className={`media-mosaic n${Math.min(shown.length, 4)}`}>
          {shown.map((m, i) => (
            <div key={i} className="mosaic-item">
              {m.type === 'image' ? <img src={m.url} alt="" /> : <video src={m.url} controls preload="metadata" playsInline />}
              {i === shown.length - 1 && visual.length > max && <span className="mosaic-more">+{fa(visual.length - max)}</span>}
            </div>
          ))}
        </div>
      )}
      {audio.map((m, i) => (
        <div key={i} className="audio-row">
          <Icon name="music" size={16} />
          <span className="ellipsis">{m.name || tr("فایل صوتی")}</span>
          <audio src={m.url} controls preload="none" />
        </div>
      ))}
      {links && links.filter((l) => l.title && (l.url || l.kind === 'reply' || l.kind === 'interaction')).length > 0 && (
        <div className="link-buttons">
          {links.filter((l) => l.title && (l.url || l.kind === 'reply' || l.kind === 'interaction')).map((l, i) =>
            l.kind === 'reply' || l.kind === 'interaction' ? (
              <span key={i} className="reply-btn" title={l.reply}><Icon name="zap" size={13} />{l.title}</span>
            ) : (
              <a key={i} href={l.url} target="_blank" rel="noreferrer"><Icon name="external" size={13} />{l.title}</a>
            ))}
        </div>
      )}
    </>
  );
}
