import { tr } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { api, fa, Interaction, InteractionSession, InteractionStep, StepType, timeAgo } from '../api';
import Icon from '../components/Icon';
import {
  Badge, Button, Card, EmptyState, ErrorBox, Field, IconButton, Modal, PageHeader, ProductImage, Skeleton, Switch, Truncate, useLoad, usePersistent, useUi,
} from '../components/ui';
import { href, setQueryParam, useRoute } from '../router';

const STEP_META: Record<StepType, { label: string; icon: string; hint: string }> = {
  message: { label: tr("پیام"), icon: 'sms', hint: tr("فقط یک پیام می‌فرستد و به مرحله بعد می‌رود") },
  text: { label: tr("سؤال متنی"), icon: 'edit', hint: tr("کاربر پاسخ را تایپ می‌کند") },
  choice: { label: tr("گزینه‌ای"), icon: 'list', hint: tr("کاربر یکی از دکمه‌ها را انتخاب می‌کند") },
  contact: { label: tr("شماره تماس"), icon: 'key', hint: tr("دکمه «ارسال شماره» نمایش داده می‌شود") },
  payment: { label: tr("لینک پرداخت"), icon: 'tag', hint: tr("پیام با دکمه پرداخت؛ {payment_link} از تنظیمات خوانده می‌شود") },
};
const EMOJIS = ['⭐', '🛒', '💳', '❓', '🔔', '🎁', '📞', '📦', '👍', '💬', '🏷️', '🚚'];
const EMPTY: Omit<Interaction, 'id'> = {
  title: '', emoji: '⚡', description: '', mode: 'flow', popup_text: '', steps: [{ type: 'text', text: '', key: '' }],
  final_message: tr("ممنون؛ پاسخ شما ثبت شد 🌷"), notify_admin: false, enabled: true, sort_order: 100,
};

type Tab = 'list' | 'responses' | 'settings';

export default function Interactions() {
  const { query } = useRoute();
  const tab = (query.get('tab') as Tab) || 'list';
  const list = useLoad(() => api.get<Interaction[]>('/interactions'));
  const [editing, setEditing] = useState<Interaction | 'new' | null>(null);
  const [unseen, setUnseen] = useState(0);
  useEffect(() => {
    api.get<{ sessions_unseen: number }>('/feedback/stats').then((s) => setUnseen(s.sessions_unseen)).catch(() => undefined);
  }, [tab]);

  const totals = useMemo(() => {
    const l = list.data || [];
    return {
      active: l.filter((i) => i.enabled).length,
      taps: l.reduce((a, i) => a + (i.taps || 0), 0),
      started: l.reduce((a, i) => a + (i.started || 0), 0),
      completed: l.reduce((a, i) => a + (i.completed || 0), 0),
    };
  }, [list.data]);

  return (
    <>
      <PageHeader icon="zap" title={tr("تعامل خودکار")}
        subtitle={tr("تعامل‌هایی مثل ثبت نظر، درخواست محصول یا پرداخت را یک بار تعریف کنید، روال گفتگوی ربات را بچینید و برای هر پست انتخاب کنید کدام‌ها نمایش داده شوند.")}
        actions={<Button icon="plus" onClick={() => setEditing('new')}>{tr("تعامل جدید")}</Button>} />

      <div className="fb-stats">
        {[
          { label: tr("تعامل فعال"), value: totals.active, icon: 'zap' },
          { label: tr("کلیک پاسخ پنجره‌ای"), value: totals.taps, icon: 'eye' },
          { label: tr("گفتگوی شروع‌شده"), value: totals.started, icon: 'sms' },
          { label: tr("گفتگوی تکمیل‌شده"), value: totals.completed, icon: 'check' },
        ].map((t) => (
          <div key={t.label} className="fb-stat">
            <span className="fb-stat-ico"><Icon name={t.icon} size={18} /></span>
            <strong>{list.data ? fa(t.value) : '—'}</strong>
            <small>{t.label}</small>
          </div>
        ))}
      </div>

      <div className="tabs ia-tabs">
        {([['list', tr("تعامل‌ها"), 'zap'], ['responses', tr("پاسخ‌های کاربران"), 'inbox'], ['settings', tr("تنظیمات")
          , 'settings']] as [Tab, string, string][]).map(([k, label, icon]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setQueryParam('tab', k === 'list' ? null : k, true)}>
            <Icon name={icon} size={16} /> {label}
            {k === 'responses' && unseen > 0 && <span className="nav-badge danger">{fa(unseen)}</span>}
          </button>
        ))}
      </div>

      {tab === 'list' && (
        list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : !list.data ? <Skeleton h={260} /> : (
          <div className="ia-grid">
            {list.data.map((it) => <InteractionCard key={it.id} it={it} onEdit={() => setEditing(it)} onChanged={list.reload} />)}
            <button className="ia-card add" onClick={() => setEditing('new')}>
              <span className="add-icon"><Icon name="plus" size={26} /></span>
              <strong>{tr("تعامل جدید")}</strong>
              <small className="muted">{tr("مثلاً «رزرو مشاوره»، «درخواست نمایندگی» یا «نظرسنجی»")}</small>
            </button>
          </div>
        )
      )}
      {tab === 'responses' && <Responses interactions={list.data || []} onSeen={() => setUnseen(0)} />}
      {tab === 'settings' && <InteractionSettings />}

      <InteractionEditor value={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />
    </>
  );
}

