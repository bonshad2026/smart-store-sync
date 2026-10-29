import { tr } from '../i18n';
import QRCode from 'qrcode';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { api, authApi, fa, faDate, timeAgo, Tone } from '../api';
import Icon from '../components/Icon';
import { Badge, Button, Card, EmptyState, ErrorBox, IconButton, Modal, PlatformIcon, Skeleton, useLoad, useUi } from '../components/ui';

type Status = 'active' | 'restricted' | 'removed' | 'disconnected';

interface Channel {
  id: number;
  chat_id: string;
  title: string;
  username: string;
  status: Status;
  member_count: number | null;
  destination_id: number | null;
  connected_at: string;
  refreshed_at: string | null;
  posts: number;
  reactions: number;
  clicks: number;
  joins_7d: number;
  leaves_7d: number;
  last_post_at: string | null;
}

interface Post {
  id: number; message_id: string; content_id: number | null; source: 'panel' | 'telegram'; text: string;
  reactions: Record<string, number>; reactions_total: number; clicks: number; posted_at: string;
}
interface MemberEvent { id: number; tg_name: string; tg_username: string; event: 'join' | 'leave'; created_at: string }
interface Details { channel: Channel; growth: { day: string; members: number }[]; events: MemberEvent[]; posts: Post[] }

interface StoreBot { id: number; username: string; name: string; status: 'active' | 'error'; error: string; channels: number; created_at: string }
interface BotInfo { configured: boolean; reachable?: boolean; bots: StoreBot[] }

interface ConnectLink { id: number; url: string; expires_at: string }
type LinkState = {
  status: 'pending' | 'opened' | 'connected' | 'created' | 'failed' | 'expired';
  error?: string; channel?: Channel | null; bot?: StoreBot | null;
};

const STATUS: Record<Status, { label: string; tone: Tone }> = {
  active: { label: tr("فعال"), tone: 'success' },
  restricted: { label: tr("بدون دسترسی ارسال"), tone: 'warning' },
  removed: { label: tr("ربات از کانال حذف شده"), tone: 'danger' },
  disconnected: { label: tr("قطع شده"), tone: 'neutral' },
};

const channelLink = (c: Channel) => (c.username ? `https://t.me/${c.username}` : '');

