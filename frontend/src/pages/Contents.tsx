import { tr } from '../i18n';
import { useState } from 'react';
import { api, Content, fa, faDate, KIND_LABELS, Platform, productMediaItems, Publication, PUB_STATUS, stripTags, timeAgo } from '../api';
import ContentCard from '../components/ContentCard';
import Icon from '../components/Icon';
import {
  Badge, Button, Card, copyText, EmptyState, ErrorBox, PageHeader, PlatformChip, ProductImage, Skeleton, Tabs, Truncate, useLoad, useUi,
} from '../components/ui';
import { href } from '../router';

type Tab = 'pending' | 'all' | 'manual' | 'scheduled' | 'failed' | 'sent';

export default function Contents() {
  const [tab, setTab] = useState<Tab>('pending');
  const [platform, setPlatform] = useState('');
  const counts = useLoad(() => api.get<{ counts: Record<string, number> }>('/dashboard'), [tab]);
  const platforms = useLoad(() => api.get<Platform[]>('/platforms'));
  const c = counts.data?.counts || {};
  const isContentTab = tab === 'pending' || tab === 'all';

  return (
    <>
      <PageHeader
        icon="sparkles" title={tr("محتوا و انتشار")}
        subtitle={tr("محتوای ساخته‌شده برای هر شبکه را بررسی، ویرایش و منتشر کنید.")}
        actions={<a className="btn btn-secondary btn-md" href={href('/products')}><Icon name="box" size={17} /><span>{tr("ساخت محتوا از صفحه محصول")}</span></a>}
      />
      <Tabs
        value={tab}
        onChange={(v) => setTab(v)}
        items={[
          { value: 'pending', label: tr("در انتظار تأیید"), count: c.pending_contents },
          { value: 'all', label: tr("همه محتواها") },
          { value: 'manual', label: tr("آماده انتشار دستی"), count: c.manual_ready },
          { value: 'scheduled', label: tr("زمان‌بندی شده"), count: c.scheduled },
          { value: 'failed', label: tr("ناموفق"), count: c.failed_publications },
          { value: 'sent', label: tr("ارسال‌شده") },
        ]}
      />
      {isContentTab && (platforms.data?.length || 0) > 0 && (
        <div className="chips">
          <button className={`chip ${!platform ? 'active' : ''}`} onClick={() => setPlatform('')}>{tr("همه شبکه‌ها")}</button>
          {platforms.data!.filter((p) => p.enabled).map((p) => (
            <button key={p.key} className={`chip ${platform === p.key ? 'active' : ''}`} onClick={() => setPlatform(platform === p.key ? '' : p.key)}>
              <Icon name={p.icon} size={14} /> {p.name}
            </button>
          ))}
        </div>
      )}
      {isContentTab ? (
        <ContentList status={tab === 'pending' ? 'pending' : ''} platform={platform} onChanged={counts.reload} />
      ) : (
        <PublicationList status={tab} onChanged={counts.reload} />
      )}
    </>
  );
}

function ContentList({ status, platform, onChanged }: { status: string; platform: string; onChanged: () => void }) {
  const { data, error, loading, reload } = useLoad(
    () => api.get<Content[]>(`/contents?status=${status}&platform=${platform}`),
    [status, platform],
  );
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <div className="content-grid">{[1, 2, 3].map((i) => <Card key={i}><Skeleton h={220} /></Card>)}</div>;
  if (!data?.length) {
    return (
      <Card>
        <EmptyState
          icon="sparkles"
          title={status === 'pending' ? tr("محتوایی در انتظار تأیید نیست") : tr("هنوز محتوایی ساخته نشده")}
          text={tr("از صفحه هر محصول «ساخت محتوا» را بزنید؛ با تغییر قیمت یا موجودی هم محتوا خودکار ساخته می‌شود.")}
          action={<a className="btn btn-primary btn-md" href={href('/products')}>{tr("رفتن به محصولات")}</a>}
        />
      </Card>
    );
  }
  return (
    <div className="content-grid">
      {data.map((c) => <ContentCard key={c.id} c={c} onChanged={() => { reload(); onChanged(); }} />)}
    </div>
  );
}

