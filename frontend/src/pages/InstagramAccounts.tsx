import { tr } from '../i18n';
import { ReactNode, useEffect, useState } from 'react';
import { api, authApi, fa, faDate, timeAgo, Tone } from '../api';
import Icon from '../components/Icon';
import { Badge, Button, Card, EmptyState, ErrorBox, IconButton, Modal, PlatformIcon, Skeleton, useLoad, useUi } from '../components/ui';
import { setQueryParam, useRoute } from '../router';

type Status = 'active' | 'expired' | 'disconnected';

interface Account {
  id: number;
  username: string;
  name: string;
  profile_picture_url: string;
  followers_count: number | null;
  follows_count: number | null;
  media_count: number | null;
  status: Status;
  error: string;
  connected_at: string;
  refreshed_at: string | null;
}
interface Info { configured: boolean; public_url: boolean; accounts: Account[] }
interface Post { id: number; media_id: string; format: 'image' | 'carousel' | 'reel' | 'story'; permalink: string; caption: string; created_at: string }
interface ConnectState { status: 'pending' | 'connected' | 'failed' | 'expired'; error?: string; account?: Account | null }

const STATUS: Record<Status, { label: string; tone: Tone }> = {
  active: { label: tr("فعال"), tone: 'success' },
  expired: { label: tr("نیاز به اتصال دوباره"), tone: 'warning' },
  disconnected: { label: tr("قطع شده"), tone: 'neutral' },
};

const FORMAT_LABELS: Record<Post['format'], string> = {
  image: tr("پست"),
  carousel: tr("کاروسل"),
  reel: tr("ریلز"),
  story: tr("استوری"),
};