export default function TelegramChannels({ color, onChange }: { color: string; onChange?: () => void }) {
  const { toast, confirm } = useUi();
  const bot = useLoad(() => api.get<BotInfo>('/telegram/bot'), []);
  const list = useLoad(() => api.get<Channel[]>('/telegram/channels'), []);
  const me = useLoad(() => authApi.me(), []);
  const isAdmin = me.data?.user.role === 'admin';
  const [connecting, setConnecting] = useState(false);
  const [creatingBot, setCreatingBot] = useState(false);
  const [details, setDetails] = useState<number | null>(null);
  const [busy, setBusy] = useState(0);

  const reload = () => {
    list.reload();
    onChange?.();
  };

  const refresh = async (c: Channel) => {
    setBusy(c.id);
    try {
      await api.post(`/telegram/channels/${c.id}/refresh`);
      list.reload();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(0);
    }
  };

  const disconnect = async (c: Channel) => {
    if (!(await confirm(tr("قطع اتصال کانال"), `${tr("ربات از کانال")} «${c.title}» ${tr("خارج می‌شود و دیگر محتوایی در آن منتشر نمی‌شود. آمار قبلی حفظ می‌شود.")}`, true))) return;
    try {
      await api.post(`/telegram/channels/${c.id}/disconnect`);
      toast(tr("اتصال کانال قطع شد"));
      reload();
    } catch (e) {
      toast((e as Error).message, 'danger');
    }
  };

  if (bot.error || list.error) return <ErrorBox error={bot.error || list.error} onRetry={() => { bot.reload(); list.reload(); }} />;
  if (!bot.data || !list.data) return <Card><Skeleton h={180} /></Card>;
  if (!bot.data.configured) {
    return <Card><EmptyState icon="telegram" title={tr("اتصال تلگرام هنوز فعال نشده است")} text={tr("پس از فعال شدن، می‌توانید کانال‌های خود را از همین‌جا متصل کنید.")} /></Card>;
  }

  const channels = list.data;
  const storeBot = bot.data.bots.find((b) => b.status === 'active') || bot.data.bots[0];
  const createBotModal = (
    <LinkModal
      open={creatingBot}
      onClose={() => setCreatingBot(false)}
      title={tr("ساخت ربات اختصاصی فروشگاه")}
      create={() => api.post<ConnectLink>('/telegram/bots/create')}
      status={(id) => api.get<LinkState>(`/telegram/bots/create/${id}`)}
      steps={[tr("کد زیر را با گوشی اسکن کنید و در تلگرام «Start» را بزنید."), tr("دکمهٔ «ساخت ربات فروشگاه» را بزنید و ساخت ربات را تأیید کنید.")]}
      waiting={[tr("منتظر باز شدن تلگرام…"), tr("منتظر تأیید ساخت ربات…")]}
      onDone={(s) => {
        toast(`${tr("ربات")} @${s.bot?.username} ${tr("ساخته شد")}`);
        setCreatingBot(false);
        bot.reload();
      }}
    />
  );

  // step 1: the store's own bot
  if (!storeBot) {
    return (
      <>
        <Card>
          <EmptyState icon="telegram" title={tr("ربات اختصاصی فروشگاه")}
            text={tr("ابتدا ربات تلگرام فروشگاه خود را بسازید؛ این ربات در کانال‌های شما پست می‌گذارد و به مخاطبان پاسخ می‌دهد.")}
            action={isAdmin ? <Button icon="plus" onClick={() => setCreatingBot(true)}>{tr("ساخت ربات")}</Button> : undefined} />
        </Card>
        {createBotModal}
      </>
    );
  }

  const connectButton = isAdmin && storeBot.status === 'active' && <Button icon="plus" onClick={() => setConnecting(true)}>{tr("اتصال کانال")}</Button>;

  return (
    <>
      <Card className="tg-bot">
        <PlatformIcon icon="telegram" color={color} size={42} />
        <div className="grow min-0">
          <div className="row gap-8 align-center wrap">
            <strong>{storeBot.name || storeBot.username}</strong>
            <Badge tone={storeBot.status === 'active' ? 'success' : 'danger'} dot>{storeBot.status === 'active' ? tr("فعال") : tr("نیاز به بررسی")}</Badge>
          </div>
          <a className="muted small" href={`https://t.me/${storeBot.username}`} target="_blank" rel="noreferrer" dir="ltr">@{storeBot.username}</a>
        </div>
        <span className="muted small">{tr("ربات فروشگاه")}</span>
      </Card>
      {storeBot.status !== 'active' && <p className="tg-warn tg-bot-warn"><Icon name="alert" size={15} /> {tr("ربات فروشگاه در دسترس نیست. اگر توکن آن را در BotFather تغییر داده‌اید، چند لحظه صبر کنید تا دوباره متصل شود.")}</p>}
      {channels.length === 0 ? (
        <Card>
          <EmptyState icon="telegram" title={tr("هنوز کانالی متصل نشده است")}
            text={tr("کانال تلگرام خود را در چند ثانیه متصل کنید تا محتوا از همین پنل در آن منتشر شود.")} action={connectButton || undefined} />
        </Card>
      ) : (
        <div className="tg-channels">
          {channels.map((c) => {
            const st = STATUS[c.status];
            const off = c.status === 'removed' || c.status === 'disconnected';
            return (
              <Card key={c.id} className={`tg-channel ${off ? 'off' : ''}`}>
                <div className="tg-channel-head">
                  <PlatformIcon icon="telegram" color={color} size={46} />
                  <div className="grow min-0">
                    <div className="row gap-8 align-center wrap"><strong className="tg-channel-title">{c.title || c.chat_id}</strong><Badge tone={st.tone} dot>{st.label}</Badge></div>
                    {c.username
                      ? <a className="muted small" href={channelLink(c)} target="_blank" rel="noreferrer" dir="ltr">@{c.username}</a>
                      : <span className="muted small">{tr("کانال خصوصی")}</span>}
                  </div>
                  {!off && <IconButton icon="refresh" label={tr("به‌روزرسانی")} disabled={busy === c.id} onClick={() => refresh(c)} />}
                </div>
                <div className="tg-metrics">
                  <Metric icon="eye" value={fa(c.member_count)} label={tr("عضو")} />
                  <Metric icon="trending" value={<><span className="pos">+{fa(c.joins_7d)}</span> <span className="neg">−{fa(c.leaves_7d)}</span></>} label={tr("۷ روز اخیر")} />
                  <Metric icon="send" value={fa(c.posts)} label={tr("پست")} />
                  <Metric icon="star" value={fa(c.reactions)} label={tr("واکنش")} />
                  <Metric icon="zap" value={fa(c.clicks)} label={tr("کلیک دکمه")} />
                </div>
                {c.status === 'restricted' && <p className="tg-warn"><Icon name="alert" size={15} /> {tr("ربات اجازهٔ ارسال پست در این کانال را ندارد. در تنظیمات مدیران کانال، دسترسی «ارسال پیام» را برای ربات فعال کنید.")}</p>}
                {c.status === 'removed' && <p className="tg-warn"><Icon name="alert" size={15} /> {tr("ربات از این کانال حذف شده است. برای ادامهٔ انتشار، کانال را دوباره متصل کنید.")}</p>}
                <div className="tg-channel-foot">
                  <span className="muted small">{c.last_post_at ? `${tr("آخرین پست")} ${timeAgo(c.last_post_at)}` : `${tr("متصل شده")} ${timeAgo(c.connected_at)}`}</span>
                  <div className="row gap-8">
                    <Button size="sm" variant="secondary" icon="dashboard" onClick={() => setDetails(c.id)}>{tr("آمار و تعاملات")}</Button>
                    {isAdmin && (off
                      ? storeBot.status === 'active' && <Button size="sm" icon="refresh" onClick={() => setConnecting(true)}>{tr("اتصال دوباره")}</Button>
                      : <Button size="sm" variant="ghost" icon="power" onClick={() => disconnect(c)}>{tr("قطع اتصال")}</Button>)}
                  </div>
                </div>
              </Card>
            );
          })}
          {isAdmin && storeBot.status === 'active' && <button className="add-row" onClick={() => setConnecting(true)}><Icon name="plus" /> {tr("اتصال کانال دیگر")}</button>}
        </div>
      )}
      <LinkModal
        open={connecting}
        onClose={() => setConnecting(false)}
        title={tr("اتصال کانال تلگرام")}
        create={() => api.post<ConnectLink>('/telegram/connect', { bot_id: storeBot.id })}
        status={(id) => api.get<LinkState>(`/telegram/connect/${id}`)}
        steps={[tr("کد زیر را با گوشی اسکن کنید و در تلگرام «Start» را بزنید."), tr("دکمهٔ «انتخاب کانال» را بزنید، کانال خود را انتخاب و تأیید کنید.")]}
        waiting={[tr("منتظر باز شدن ربات…"), tr("منتظر انتخاب کانال…")]}
        onDone={(s) => {
          toast(`${tr("کانال")} «${s.channel?.title}» ${tr("متصل شد")}`);
          setConnecting(false);
          reload();
        }}
      />
      <DetailsModal id={details} onClose={() => setDetails(null)} />
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

// ================================================================ one-time Telegram links

/** Opens a one-time link in Telegram and follows it until the bot reports back */
function LinkModal({ open, onClose, title, create, status, steps, waiting, onDone }: {
  open: boolean; onClose: () => void; title: string;
  create: () => Promise<ConnectLink>; status: (id: number) => Promise<LinkState>;
  steps: [string, string]; waiting: [string, string]; onDone: (s: LinkState) => void;
}) {
  const [link, setLink] = useState<ConnectLink | null>(null);
  const [state, setState] = useState<LinkState | null>(null);
  const [error, setError] = useState('');
  const timer = useRef<number>();
  const done = useRef(onDone);
  done.current = onDone;

  const start = async () => {
    setError('');
    setState(null);
    setLink(null);
    try {
      setLink(await create());
      setState({ status: 'pending' });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    if (open) start();
    else {
      setLink(null);
      setState(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // follow the link while the owner is in Telegram
  useEffect(() => {
    if (!open || !link || (state && !['pending', 'opened'].includes(state.status))) return;
    timer.current = window.setTimeout(async () => {
      try {
        const s = await status(link.id);
        setState(s);
        if (s.status === 'connected' || s.status === 'created') done.current(s);
      } catch {
        setState((x) => (x ? { ...x } : x)); // try again on the next tick
      }
    }, 2000);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, link, state]);

  const st = state?.status;
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      {error ? <ErrorBox error={error} onRetry={start} /> : !link ? <Skeleton h={160} /> : (
        <div className="tg-connect">
          <ol className="tg-steps">
            <li className={st === 'pending' ? 'now' : 'done'}>{steps[0]}</li>
            <li className={st === 'opened' ? 'now' : st === 'pending' ? '' : 'done'}>{steps[1]}</li>
          </ol>
          {(st === 'pending' || st === 'opened') && (
            <>
              <QrCode text={link.url} />
              <a className="btn btn-secondary tg-open" href={link.url} target="_blank" rel="noreferrer"><Icon name="telegram" size={17} /><span>{tr("باز کردن در تلگرامِ همین دستگاه")}</span></a>
              <p className="muted small tg-wait"><span className="spinner" /> {st === 'pending' ? waiting[0] : waiting[1]}</p>
            </>
          )}
          {st === 'failed' && (
            <>
              <p className="alert alert-danger">{state?.error}</p>
              <Button icon="refresh" onClick={start}>{tr("تلاش دوباره")}</Button>
            </>
          )}
          {st === 'expired' && (
            <>
              <p className="alert alert-danger">{tr("این لینک منقضی شده است.")}</p>
              <Button icon="refresh" onClick={start}>{tr("ساخت لینک جدید")}</Button>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

/** QR code drawn in the browser, so the one-time link never leaves this page */
function QrCode({ text }: { text: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    QRCode.toDataURL(text, { width: 220, margin: 1, errorCorrectionLevel: 'M' }).then(setSrc).catch(() => setSrc(''));
  }, [text]);
  return <div className="tg-qr">{src ? <img src={src} alt={tr("کد QR لینک تلگرام")} width={220} height={220} /> : <Skeleton h={220} w={220} />}</div>;
}

// ================================================================ details

function DetailsModal({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data, error, loading, reload } = useLoad(() => (id ? api.get<Details>(`/telegram/channels/${id}`) : Promise.resolve(null)), [id]);
  const c = data?.channel;
  return (
    <Modal open={!!id} onClose={onClose} size="lg" title={c?.title || tr("آمار کانال")} subtitle={c?.username ? <bdi dir="ltr">@{c.username}</bdi> : undefined}>
      {error ? <ErrorBox error={error} onRetry={reload} /> : loading || !data ? <Skeleton h={260} /> : (
        <div className="tg-details">
          <section>
            <h4>{tr("رشد اعضا (۳۰ روز)")}</h4>
            <Growth points={data.growth} />
          </section>
          <section>
            <h4>{tr("پست‌های اخیر")}</h4>
            {data.posts.length === 0 ? <p className="muted small">{tr("هنوز پستی ثبت نشده است.")}</p> : (
              <ul className="tg-posts">
                {data.posts.map((p) => (
                  <li key={p.id}>
                    <div className="tg-post-text" dir="auto">{p.text || <span className="muted">{tr("(پست بدون متن)")}</span>}</div>
                    <div className="tg-post-meta">
                      <Badge tone={p.source === 'panel' ? 'brand' : 'neutral'}>{p.source === 'panel' ? tr("از پنل") : tr("از تلگرام")}</Badge>
                      {Object.entries(p.reactions).sort((a, b) => b[1] - a[1]).map(([e, n]) => <span key={e} className="tg-reaction">{e} {fa(n)}</span>)}
                      {p.clicks > 0 && <span className="tg-reaction"><Icon name="zap" size={13} /> {fa(p.clicks)}</span>}
                      <span className="muted small">{faDate(p.posted_at)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h4>{tr("ورود و خروج اعضا")}</h4>
            {data.events.length === 0 ? <p className="muted small">{tr("هنوز ورود یا خروجی ثبت نشده است.")}</p> : (
              <ul className="tg-events">
                {data.events.map((e) => (
                  <li key={e.id}>
                    <Badge tone={e.event === 'join' ? 'success' : 'danger'}>{e.event === 'join' ? tr("عضو شد") : tr("خارج شد")}</Badge>
                    <span dir="auto">{e.tg_name || tr("کاربر")}</span>
                    {e.tg_username && <span className="muted small" dir="ltr">@{e.tg_username}</span>}
                    <span className="muted small tg-event-time">{timeAgo(e.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}

function Growth({ points }: { points: { day: string; members: number }[] }) {
  if (points.length < 2) return <p className="muted small">{tr("نمودار پس از چند روز داده تکمیل می‌شود.")}</p>;
  const values = points.map((p) => p.members);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  return (
    <div className="tg-growth" role="img" aria-label={tr("رشد اعضا")}>
      {points.map((p) => (
        <span key={p.day} title={`${new Date(p.day).toLocaleDateString()} · ${fa(p.members)}`} style={{ height: `${18 + ((p.members - min) / span) * 82}%` }} />
      ))}
    </div>
  );
}
