import { tr } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { api, fa, timeAgo } from '../api';
import Icon from '../components/Icon';
import { Badge, Button, Card, EmptyState, ErrorBox, PageHeader, ProductImage, Skeleton, Truncate, useLoad, useUi } from '../components/ui';
import { href } from '../router';

interface FeedbackRow {
  id: number;
  kind: 'click' | 'start' | 'message';
  content_id: number | null;
  button_title: string;
  tg_user_id: string | null;
  tg_username: string;
  tg_name: string;
  chat_id: string | null;
  text: string;
  auto_reply: string;
  reply: string;
  status: 'new' | 'seen' | 'replied';
  created_at: string;
  product_id: number | null;
  product_name: string | null;
  product_image: string | null;
}

interface Stats {
  total: number; clicks: number; messages: number; unread: number; users: number;
  buttons: { button_title: string; content_id: number | null; product_name: string | null; clicks: number; last_at: string }[];
}

type Filter = 'all' | 'new' | 'click' | 'message';

const KIND: Record<FeedbackRow['kind'], { label: string; icon: string; tone: 'brand' | 'info' | 'success' }> = {
  click: { label: tr("کلیک دکمه"), icon: 'zap', tone: 'brand' },
  start: { label: tr("ورود از دکمه به ربات"), icon: 'send', tone: 'info' },
  message: { label: tr("پیام به ربات"), icon: 'sms', tone: 'success' },
};