// ------------------------------------------------------------------ card

function StepChain({ it }: { it: Interaction }) {
  if (it.mode === 'popup') {
    return <div className="ia-chain"><span className="ia-step popup"><Icon name="eye" size={13} />{tr("پاسخ پنجره‌ای")}</span></div>;
  }
  return (
    <div className="ia-chain">
      {it.steps.map((s, i) => (
        <span key={i} className="ia-step-wrap">
          <span className={`ia-step t-${s.type}`} title={s.text}><Icon name={STEP_META[s.type].icon} size={13} />{s.key || STEP_META[s.type].label}</span>
          <Icon name="chevronLeft" size={13} className="ia-arrow" />
        </span>
      ))}
      <span className="ia-step end"><Icon name="check" size={13} />{tr("پایان")}</span>
    </div>
  );
}

function InteractionCard({ it, onEdit, onChanged }: { it: Interaction; onEdit: () => void; onChanged: () => void }) {
  const { toast, confirm } = useUi();
  const rate = it.started ? Math.round(((it.completed || 0) / it.started) * 100) : 0;
  const toggle = async (enabled: boolean) => {
    await api.patch(`/interactions/${it.id}/enabled`, { enabled }).catch((e) => toast(e.message, 'danger'));
    onChanged();
  };
  const remove = async () => {
    if (!(await confirm(tr("حذف تعامل"), `«${it.title}» ${tr("و همه پاسخ‌های ثبت‌شده آن حذف شود؟")}`, true))) return;
    await api.del(`/interactions/${it.id}`).catch((e) => toast(e.message, 'danger'));
    onChanged();
  };
  return (
    <div className={`ia-card ${it.enabled ? '' : 'disabled'}`}>
      <div className="ia-card-head">
        <span className="ia-emoji-lg">{it.emoji || '⚡'}</span>
        <div className="grow min-0">
          <h3><Truncate text={it.title} max={26} /></h3>
          <Badge tone={it.mode === 'popup' ? 'info' : 'brand'}>{it.mode === 'popup' ? tr("پاسخ پنجره‌ای") : `${fa(it.steps.length)} ${tr("مرحله گفتگو")}`}</Badge>
          {it.notify_admin && <Badge tone="warning"><Icon name="bell" size={11} /> {tr("اعلان به مدیر")}</Badge>}
        </div>
        <Switch checked={it.enabled} onChange={toggle} />
      </div>
      {it.description && <p className="muted small ia-desc">{it.description}</p>}
      <StepChain it={it} />
      <div className="ia-metrics">
        {it.mode === 'popup' ? (
          <span><strong>{fa(it.taps || 0)}</strong> {tr("کلیک")}</span>
        ) : (
          <>
            <span><strong>{fa(it.started || 0)}</strong> {tr("شروع")}</span>
            <span><strong>{fa(it.completed || 0)}</strong> {tr("تکمیل")}</span>
            <span className="grow ia-rate" title={tr("نرخ تکمیل")}><i style={{ width: `${rate}%` }} /><em>{fa(rate)}٪</em></span>
          </>
        )}
      </div>
      <div className="ia-actions">
        <Button size="sm" variant="secondary" icon="edit" onClick={onEdit}>{tr("ویرایش روال")}</Button>
        {it.mode === 'flow' && <a className="btn btn-ghost btn-sm" href={href(`/interactions?tab=responses&i=${it.id}`)}><Icon name="inbox" size={15} /><span>{tr("پاسخ‌ها")}</span></a>}
        <span className="grow" />
        <IconButton icon="trash" label={tr("حذف")} tone="danger" onClick={remove} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ editor

function InteractionEditor({ value, onClose, onSaved }: { value: Interaction | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useUi();
  const [f, setF] = useState<Omit<Interaction, 'id'>>(EMPTY);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (value === 'new') setF(EMPTY);
    else if (value) setF({ ...value, steps: value.steps.map((s) => ({ ...s })) });
  }, [value]);
  const set = (p: Partial<Omit<Interaction, 'id'>>) => setF((x) => ({ ...x, ...p }));
  const setStep = (i: number, p: Partial<InteractionStep>) => set({ steps: f.steps.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const move = (i: number, d: number) => {
    const s = [...f.steps];
    const [x] = s.splice(i, 1);
    s.splice(i + d, 0, x);
    set({ steps: s });
  };
  const addStep = (type: StepType) => set({
    steps: [...f.steps, {
      type, text: '', key: '',
      ...(type === 'choice' ? { options: [tr("بله"), tr("خیر")] } : {}),
      ...(type === 'payment' ? { button: tr("💳 پرداخت"), url: '{payment_link}', text: tr("مبلغ قابل پرداخت: {price}") } : {}),
    }],
  });

  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f, steps: f.mode === 'popup' ? [] : f.steps.map((s) => ({ ...s, options: (s.options || []).filter((o) => o.trim()) })) };
      if (value && value !== 'new') await api.put(`/interactions/${value.id}`, body);
      else await api.post('/interactions', body);
      toast(tr("تعامل ذخیره شد"));
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!value} onClose={onClose} size="xl" title={value === 'new' ? tr("تعامل جدید") : tr("ویرایش تعامل")}
      subtitle={tr("دکمه‌ای که زیر پست‌ها قرار می‌گیرد و روالی که پس از زدن آن اجرا می‌شود")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("انصراف")}</Button><Button icon="check" loading={busy} onClick={save}>{tr("ذخیره تعامل")}</Button></>}>
      <div className="ia-editor">
        <div className="stack-16">
          <div className="form-grid">
            <Field label={tr("عنوان دکمه")}>
              <input value={f.title} maxLength={60} onChange={(e) => set({ title: e.target.value })} placeholder={tr("مثلاً: ثبت نظر")} />
            </Field>
            <Field label={tr("آیکون")}>
              <div className="ia-emojis">
                {EMOJIS.map((e) => <button key={e} type="button" className={f.emoji === e ? 'on' : ''} onClick={() => set({ emoji: e })}>{e}</button>)}
                <input value={f.emoji} maxLength={4} onChange={(e) => set({ emoji: e.target.value })} aria-label={tr("ایموجی دلخواه")} />
              </div>
            </Field>
            <Field label={tr("توضیح کوتاه (برای خودتان)")} full>
              <input value={f.description} onChange={(e) => set({ description: e.target.value })} />
            </Field>
            <Field label={tr("نوع واکنش")} full>
              <div className="radio-cards">
                {([['flow', 'sms', tr("گفتگو با ربات"), tr("ربات در چت خصوصی مرحله‌به‌مرحله سؤال می‌پرسد و پاسخ‌ها ذخیره می‌شوند؛ در همه شبکه‌ها کار می‌کند")],
                  ['popup', 'eye', tr("پاسخ پنجره‌ای"), tr("با زدن دکمه، یک پیام کوتاه در پنجره تلگرام نمایش داده می‌شود (فقط تلگرام)")]] as const).map(([m, icon, label, hint]) => (
                  <label key={m} className={`radio-card ${f.mode === m ? 'active' : ''}`}>
                    <input type="radio" checked={f.mode === m} onChange={() => set({ mode: m })} />
                    <Icon name={icon} size={20} />
                    <span><strong>{label}</strong><small>{hint}</small></span>
                  </label>
                ))}
              </div>
            </Field>
          </div>

          {f.mode === 'popup' ? (
            <Field label={tr("متن پاسخ پنجره‌ای")} hint={`${fa(f.popup_text.length)} / ${fa(200)}`}>
              <textarea rows={3} maxLength={200} value={f.popup_text} onChange={(e) => set({ popup_text: e.target.value })} />
            </Field>
          ) : (
            <>
              <div className="ia-steps">
                <div className="row align-center gap-8">
                  <strong>{tr("روال گفتگو")}</strong>
                  <small className="muted">{tr("متغیرها: {product_name} {price} {name} {store_name} {payment_link}")}</small>
                </div>
                {f.steps.map((s, i) => (
                  <div key={i} className={`ia-step-card t-${s.type}`}>
                    <div className="ia-step-head">
                      <span className="ia-step-num">{fa(i + 1)}</span>
                      <select value={s.type} onChange={(e) => setStep(i, { type: e.target.value as StepType })}>
                        {(Object.keys(STEP_META) as StepType[]).map((t) => <option key={t} value={t}>{STEP_META[t].label}</option>)}
                      </select>
                      <small className="muted grow">{STEP_META[s.type].hint}</small>
                      <IconButton icon="chevronUp" label={tr("بالا")} disabled={i === 0} onClick={() => move(i, -1)} />
                      <IconButton icon="chevronDown" label={tr("پایین")} disabled={i === f.steps.length - 1} onClick={() => move(i, 1)} />
                      <IconButton icon="trash" label={tr("حذف مرحله")} tone="danger" onClick={() => set({ steps: f.steps.filter((_, j) => j !== i) })} />
                    </div>
                    <textarea rows={2} value={s.text} onChange={(e) => setStep(i, { text: e.target.value })}
                      placeholder={s.type === 'message' ? tr("متن پیام…") : tr("سؤالی که ربات می‌پرسد…")} />
                    {s.type !== 'message' && s.type !== 'payment' && (
                      <input value={s.key || ''} onChange={(e) => setStep(i, { key: e.target.value })} placeholder={tr("برچسب پاسخ در گزارش (مثلاً: امتیاز، آدرس)")} />
                    )}
                    {s.type === 'choice' && (
                      <div className="ia-options">
                        {(s.options || []).map((o, k) => (
                          <span key={k} className="ia-option">
                            <input value={o} onChange={(e) => setStep(i, { options: (s.options || []).map((x, j) => (j === k ? e.target.value : x)) })} />
                            <button type="button" onClick={() => setStep(i, { options: (s.options || []).filter((_, j) => j !== k) })} aria-label={tr("حذف گزینه")}><Icon name="x" size={12} /></button>
                          </span>
                        ))}
                        {(s.options || []).length < 10 && (
                          <button type="button" className="ia-option add" onClick={() => setStep(i, { options: [...(s.options || []), ''] })}><Icon name="plus" size={12} /> {tr("گزینه")}</button>
                        )}
                      </div>
                    )}
                    {s.type === 'payment' && (
                      <div className="row gap-8 wrap">
                        <input className="grow" value={s.button || ''} onChange={(e) => setStep(i, { button: e.target.value })} placeholder={tr("متن دکمه پرداخت")} />
                        <input className="grow" dir="ltr" value={s.url || ''} onChange={(e) => setStep(i, { url: e.target.value })} placeholder="{payment_link} / https://..." />
                      </div>
                    )}
                  </div>
                ))}
                <div className="ia-add-steps">
                  <small className="muted">{tr("افزودن مرحله:")}</small>
                  {(Object.keys(STEP_META) as StepType[]).map((t) => (
                    <button key={t} type="button" className="chip" onClick={() => addStep(t)} disabled={f.steps.length >= 12}>
                      <Icon name={STEP_META[t].icon} size={13} /> {STEP_META[t].label}
                    </button>
                  ))}
                </div>
              </div>
              <Field label={tr("پیام پایانی")}>
                <textarea rows={2} value={f.final_message} onChange={(e) => set({ final_message: e.target.value })} />
              </Field>
              <div className="field-switch">
                <Switch checked={f.notify_admin} onChange={(v) => set({ notify_admin: v })} label={tr("پس از تکمیل، خلاصه پاسخ‌ها برای مدیر در تلگرام ارسال شود")} />
              </div>
            </>
          )}
        </div>

        <ChatPreview f={f} />
      </div>
    </Modal>
  );
}

