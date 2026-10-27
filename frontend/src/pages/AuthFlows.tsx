import { tr } from '../i18n';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { authApi, User } from '../api';
import Icon from '../components/Icon';
import { Button, ErrorBox, Field } from '../components/ui';
import { navigate } from '../router';
import { AuthLayout, PasswordInput } from './Auth';

/** Opened from the e-mailed link: #/verify-email?token=... */
export function VerifyEmail({ token, onVerified }: { token: string; onVerified: () => void }) {
  const [state, setState] = useState<'busy' | 'ok' | 'error'>('busy');
  const [error, setError] = useState('');
  const done = useRef(false);

  useEffect(() => {
    // StrictMode runs effects twice; the link is single-use
    if (done.current) return;
    done.current = true;
    authApi.verifyEmail(token)
      .then(() => {
        setState('ok');
        onVerified();
      })
      .catch((e) => {
        setError(e.message);
        setState('error');
      });
  }, [token]);

  return (
    <AuthLayout title={tr("تأیید ایمیل")}>
      {state === 'busy' && <p className="muted"><span className="spinner" /> {tr("در حال تأیید…")}</p>}
      {state === 'ok' && <div className="alert alert-success"><Icon name="check" /><span>{tr("ایمیل شما تأیید شد.")}</span></div>}
      {state === 'error' && <ErrorBox error={error} />}
      {state !== 'busy' && <Button size="lg" className="full-w" onClick={() => navigate('/')}>{tr("ورود به پنل")}</Button>}
    </AuthLayout>
  );
}

/** Opened from the e-mailed link: #/reset-password?token=... */
export function ResetPassword({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError(tr("رمز عبور و تکرار آن یکسان نیستند"));
    setBusy(true);
    setError('');
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
    } catch (err: any) {
      setError(err.message);
    }
    setBusy(false);
  };

  if (done) {
    return (
      <AuthLayout title={tr("رمز عبور تغییر کرد")}>
        <div className="alert alert-success"><Icon name="check" /><span>{tr("رمز جدید ذخیره شد و همه دستگاه‌ها از حساب خارج شدند. با رمز جدید وارد شوید.")}</span></div>
        <Button size="lg" className="full-w" onClick={() => window.location.replace(window.location.pathname)}>{tr("ورود به پنل")}</Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={tr("انتخاب رمز جدید")} subtitle={tr("پس از ذخیره، از همه دستگاه‌ها خارج می‌شوید.")}>
      <form className="auth-form" onSubmit={submit}>
        <Field label={tr("رمز عبور جدید")} hint={tr("حداقل ۸ کاراکتر")}>
          <PasswordInput value={password} onChange={setPassword} autoComplete="new-password" minLength={8} autoFocus />
        </Field>
        <Field label={tr("تکرار رمز عبور")}>
          <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </Field>
        {error && <ErrorBox error={error} />}
        <Button type="submit" size="lg" icon="check" loading={busy} className="full-w">{tr("ذخیره رمز جدید")}</Button>
      </form>
    </AuthLayout>
  );
}

/** Shown after login while the account's e-mail is not confirmed yet */
export function VerifyPending({ user, onRefresh, onLogout }: { user: User; onRefresh: () => Promise<void>; onLogout: () => void }) {
  const [busy, setBusy] = useState<'' | 'resend' | 'check'>('');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const resend = async () => {
    setBusy('resend');
    setMsg(null);
    try {
      await authApi.resendVerification();
      setMsg({ tone: 'ok', text: tr("لینک تأیید دوباره ارسال شد.") });
    } catch (e: any) {
      setMsg({ tone: 'error', text: e.message });
    }
    setBusy('');
  };
  const check = async () => {
    setBusy('check');
    await onRefresh();
    setBusy('');
  };

  return (
    <AuthLayout
      title={tr("ایمیل خود را تأیید کنید")}
      subtitle={<>{tr("لینک تأیید به این آدرس ارسال شد:")} <strong dir="ltr">{user.email}</strong></>}
    >
      <p className="muted auth-note">{tr("تا ایمیل تأیید نشود، دسترسی به پنل ممکن نیست. حساب‌های تأییدنشده پس از چند روز خودکار حذف می‌شوند.")}</p>
      {msg && (msg.tone === 'ok'
        ? <div className="alert alert-success"><Icon name="check" /><span>{msg.text}</span></div>
        : <ErrorBox error={msg.text} />)}
      <div className="auth-form">
        <Button size="lg" icon="refresh" className="full-w" loading={busy === 'check'} onClick={check}>{tr("تأیید کردم، ادامه")}</Button>
        <Button variant="secondary" icon="send" className="full-w" loading={busy === 'resend'} onClick={resend}>{tr("ارسال دوباره لینک")}</Button>
      </div>
      <p className="auth-foot"><button type="button" className="link-btn" onClick={onLogout}>{tr("خروج از حساب")}</button></p>
    </AuthLayout>
  );
}