export default function Feedback() {
  const { toast } = useUi();
  const [filter, setFilter] = useState<Filter>('all');
  const qs = filter === 'new' ? '?status=new' : filter === 'click' ? '?kind=click' : filter === 'message' ? '?kind=message' : '';
  const list = useLoad(() => api.get<FeedbackRow[]>(`/feedback${qs}`), [qs]);
  const stats = useLoad(() => api.get<Stats>('/feedback/stats'));
  const [replyFor, setReplyFor] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  // live refresh every 15 s
  useEffect(() => {
    const t = setInterval(() => { list.reload(); stats.reload(); }, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);

  // mark clicks as seen once shown (messages stay "new" until answered or opened)
  useEffect(() => {
    const ids = (list.data || []).filter((f) => f.status === 'new' && f.kind !== 'message').map((f) => f.id);
    if (ids.length) api.post('/feedback/seen', { ids }).then(() => window.dispatchEvent(new Event('sss:counts'))).catch(() => undefined);
  }, [list.data]);

  const maxClicks = useMemo(() => Math.max(1, ...(stats.data?.buttons || []).map((b) => b.clicks)), [stats.data]);

  const send = async (f: FeedbackRow) => {
    setBusy(true);
    try {
      await api.post(`/feedback/${f.id}/reply`, { text: draft });
      toast(tr("پاسخ در تلگرام برای کاربر ارسال شد"));
      setReplyFor(null);
      setDraft('');
      list.reload();
      stats.reload();
      window.dispatchEvent(new Event('sss:counts'));
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const s = stats.data;
  const tiles = [
    { label: tr("کل تعامل‌ها"), value: s?.total, icon: 'trending' },
    { label: tr("کلیک روی دکمه‌ها"), value: s?.clicks, icon: 'zap' },
    { label: tr("پیام‌های دریافتی"), value: s?.messages, icon: 'sms' },
    { label: tr("کاربران یکتا"), value: s?.users, icon: 'eye' },
  ];

  return (
    <>
      <PageHeader icon="inbox" title={tr("بازخورد کاربران")}
        subtitle={tr("کلیک روی دکمه‌های تعاملی پست‌ها و پیام‌هایی که کاربران به ربات تلگرام می‌فرستند؛ از همین‌جا جواب بدهید.")}
        actions={<a className="btn btn-secondary btn-md" href={href('/automation')}><Icon name="layers" size={17} /><span>{tr("واکنش خودکار با n8n")}</span></a>} />

      <div className="fb-stats">
        {tiles.map((t) => (
          <div key={t.label} className="fb-stat">
            <span className="fb-stat-ico"><Icon name={t.icon} size={18} /></span>
            <strong>{t.value === undefined ? '—' : fa(t.value)}</strong>
            <small>{t.label}</small>
          </div>
        ))}
      </div>

      <div className="fb-layout">
        <div className="stack-16">
          <div className="segmented">
            {([['all', tr("همه")], ['new', `${tr("خوانده‌نشده")}${s?.unread ? ` (${fa(s.unread)})` : ''}`], ['click', tr("کلیک دکمه")], ['message', tr("پیام‌ها")]] as [Filter, string][]).map(([k, label]) => (
              <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </div>

          {list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : !list.data ? (
            <Card><Skeleton h={220} /></Card>
          ) : list.data.length === 0 ? (
            <Card>
              <EmptyState icon="inbox" title={tr("هنوز بازخوردی ثبت نشده")}
                text={tr("به پست‌های تلگرام «دکمه تعاملی» اضافه کنید (در ویرایش محتوا یا قالب) تا کلیک‌ها و پاسخ‌ها اینجا بیایند. پیام‌هایی که کاربران به ربات می‌فرستند هم اینجا نمایش داده می‌شود.")}
                action={<a className="btn btn-primary btn-md" href={href('/help')}><span>{tr("راهنما")}</span></a>} />
            </Card>
          ) : (
            <ul className="fb-list">
              {list.data.map((f) => {
                const k = KIND[f.kind];
                const who = f.tg_name || (f.tg_username ? `@${f.tg_username}` : tr("کاربر تلگرام"));
                const canReply = f.kind !== 'click' || !!f.chat_id;
                return (
                  <li key={f.id} className={`fb-item ${f.status === 'new' ? 'unread' : ''}`}>
                    <span className="fb-avatar">{[...who][0]}</span>
                    <div className="fb-main">
                      <div className="fb-head">
                        <strong>{who}</strong>
                        {f.tg_username && f.tg_name && <span className="muted small" dir="ltr">@{f.tg_username}</span>}
                        <Badge tone={k.tone}><Icon name={k.icon} size={12} /> {k.label}</Badge>
                        {f.status === 'replied' && <Badge tone="success">{tr("پاسخ داده شد")}</Badge>}
                        <span className="grow" />
                        <small className="muted nowrap">{timeAgo(f.created_at)}</small>
                      </div>
                      {f.kind === 'message' ? (
                        <p className="fb-text">{f.text}</p>
                      ) : (
                        <p className="fb-text">{tr("روی دکمه")} <b>«{f.button_title || '—'}»</b> {tr("زد")}</p>
                      )}
                      {f.product_name && (
                        <a className="fb-product" href={href(`/products/${f.product_id}${f.content_id ? `?content=${f.content_id}` : ''}`)}>
                          <ProductImage src={f.product_image || ''} name={f.product_name} className="thumb-24" rounded={6} />
                          <Truncate text={f.product_name} max={40} />
                        </a>
                      )}
                      {f.auto_reply && <div className="fb-bubble auto"><Icon name="zap" size={12} /> <Truncate text={f.auto_reply} max={140} /></div>}
                      {f.reply && <div className="fb-bubble"><Icon name="send" size={12} /> {f.reply}</div>}
                      {replyFor === f.id ? (
                        <div className="fb-reply">
                          <textarea rows={2} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tr("پاسخ شما برای این کاربر در تلگرام…")} />
                          <div className="row gap-8">
                            <Button size="sm" icon="send" loading={busy} disabled={!draft.trim()} onClick={() => send(f)}>{tr("ارسال پاسخ")}</Button>
                            <Button size="sm" variant="ghost" onClick={() => setReplyFor(null)}>{tr("انصراف")}</Button>
                          </div>
                        </div>
                      ) : canReply ? (
                        <button className="link-sm fb-reply-btn" onClick={() => { setReplyFor(f.id); setDraft(''); }}>
                          <Icon name="send" size={13} /> {f.reply ? tr("پاسخ دوباره") : tr("پاسخ دادن")}
                        </button>
                      ) : (
                        <small className="muted">{tr("برای پاسخ مستقیم، کاربر باید ربات را Start کند؛ از حالت «پاسخ در پیام خصوصی ربات» استفاده کنید.")}</small>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="stack-16">
          <Card title={<span className="row gap-8 align-center"><Icon name="zap" /> {tr("پرکلیک‌ترین دکمه‌ها")}</span>}>
            {!s?.buttons.length ? <p className="muted small">{tr("هنوز کلیکی ثبت نشده است.")}</p> : (
              <ul className="fb-buttons">
                {s.buttons.map((b, i) => (
                  <li key={i}>
                    <div className="row gap-8 align-center">
                      <strong className="grow"><Truncate text={b.button_title || '—'} max={28} /></strong>
                      <span className="fb-count">{fa(b.clicks)}</span>
                    </div>
                    {b.product_name && <small className="muted"><Truncate text={b.product_name} max={36} /></small>}
                    <div className="fb-bar"><i style={{ width: `${(b.clicks / maxClicks) * 100}%` }} /></div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={<span className="row gap-8 align-center"><Icon name="help" /> {tr("دکمه تعاملی چطور کار می‌کند؟")}</span>}>
            <ol className="guide-steps">
              <li><span>{fa(1)}</span>{tr("در ویرایش محتوا یا قالب تلگرام، «افزودن دکمه تعاملی» را بزنید و پاسخ را بنویسید.")}</li>
              <li><span>{fa(2)}</span>{tr("«پاسخ در پنجره»: کاربر با زدن دکمه، پاسخ را در یک پنجره کوچک می‌بیند (تا ۲۰۰ کاراکتر).")}</li>
              <li><span>{fa(3)}</span>{tr("«پاسخ در پیام خصوصی»: ربات پیام را در چت خصوصی می‌فرستد و بعد می‌توانید از همین صفحه گفتگو را ادامه دهید.")}</li>
              <li><span>{fa(4)}</span>{tr("برای واکنش خودکار (مثلاً پاسخ بر اساس کلمات)، گردش‌کار «Feedback → React» را در n8n فعال کنید.")}</li>
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