function PublicationList({ status, onChanged }: { status: string; onChanged: () => void }) {
  const { toast, confirm } = useUi();
  const { data, error, loading, reload } = useLoad(() => api.get<Publication[]>(`/publications?status=${status}`), [status]);
  const [busy, setBusy] = useState(0);

  const act = async (id: number, fn: () => Promise<unknown>, msg: string) => {
    setBusy(id);
    try {
      await fn();
      toast(msg);
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(0);
      reload();
      onChanged();
    }
  };

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) return <Card><Skeleton h={200} /></Card>;
  if (!data?.length) {
    const texts: Record<string, string> = {
      manual: tr("محتوای شبکه‌هایی که انتشار خودکار ندارند (مثل اینستاگرام) پس از تأیید اینجا قرار می‌گیرد."),
      scheduled: tr("محتوایی برای انتشار در آینده زمان‌بندی نشده است."),
      failed: tr("همه ارسال‌ها موفق بوده‌اند."),
      sent: tr("هنوز چیزی ارسال نشده است."),
    };
    return <Card><EmptyState icon={status === 'failed' ? 'check' : 'send'} title={tr("موردی وجود ندارد")} text={texts[status]} /></Card>;
  }
  return (
    <div className="pub-rows">
      {data.map((p) => {
        const st = PUB_STATUS[p.status] || PUB_STATUS.scheduled;
        return (
          <Card key={p.id} className="pub-row">
            <a href={href(`/products/${p.product_id}`)}><ProductImage src={p.product_image} name={p.product_name} className="thumb-56" rounded={12} /></a>
            <div className="pub-row-main">
              <div className="row gap-8 wrap align-center">
                <PlatformChip name={p.platform_name} icon={p.platform_icon} color={p.platform_color} />
                <strong>{p.destination_name}</strong>
                <Badge tone={st.tone} dot>{st.label}</Badge>
                <Badge tone="brand">{KIND_LABELS[p.kind]}</Badge>
              </div>
              <div className="pub-row-product">{p.product_name}</div>
              <p className="pub-row-text"><Truncate text={stripTags(p.body)} max={160} /></p>
              <PubAttachments p={p} />
              <div className="muted small">
                {p.status === 'sent' ? `${tr("ارسال:")} ${faDate(p.sent_at)}` : p.scheduled_at ? `${tr("زمان انتشار:")} ${faDate(p.scheduled_at)}` : `${tr("ایجاد:")} ${timeAgo(p.created_at)}`}
                {p.attempts > 1 && ` · ${fa(p.attempts)} ${tr("بار تلاش")}`}
              </div>
              {p.status === 'failed' && p.message && <div className="alert alert-danger compact"><Icon name="alert" size={16} /><span><Truncate text={p.message} max={110} /></span></div>}
            </div>
            <div className="pub-row-actions">
              {p.status === 'manual' && (
                <>
                  <Button size="sm" variant="secondary" icon="copy" onClick={() => { copyText(stripTags(p.body)); toast(tr("متن کپی شد؛ آن را منتشر کنید"), 'info'); }}>{tr("کپی متن")}</Button>
                  <Button size="sm" icon="check" loading={busy === p.id} onClick={() => act(p.id, () => api.post(`/publications/${p.id}/mark-sent`), tr("به‌عنوان منتشرشده علامت خورد"))}>{tr("منتشر کردم")}</Button>
                </>
              )}
              {p.status === 'failed' && (
                <>
                  <Button size="sm" icon="refresh" loading={busy === p.id} onClick={() => act(p.id, () => api.post(`/publications/${p.id}/retry`), tr("دوباره ارسال شد"))}>{tr("تلاش مجدد")}</Button>
                  <Button size="sm" variant="ghost" icon="x" onClick={async () => { if (await confirm(tr("لغو انتشار"), tr("این مورد از صف حذف شود؟"), true)) act(p.id, () => api.del(`/publications/${p.id}`), tr("لغو شد")); }}>{tr("لغو")}</Button>
                </>
              )}
              {p.status === 'scheduled' && (
                <Button size="sm" variant="ghost" icon="x" onClick={async () => { if (await confirm(tr("لغو زمان‌بندی"), tr("انتشار زمان‌بندی‌شده لغو شود؟"), true)) act(p.id, () => api.del(`/publications/${p.id}`), tr("زمان‌بندی لغو شد")); }}>{tr("لغو")}</Button>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/** Files and link buttons of a publication — downloadable for manual posting */
function PubAttachments({ p }: { p: Publication }) {
  const files = [
    ...productMediaItems(p.product_images, p.product_media || (p.use_product_image === false ? 'none' : 'main'), p.product_image)
      .map((m, i) => ({ ...m, name: `${tr("رسانه محصول")} ${fa(i + 1)}` })),
    ...(p.media || []),
  ];
  const links = (p.links || []).filter((l) => l.title && l.url);
  if (!files.length && !links.length) return null;
  const icon = { image: 'image', video: 'video', audio: 'music' } as const;
  return (
    <div className="pub-attach">
      {files.map((m, i) => (
        <a key={i} className="file-chip" href={m.url} download target="_blank" rel="noreferrer" title={tr("دانلود")}>
          <Icon name={icon[m.type]} size={14} />
          <span className="ellipsis">{m.name || (m.type === 'image' ? tr("عکس") : m.type === 'video' ? tr("فیلم") : tr("صدا"))}</span>
          <Icon name="download" size={13} />
        </a>
      ))}
      {links.map((l, i) => (
        <a key={`l${i}`} className="file-chip link" href={l.url} target="_blank" rel="noreferrer" title={l.url}>
          <Icon name="link" size={14} /><span className="ellipsis">{l.title}</span>
        </a>
      ))}
    </div>
  );
}
