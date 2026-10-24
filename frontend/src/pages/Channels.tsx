import { tr } from '../i18n';
import { CSSProperties, FormEvent, useState } from 'react';
import { api, DELIVERY_LABELS, fa, Platform } from '../api';
import Icon from '../components/Icon';
import PlatformFields, { EMPTY_PLATFORM, PlatformDraft } from '../components/PlatformForm';
import { Badge, Button, Card, ErrorBox, Modal, PageHeader, PlatformIcon, Skeleton, Switch, Truncate, useLoad, useUi } from '../components/ui';
import { href, navigate } from '../router';

export default function Channels() {
  const { toast } = useUi();
  const { data, error, loading, reload, setData } = useLoad(() => api.get<Platform[]>('/platforms'));
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState<PlatformDraft>(EMPTY_PLATFORM);
  const [busy, setBusy] = useState(false);

  const toggle = async (p: Platform, enabled: boolean) => {
    setData((data || []).map((x) => (x.id === p.id ? { ...x, enabled } : x)));
    try {
      await api.put(`/platforms/${p.id}`, { enabled });
      toast(enabled ? `${p.name} ${tr("فعال شد")}` : `${p.name} ${tr("غیرفعال شد")}`);
    } catch (e) {
      toast((e as Error).message, 'danger');
      reload();
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const p = await api.post<Platform>('/platforms', draft);
      toast(`${tr("شبکه")} «${p.name}» ${tr("اضافه شد؛ حالا مقصدهای آن را تعریف کنید")}`);
      setCreateOpen(false);
      navigate(`/channels/${p.id}`);
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };


  return (
    <>
      <PageHeader
        icon="share" title={tr("کانال‌های انتشار")}
        subtitle={tr("مشخص کنید محتوا به کجا ارسال شود؛ برای هر شبکه چند مقصد و قالب محتوای اختصاصی تعریف کنید.")}
        actions={<Button icon="plus" onClick={() => { setDraft(EMPTY_PLATFORM); setCreateOpen(true); }}>{tr("شبکه جدید")}</Button>}
      />


      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <div className="platform-grid">{[1, 2, 3, 4, 5, 6].map((i) => <Card key={i}><Skeleton h={130} /></Card>)}</div>
      ) : (
        <div className="platform-grid">
          {data!.map((p) => (
            <div key={p.id} className={`platform-card ${p.enabled ? '' : 'disabled'}`} style={{ '--pc': p.color } as CSSProperties}>
              <a className="platform-card-link" href={href(`/channels/${p.id}`)} aria-label={p.name} />
              <div className="platform-card-head pc-inline">
                <PlatformIcon icon={p.icon} color={p.color} size={44} />
                <div className="pc-name" onClick={() => navigate(`/channels/${p.id}`)}>
                  <h3><Truncate text={p.name} max={16} /></h3>
                  <p className="muted small"><Truncate text={DELIVERY_LABELS[p.delivery]} max={30} /></p>
                </div>
                <div onClick={(e) => e.stopPropagation()} className="platform-switch">
                  <Switch checked={p.enabled} onChange={(v) => toggle(p, v)} />
                </div>
              </div>
              <div className="platform-card-stats">
                <span><Icon name="send" size={14} /> {fa(p.destinations_count || 0)} {tr("مقصد")}</span>
                <span><Icon name="file" size={14} /> {fa(p.templates_count || 0)} {tr("قالب")}</span>
                {!p.is_builtin && <Badge tone="brand">{tr("سفارشی")}</Badge>}
              </div>
              {p.enabled && !p.destinations_count && (
                <div className="platform-card-warn"><Icon name="alert" size={14} /> {tr("هنوز مقصدی تعریف نشده")}</div>
              )}
            </div>
          ))}
          <button className="platform-card add" onClick={() => { setDraft(EMPTY_PLATFORM); setCreateOpen(true); }}>
            <span className="add-icon"><Icon name="plus" size={26} /></span>
            <h3>{tr("معرفی شبکه جدید")}</h3>
            <p className="muted small">{tr("واتساپ، روبیکا، ایتا، دیوار یا هر سرویس دیگر")}</p>
          </button>
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        size="lg"
        title={tr("معرفی شبکه جدید")}
        subtitle={tr("شبکه را تعریف کنید؛ سپس مقصدها و قالب‌های محتوای آن را اضافه کنید.")}
        footer={<><Button variant="secondary" onClick={() => setCreateOpen(false)}>{tr("انصراف")}</Button><Button form="platform-create" type="submit" icon="check" loading={busy}>{tr("ایجاد شبکه")}</Button></>}
      >
        <form id="platform-create" onSubmit={create}>
          <PlatformFields value={draft} onChange={setDraft} />
        </form>
      </Modal>
    </>
  );
}