/** Phone-style preview of the conversation */
function ChatPreview({ f }: { f: Omit<Interaction, 'id'> }) {
  const fill = (t: string) => t
    .replace(/\{product_name\}/g, tr("یخچال ساید بای ساید"))
    .replace(/\{price\}/g, `${fa(48900000)} ${tr("تومان")}`)
    .replace(/\{name\}/g, tr("سارا"))
    .replace(/\{store_name\}/g, tr("فروشگاه من"))
    .replace(/\{payment_link\}/g, 'https://pay…');
  return (
    <div className="ia-phone" aria-label={tr("پیش‌نمایش")}>
      <div className="ia-phone-top"><Icon name="telegram" size={14} /> {tr("پیش‌نمایش گفتگو")}</div>
      <div className="ia-phone-body">
        <div className="ia-post">
          <div className="ia-post-text">{tr("🔥 تخفیف ویژه یخچال ساید بای ساید…")}</div>
          <div className="ia-post-btn">{f.emoji} {f.title || tr("عنوان دکمه")}</div>
        </div>
        {f.mode === 'popup' ? (
          <div className="ia-alert">{f.popup_text || tr("متن پاسخ پنجره‌ای")}<span>OK</span></div>
        ) : (
          <>
            <div className="bubble user">/start</div>
            {f.steps.map((s, i) => (
              <div key={i} className="ia-turn">
                <div className="bubble bot">{fill(s.text) || '…'}
                  {s.type === 'choice' && <div className="ia-kb">{(s.options || []).filter(Boolean).map((o, k) => <span key={k}>{o}</span>)}</div>}
                  {s.type === 'payment' && <div className="ia-kb"><span>{s.button || '💳'}</span></div>}
                </div>
                {s.type === 'contact' && <div className="ia-kb-reply">📱 {tr("ارسال شماره تماس")}</div>}
                {s.type !== 'message' && s.type !== 'payment' && (
                  <div className="bubble user">{s.type === 'choice' ? (s.options || [])[0] || '…' : s.type === 'contact' ? '0912…' : tr("پاسخ کاربر…")}</div>
                )}
              </div>
            ))}
            {f.final_message && <div className="bubble bot final">{fill(f.final_message)}</div>}
          </>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ responses

function Responses({ interactions, onSeen }: { interactions: Interaction[]; onSeen: () => void }) {
  const { toast } = useUi();
  const { query } = useRoute();
  const [iid, setIid] = useState(query.get('i') || '');
  const [status, setStatus] = usePersistent<string>('sss_ia_status', '');
  const qs = new URLSearchParams({ ...(iid ? { interaction_id: iid } : {}), ...(status ? { status } : {}) }).toString();
  const data = useLoad(() => api.get<InteractionSession[]>(`/interactions/sessions${qs ? `?${qs}` : ''}`), [qs]);
  const [replyFor, setReplyFor] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(data.reload, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs]);
  const [posted] = useState(() => new Set<number>());
  useEffect(() => {
    const ids = (data.data || []).filter((s) => !s.seen && s.status === 'completed' && !posted.has(s.id)).map((s) => s.id);
    if (!ids.length) return;
    ids.forEach((id) => posted.add(id));
    api.post('/interactions/sessions/seen', { ids }).then(() => { onSeen(); window.dispatchEvent(new Event('sss:counts')); }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.data]);

  const send = async (s: InteractionSession) => {
    setBusy(true);
    try {
      await api.post(`/interactions/sessions/${s.id}/reply`, { text: draft });
      toast(tr("پاسخ در تلگرام برای کاربر ارسال شد"));
      setReplyFor(null);
      data.reload();
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  const ST: Record<string, { label: string; tone: 'success' | 'warning' | 'neutral' }> = {
    completed: { label: tr("تکمیل شده"), tone: 'success' },
    active: { label: tr("در حال گفتگو"), tone: 'warning' },
    cancelled: { label: tr("لغو شده"), tone: 'neutral' },
  };

  return (
    <div className="stack-16">
      <div className="toolbar">
        <select value={iid} onChange={(e) => setIid(e.target.value)} aria-label={tr("تعامل")}>
          <option value="">{tr("همه تعامل‌ها")}</option>
          {interactions.filter((i) => i.mode === 'flow').map((i) => <option key={i.id} value={i.id}>{i.emoji} {i.title}</option>)}
        </select>
        <div className="segmented">
          {([['', tr("همه")], ['completed', tr("تکمیل شده")], ['active', tr("در حال گفتگو")], ['cancelled', tr("لغو شده")]] as [string, string][]).map(([k, l]) => (
            <button key={k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{l}</button>
          ))}
        </div>
      </div>
      {data.error ? <ErrorBox error={data.error} onRetry={data.reload} /> : !data.data ? <Skeleton h={200} /> : data.data.length === 0 ? (
        <Card><EmptyState icon="inbox" title={tr("هنوز کسی با این تعامل‌ها گفتگو نکرده")}
          text={tr("کلیدهای تعاملی را در ویرایش هر محتوا (بخش «کلیدهای تعاملی خودکار») انتخاب و پست را منتشر کنید؛ پاسخ کاربران اینجا نمایش داده می‌شود.")} /></Card>
      ) : (
        <div className="ia-sessions">
          {data.data.map((s) => {
            const who = s.tg_name || (s.tg_username ? `@${s.tg_username}` : tr("کاربر تلگرام"));
            const st = ST[s.status];
            const pct = s.total_steps ? Math.min(100, Math.round((Math.min(s.step, s.total_steps) / s.total_steps) * 100)) : 100;
            return (
              <div key={s.id} className={`ia-session ${!s.seen && s.status === 'completed' ? 'unread' : ''}`}>
                <div className="ia-session-head">
                  <span className="fb-avatar">{[...who][0]}</span>
                  <div className="grow min-0">
                    <strong>{who}</strong> {s.tg_username && s.tg_name && <span className="muted small" dir="ltr">@{s.tg_username}</span>}
                    <div className="row gap-6 wrap align-center">
                      <Badge tone="brand">{s.interaction_emoji} {s.interaction_title}</Badge>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {s.platform_name && <small className="muted">{s.platform_name}</small>}
                    </div>
                  </div>
                  <small className="muted nowrap">{timeAgo(s.updated_at)}</small>
                </div>
                {s.product_name && (
                  <a className="fb-product" href={href(`/products/${s.product_id}${s.content_id ? `?content=${s.content_id}` : ''}`)}>
                    <ProductImage src={s.product_image || ''} name={s.product_name} className="thumb-24" rounded={6} />
                    <Truncate text={s.product_name} max={40} />
                  </a>
                )}
                <div className="ia-progress" title={`${fa(Math.min(s.step, s.total_steps))} / ${fa(s.total_steps)}`}><i style={{ width: `${pct}%` }} /></div>
                {s.answers.length > 0 ? (
                  <dl className="ia-answers">
                    {s.answers.map((a, k) => (
                      <div key={k}><dt title={a.question}>{a.key || <Truncate text={a.question} max={40} />}</dt><dd>{a.answer}</dd></div>
                    ))}
                  </dl>
                ) : <small className="muted">{tr("هنوز پاسخی نداده است")}</small>}
                {s.reply && <div className="fb-bubble"><Icon name="send" size={12} /> {s.reply}</div>}
                {replyFor === s.id ? (
                  <div className="fb-reply">
                    <textarea rows={2} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tr("پاسخ شما برای این کاربر در تلگرام…")} />
                    <div className="row gap-8">
                      <Button size="sm" icon="send" loading={busy} disabled={!draft.trim()} onClick={() => send(s)}>{tr("ارسال پاسخ")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => setReplyFor(null)}>{tr("انصراف")}</Button>
                    </div>
                  </div>
                ) : (
                  <button className="link-sm fb-reply-btn" onClick={() => { setReplyFor(s.id); setDraft(''); }}><Icon name="send" size={13} /> {tr("پاسخ به کاربر")}</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ settings

function InteractionSettings() {
  const { toast } = useUi();
  const s = useLoad(() => api.get<Record<string, string>>('/settings'));
  const [v, setV] = useState({ admin_chat_id: '', payment_link: '', bot_welcome: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (s.data) setV({ admin_chat_id: s.data.admin_chat_id || '', payment_link: s.data.payment_link || '', bot_welcome: s.data.bot_welcome || '' });
  }, [s.data]);
  const save = async () => {
    setBusy(true);
    try {
      await api.put('/settings', { admin_chat_id: v.admin_chat_id.trim(), payment_link: v.payment_link.trim(), bot_welcome: v.bot_welcome.trim() });
      toast(tr("تنظیمات ذخیره شد"));
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <div className="form-grid">
        <Field label={tr("شناسه تلگرام مدیر برای اعلان‌ها")} hint={tr("شناسه عددی چت شما با ربات یا یک گروه مدیریت (ربات باید عضو باشد). سفارش‌ها و سؤال‌های تکمیل‌شده اینجا ارسال می‌شوند.")}>
          <input dir="ltr" value={v.admin_chat_id} onChange={(e) => setV({ ...v, admin_chat_id: e.target.value })} placeholder="123456789" />
        </Field>
        <Field label={tr("لینک پرداخت")} hint={tr("در مرحله «لینک پرداخت» با {payment_link} استفاده می‌شود؛ می‌توانید {amount} {sku} {session} را در لینک بگذارید.")}>
          <input dir="ltr" value={v.payment_link} onChange={(e) => setV({ ...v, payment_link: e.target.value })} placeholder="https://zarinp.al/yourshop?amount={amount}" />
        </Field>
        <Field label={tr("پیام خوش‌آمد ربات")} full>
          <textarea rows={2} value={v.bot_welcome} onChange={(e) => setV({ ...v, bot_welcome: e.target.value })} />
        </Field>
        <div className="form-actions full"><span className="grow" /><Button icon="check" loading={busy} onClick={save}>{tr("ذخیره")}</Button></div>
      </div>
    </Card>
  );
}
