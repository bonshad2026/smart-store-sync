import { tr } from '../i18n';
import { Fragment, useState } from 'react';
import { api, fa, faDate, Operation, OP_LABELS, OP_STATUS } from '../api';
import Icon from '../components/Icon';
import { Badge, Button, Card, EmptyState, ErrorBox, IconButton, PageHeader, Skeleton, Tabs, Truncate, useLoad, useUi } from '../components/ui';

export default function Operations() {
  const { toast } = useUi();
  const [filter, setFilter] = useState<'' | 'success' | 'failed'>('');
  const { data, error, loading, reload } = useLoad(() => api.get<Operation[]>(`/operations${filter ? `?status=${filter}` : ''}`), [filter]);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const retry = async (id?: number) => {
    setBusy(true);
    try {
      await api.post(id ? `/operations/${id}/retry` : '/operations/retry-failed');
      toast(id ? tr("تلاش مجدد انجام شد") : tr("تلاش مجدد برای همه عملیات ناموفق انجام شد"));
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
      reload();
    }
  };

  return (
    <>
      <PageHeader
        icon="history" title={tr("تاریخچه عملیات")}
        subtitle={tr("سابقه همه عملیات سیستم: ورود اطلاعات، تولید محتوا و انتشار.")}
        actions={<Button variant="secondary" icon="refresh" loading={busy} onClick={() => retry()}>{tr("تلاش مجدد ناموفق‌ها")}</Button>}
      />
      <Tabs value={filter} onChange={setFilter} items={[{ value: '', label: tr("همه") }, { value: 'success', label: tr("موفق") }, { value: 'failed', label: tr("ناموفق") }]} />
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading && !data ? <Card><Skeleton h={300} /></Card> : !data?.length ? (
        <Card><EmptyState icon="history" title={tr("عملیاتی ثبت نشده است")} /></Card>
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>{tr("نوع")}</th><th>{tr("وضعیت")}</th><th>{tr("نتیجه")}</th><th>{tr("تلاش")}</th><th>{tr("زمان")}</th><th /></tr></thead>
              <tbody>
                {data.map((o) => {
                  const st = OP_STATUS[o.status] || OP_STATUS.success;
                  return (
                    <Fragment key={o.id}>
                      <tr>
                        <td><div className="row gap-8 align-center"><span className="op-num">#{fa(o.id)}</span><strong>{OP_LABELS[o.type] || o.type}</strong></div></td>
                        <td><Badge tone={st.tone} dot>{st.label}</Badge></td>
                        <td className={`msg-cell ${o.status === 'failed' ? 'text-danger' : 'muted'}`}><Truncate text={o.message} max={60} /></td>
                        <td>{fa(o.attempts)}</td>
                        <td className="muted nowrap">{faDate(o.updated_at)}</td>
                        <td className="row-end nowrap">
                          {o.status === 'failed' && <Button size="sm" variant="soft" icon="refresh" onClick={() => retry(o.id)}>{tr("تلاش مجدد")}</Button>}
                          <IconButton icon={open === o.id ? 'chevronDown' : 'more'} label={tr("جزئیات")} onClick={() => setOpen(open === o.id ? null : o.id)} />
                        </td>
                      </tr>
                      {open === o.id && (
                        <tr className="detail-row"><td colSpan={6}><pre dir="ltr">{JSON.stringify(o.payload, null, 2)}</pre></td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      <p className="muted small center"><Icon name="clock" size={13} /> {tr("عملیات ناموفق هر ۱۰ دقیقه توسط n8n (در صورت فعال بودن) دوباره امتحان می‌شوند.")}</p>
    </>
  );
}
