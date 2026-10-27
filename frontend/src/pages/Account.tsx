import { tr } from '../i18n';
import { FormEvent, useEffect, useState } from 'react';
import { authApi, faDate, SessionInfo, timeAgo, User } from '../api';
import Icon from '../components/Icon';
import { Badge, Button, Card, ErrorBox, Field, LoadingGrid, PageHeader, useLoad, useUi } from '../components/ui';
import { PasswordInput } from './Auth';

/** "Chrome on Windows" from a user-agent string (good enough to recognise your own devices) */
function describeDevice(ua: string) {
  const browser =
    /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
      : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /curl\//.test(ua) ? 'curl' : '';
  const os =
    /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS'
      : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  const mobile = /Mobile|Android|iPhone/.test(ua);
  const name = browser && os ? `${browser} — ${os}` : browser || os || tr("دستگاه ناشناخته");
  return { name, icon: mobile ? 'phone' : 'monitor' };
}

export default function Account({ user, onUserChange }: { user: User; onUserChange: (u: User) => void }) {
  return (
    <>
      <PageHeader title={tr("حساب کاربری")} subtitle={tr("پروفایل، رمز عبور و دستگاه‌هایی که با آن‌ها وارد شده‌اید")} icon="key" />
      <div className="settings-grid">
        <div className="stack-20">
          <ProfileCard user={user} onUserChange={onUserChange} />
          <PasswordCard />
        </div>
        <SessionsCard />
      </div>
    </>
  );
}

function ProfileCard({ user, onUserChange }: { user: User; onUserChange: (u: User) => void }) {
  const { toast } = useUi();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const emailChanged = email.trim().toLowerCase() !== user.email.toLowerCase();

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { user: next } = await authApi.updateProfile({ name, email, current_password: emailChanged ? password : undefined });
      setPassword('');
      toast(emailChanged ? tr("ایمیل تغییر کرد؛ لینک تأیید به آدرس جدید ارسال شد") : tr("پروفایل ذخیره شد"));
      onUserChange(next);
    } catch (err: any) {
      setError(err.message);
    }
    setBusy(false);
  };

  return (
    <Card title={tr("پروفایل")} subtitle={<>{tr("عضو از")} {faDate(user.created_at)} · {user.role === 'admin' ? tr("مدیر") : tr("کاربر")}</>}>
      <form className="form-grid" onSubmit={save}>
        <Field label={tr("نام و نام خانوادگی")} full>
          <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} autoComplete="name" />
        </Field>
        <Field label={tr("ایمیل")} full hint={emailChanged ? tr("پس از تغییر، باید ایمیل جدید را تأیید کنید") : undefined}>
          <input dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </Field>
        {emailChanged && (
          <Field label={tr("رمز عبور فعلی")} full hint={tr("برای تغییر ایمیل لازم است")}>
            <PasswordInput value={password} onChange={setPassword} autoComplete="current-password" />
          </Field>
        )}
        {error && <div className="full"><ErrorBox error={error} /></div>}
        <div className="form-actions full"><span className="grow" /><Button type="submit" icon="check" loading={busy}>{tr("ذخیره")}</Button></div>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const { toast } = useUi();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return setError(tr("رمز عبور و تکرار آن یکسان نیستند"));
    setBusy(true);
    setError('');
    try {
      const { revoked } = await authApi.changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      toast(revoked ? `${tr("رمز عبور تغییر کرد و از دستگاه‌های دیگر خارج شدید")} (${revoked.toLocaleString()})` : tr("رمز عبور تغییر کرد"));
      window.dispatchEvent(new Event('sss:sessions'));
    } catch (err: any) {
      setError(err.message);
    }
    setBusy(false);
  };

  return (
    <Card title={tr("تغییر رمز عبور")} subtitle={tr("پس از تغییر رمز، همه دستگاه‌های دیگر از حساب خارج می‌شوند.")}>
      <form className="form-grid" onSubmit={save}>
        <Field label={tr("رمز عبور فعلی")} full>
          <PasswordInput value={current} onChange={setCurrent} autoComplete="current-password" />
        </Field>
        <Field label={tr("رمز عبور جدید")} hint={tr("حداقل ۸ کاراکتر")}>
          <PasswordInput value={next} onChange={setNext} autoComplete="new-password" minLength={8} />
        </Field>
        <Field label={tr("تکرار رمز عبور")}>
          <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </Field>
        {error && <div className="full"><ErrorBox error={error} /></div>}
        <div className="form-actions full"><span className="grow" /><Button type="submit" icon="key" loading={busy}>{tr("تغییر رمز عبور")}</Button></div>
      </form>
    </Card>
  );
}

function SessionsCard() {
  const { toast, confirm } = useUi();
  const { data, error, loading, reload } = useLoad(() => authApi.sessions(), []);
  const [busy, setBusy] = useState<number | 'others' | null>(null);

  // the password card signs other devices out
  useEffect(() => {
    window.addEventListener('sss:sessions', reload);
    return () => window.removeEventListener('sss:sessions', reload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const revoke = async (s: SessionInfo) => {
    if (!(await confirm(tr("خروج این دستگاه"), `${describeDevice(s.user_agent).name} — ${tr("این دستگاه بلافاصله از حساب خارج می‌شود.")}`, true))) return;
    setBusy(s.id);
    try {
      await authApi.revokeSession(s.id);
      toast(tr("دستگاه از حساب خارج شد"));
      reload();
    } catch (e: any) {
      toast(e.message, 'danger');
    }
    setBusy(null);
  };

  const revokeOthers = async () => {
    if (!(await confirm(tr("خروج از همه دستگاه‌های دیگر"), tr("همه دستگاه‌ها به جز همین دستگاه از حساب خارج می‌شوند."), true))) return;
    setBusy('others');
    try {
      const { revoked } = await authApi.revokeOtherSessions();
      toast(`${tr("از دستگاه‌های دیگر خارج شدید")} (${revoked.toLocaleString()})`);
      reload();
    } catch (e: any) {
      toast(e.message, 'danger');
    }
    setBusy(null);
  };

  const others = (data || []).filter((s) => !s.current).length;

  return (
    <Card
      title={tr("دستگاه‌های فعال")}
      subtitle={tr("هر جا که با این حساب وارد شده‌اید. دستگاهی را نمی‌شناسید؟ آن را خارج کنید و رمز عبور را تغییر دهید.")}
      actions={others > 0 && (
        <Button variant="soft" size="sm" icon="power" loading={busy === 'others'} onClick={revokeOthers}>{tr("خروج از بقیه")}</Button>
      )}
    >
      {loading && !data && <LoadingGrid n={2} />}
      {error && <ErrorBox error={error} onRetry={reload} />}
      <ul className="session-list">
        {(data || []).map((s) => {
          const d = describeDevice(s.user_agent);
          return (
            <li key={s.id}>
              <span className="session-icon"><Icon name={d.icon} size={18} /></span>
              <div className="grow">
                <strong>{d.name} {s.current && <Badge tone="success" dot>{tr("همین دستگاه")}</Badge>}</strong>
                <small>
                  {s.ip && <bdi dir="ltr">{s.ip === '::1' ? '127.0.0.1' : s.ip}</bdi>}
                  {s.ip && ' · '}
                  {tr("آخرین فعالیت")}: {s.current ? tr("اکنون") : timeAgo(s.last_used_at)}
                </small>
                <small>{tr("ورود")}: {faDate(s.created_at)}</small>
              </div>
              {!s.current && (
                <Button variant="ghost" size="sm" icon="power" loading={busy === s.id} onClick={() => revoke(s)}>{tr("خروج")}</Button>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