export default function InstagramAccounts({ color, onChange }: { color: string; onChange?: () => void }) {
  const { toast, confirm } = useUi();
  const info = useLoad(() => api.get<Info>('/instagram'), []);
  const me = useLoad(() => authApi.me(), []);
  const isAdmin = me.data?.user.role === 'admin';
  const { query } = useRoute();
  const returned = Number(query.get('ig_connect') || 0);
  const [connecting, setConnecting] = useState(false);
  const [failed, setFailed] = useState('');
  const [posts, setPosts] = useState<Account | null>(null);
  const [busy, setBusy] = useState(0);

  const reload = () => {
    info.reload();
    onChange?.();
  };

  // back from Instagram: show how the connection went
  useEffect(() => {
    if (!returned) return;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 5 && !cancelled; i++) {
        try {
          const s = await api.get<ConnectState>(`/instagram/connect/${returned}`);
          if (s.status === 'connected') {
            toast(`${tr("پیج")} @${s.account?.username} ${tr("متصل شد")}`);
            reload();
            break;
          }
          if (s.status === 'failed' || s.status === 'expired') {
            setFailed(s.status === 'expired' ? tr("مهلت اتصال تمام شد؛ دوباره تلاش کنید.") : s.error || tr("اتصال انجام نشد"));
            break;
          }
        } catch (e) {
          setFailed((e as Error).message);
          break;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (!cancelled) setQueryParam('ig_connect', null, true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returned]);

  const connect = async () => {
    setConnecting(true);
    try {
      const { url } = await api.post<{ url: string }>('/instagram/connect');
      window.location.href = url;
    } catch (e) {
      toast((e as Error).message, 'danger');
      setConnecting(false);
    }
  };

  const refresh = async (a: Account) => {
    setBusy(a.id);
    try {
      await api.post(`/instagram/accounts/${a.id}/refresh`);
      info.reload();
    } catch (e) {
      toast((e as Error).message, 'danger');
      info.reload();
    } finally {
      setBusy(0);
    }
  };

  const disconnect = async (a: Account) => {
    if (!(await confirm(tr("قطع اتصال پیج"), `${tr("دیگر محتوایی در پیج")} @${a.username} ${tr("منتشر نمی‌شود. پست‌های قبلی در اینستاگرام باقی می‌مانند.")}`, true))) return;
    try {
      await api.post(`/instagram/accounts/${a.id}/disconnect`);
      toast(tr("اتصال پیج قطع شد"));
      reload();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  };

  if (info.error) return <ErrorBox error={info.error} onRetry={info.reload} />;
  if (!info.data) return <Card><Skeleton h={180} /></Card>;
  if (!info.data.configured || !info.data.public_url) {
    return <Card><EmptyState icon="instagram" title={tr("اتصال اینستاگرام هنوز فعال نشده است")} text={tr("پس از فعال شدن، می‌توانید پیج‌های خود را از همین‌جا متصل کنید.")} /></Card>;
  }

  const accounts = info.data.accounts;
  const connectButton = isAdmin && <Button icon="instagram" loading={connecting} onClick={connect}>{tr("اتصال پیج اینستاگرام")}</Button>;

  return (
    <>
      {failed && (
        <p className="alert alert-danger ig-failed">
          <Icon name="alert" size={16} /> <span className="grow">{failed}</span>
          <IconButton icon="x" label={tr("بستن")} onClick={() => setFailed('')} />
        </p>
      )}
      {accounts.length === 0 ? (
        <Card>
          <EmptyState icon="instagram" title={tr("هنوز پیجی متصل نشده است")}
            text={tr("با حساب اینستاگرام فروشگاه وارد شوید و دسترسی را تأیید کنید تا محتوا از همین پنل در پیج منتشر شود.")}
            action={connectButton || undefined} />
        </Card>
      ) : (
        <div className="tg-channels">
          {accounts.map((a) => {
            const st = STATUS[a.status];
            const off = a.status !== 'active';
            return (
              <Card key={a.id} className={`tg-channel ${a.status === 'disconnected' ? 'off' : ''}`}>
                <div className="tg-channel-head">
                  {a.profile_picture_url
                    ? <img className="ig-avatar" src={a.profile_picture_url} alt="" width={46} height={46} referrerPolicy="no-referrer" />
                    : <PlatformIcon icon="instagram" color={color} size={46} />}
                  <div className="grow min-0">
                    <div className="row gap-8 align-center wrap"><strong className="tg-channel-title">{a.name || a.username}</strong><Badge tone={st.tone} dot>{st.label}</Badge></div>
                    <a className="muted small" href={`https://instagram.com/${a.username}`} target="_blank" rel="noreferrer" dir="ltr">@{a.username}</a>
                  </div>
                  {!off && <IconButton icon="refresh" label={tr("به‌روزرسانی")} disabled={busy === a.id} onClick={() => refresh(a)} />}
                </div>
                <div className="tg-metrics">
                  <Metric icon="eye" value={fa(a.followers_count)} label={tr("دنبال‌کننده")} />
                  <Metric icon="share" value={fa(a.follows_count)} label={tr("دنبال‌شونده")} />
                  <Metric icon="image" value={fa(a.media_count)} label={tr("پست")} />
                </div>
                {a.status === 'expired' && <p className="tg-warn"><Icon name="alert" size={15} /> {a.error || tr("دسترسی به این پیج تمام شده است؛ آن را دوباره وصل کنید.")}</p>}
                <div className="tg-channel-foot">
                  <span className="muted small">{a.refreshed_at ? `${tr("به‌روزرسانی")} ${timeAgo(a.refreshed_at)}` : `${tr("متصل شده")} ${timeAgo(a.connected_at)}`}</span>
                  <div className="row gap-8">
                    <Button size="sm" variant="secondary" icon="send" onClick={() => setPosts(a)}>{tr("انتشارها")}</Button>
                    {isAdmin && (off
                      ? <Button size="sm" icon="refresh" loading={connecting} onClick={connect}>{tr("اتصال دوباره")}</Button>
                      : <Button size="sm" variant="ghost" icon="power" onClick={() => disconnect(a)}>{tr("قطع اتصال")}</Button>)}
                  </div>
                </div>
              </Card>
            );
          })}
          {isAdmin && <button className="add-row" disabled={connecting} onClick={connect}><Icon name="plus" /> {tr("اتصال پیج دیگر")}</button>}
        </div>
      )}
      <PostsModal account={posts} onClose={() => setPosts(null)} />
    </>
  );
}

function Metric({ icon, value, label }: { icon: string; value: ReactNode; label: string }) {
  return (
    <div className="tg-metric">
      <Icon name={icon} size={15} />
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}

function PostsModal({ account, onClose }: { account: Account | null; onClose: () => void }) {
  const id = account?.id;
  const { data, error, loading, reload } = useLoad(() => (id ? api.get<{ posts: Post[] }>(`/instagram/accounts/${id}`) : Promise.resolve(null)), [id]);
  return (
    <Modal open={!!account} onClose={onClose} size="lg" title={tr("انتشارهای پنل")} subtitle={account ? <bdi dir="ltr">@{account.username}</bdi> : undefined}>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading || !data ? <Skeleton h={200} /> : data.posts.length === 0 ? (
        <p className="muted small">{tr("هنوز از پنل چیزی در این پیج منتشر نشده است.")}</p>
      ) : (
        <ul className="tg-posts">
          {data.posts.map((p) => (
            <li key={p.id}>
              <div className="tg-post-text" dir="auto">{p.caption || <span className="muted">{tr("(بدون کپشن)")}</span>}</div>
              <div className="tg-post-meta">
                <Badge tone="brand">{FORMAT_LABELS[p.format] || p.format}</Badge>
                <span className="muted small">{faDate(p.created_at)}</span>
                {p.permalink && <a className="small" href={p.permalink} target="_blank" rel="noreferrer"><Icon name="external" size={13} /> {tr("مشاهده در اینستاگرام")}</a>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
