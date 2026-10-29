import { LANG, setLang, tr } from '../i18n';
import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { authApi, User } from '../api';
import { AppMark } from '../components/BrandLogo';
import Icon from '../components/Icon';
import { Button, ErrorBox, Field, Tabs } from '../components/ui';
import { useTheme } from '../theme';

/** Centered card used by every signed-out screen (login, verify, reset) */
export function AuthLayout({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode }) {
  const theme = useTheme();
  return (
    <div className="auth-page">
      <div className="auth-tools">
        <button className="icon-btn lang-btn" onClick={() => setLang(LANG === 'fa' ? 'en' : 'fa')} aria-label={tr("تغییر زبان")}>
          {LANG === 'fa' ? 'EN' : 'فا'}
        </button>
        <button className="icon-btn" onClick={theme.toggle} aria-label={tr("تغییر تم")}>
          <Icon name={theme.resolved === 'dark' ? 'sun' : 'moon'} />
        </button>
      </div>
      <section className="auth-card card">
        <div className="auth-brand">
          <AppMark size={48} />
          <div>
            <h1>{tr("فروشگاه‌یار")}</h1>
            <small>Smart Store Sync</small>
          </div>
        </div>
        <h2 className="auth-title">{title}</h2>
        {subtitle && <p className="muted auth-sub">{subtitle}</p>}
        {children}
      </section>
    </div>
  );
}

/** Password input with a show/hide toggle */
export function PasswordInput({ value, onChange, autoComplete, minLength, autoFocus }: {
  value: string; onChange: (v: string) => void; autoComplete: string; minLength?: number; autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="auth-pw" dir="ltr">
      <input
        type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete} required minLength={minLength} autoFocus={autoFocus}
      />
      <button type="button" className="icon-btn" onClick={() => setShow(!show)} aria-label={show ? tr("پنهان کردن رمز") : tr("نمایش رمز")}>
        <Icon name={show ? 'x' : 'eye'} size={17} />
      </button>
    </div>
  );
}

type Mode = 'login' | 'register' | 'forgot';

/** Login / sign-up / forgot-password screen shown until the user has a valid session */
export default function Auth({ onAuthed }: { onAuthed: (user: User) => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [status, setStatus] = useState<{ has_users: boolean; registration_open: boolean } | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    authApi.status().then((s) => {
      setStatus(s);
      // Fresh install: the first visitor creates the admin account
      if (!s.has_users) setMode('register');
    }).catch(() => setStatus({ has_users: true, registration_open: false }));
  }, []);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError('');
    setSent(false);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'register' && password !== confirm) return setError(tr("رمز عبور و تکرار آن یکسان نیستند"));
    setBusy(true);
    try {
      if (mode === 'forgot') {
        await authApi.forgotPassword(email);
        setSent(true);
      } else {
        const res = mode === 'login' ? await authApi.login(email, password) : await authApi.register(name, email, password);
        return onAuthed(res.user);
      }
    } catch (err: any) {
      setError(err.message);
    }
    setBusy(false);
  };

  const firstRun = status && !status.has_users;
  const canRegister = !status || status.registration_open;

  if (mode === 'forgot') {
    return (
      <AuthLayout title={tr("فراموشی رمز عبور")} subtitle={tr("ایمیل حساب خود را وارد کنید.")}>
        {sent ? (
          <div className="alert alert-success"><Icon name="mail" /><span>{tr("لینک بازیابی رمز ارسال شد. صندوق ورودی ایمیل خود را بررسی کنید.")}</span></div>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            <Field label={tr("ایمیل")}>
              <input dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
            </Field>
            {error && <ErrorBox error={error} />}
            <Button type="submit" size="lg" icon="send" loading={busy} className="full-w">{tr("ارسال لینک بازیابی")}</Button>
          </form>
        )}
        <p className="auth-foot"><button type="button" className="link-btn" onClick={() => switchMode('login')}>{tr("بازگشت به ورود")}</button></p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={firstRun ? tr("ساخت حساب مدیر") : mode === 'login' ? tr("ورود به پنل") : tr("ساخت حساب کاربری")}
      subtitle={firstRun
        ? tr("برای شروع، حساب مدیر فروشگاه را بسازید.")
        : mode === 'login' ? tr("برای مدیریت فروشگاه وارد حساب خود شوید.") : tr("اطلاعات خود را برای ساخت حساب وارد کنید.")}
    >
      {!firstRun && canRegister && (
        <Tabs<Mode> value={mode} onChange={switchMode} items={[
          { value: 'login', label: tr("ورود") },
          { value: 'register', label: tr("ثبت‌نام") },
        ]} />
      )}

      <form className="auth-form" onSubmit={submit}>
        {mode === 'register' && (
          <Field label={tr("نام و نام خانوادگی")}>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} maxLength={120} autoFocus />
          </Field>
        )}
        <Field label={tr("ایمیل")}>
          <input dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus={mode === 'login'} />
        </Field>
        <Field label={tr("رمز عبور")} hint={mode === 'register' ? tr("حداقل ۸ کاراکتر") : undefined}>
          <PasswordInput
            value={password} onChange={setPassword} minLength={mode === 'register' ? 8 : 1}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </Field>
        {mode === 'login' && (
          <button type="button" className="link-btn auth-forgot" onClick={() => switchMode('forgot')}>{tr("رمز عبور را فراموش کرده‌اید؟")}</button>
        )}
        {mode === 'register' && (
          <Field label={tr("تکرار رمز عبور")}>
            <PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" />
          </Field>
        )}

        {error && <ErrorBox error={error} />}

        <Button type="submit" size="lg" icon={mode === 'login' ? 'key' : 'check'} loading={busy} className="full-w">
          {mode === 'login' ? tr("ورود") : firstRun ? tr("ساخت حساب مدیر") : tr("ثبت‌نام")}
        </Button>
      </form>

      {!firstRun && !canRegister && (
        <p className="muted auth-foot">{tr("ثبت‌نام عمومی بسته است؛ برای دریافت حساب با مدیر فروشگاه تماس بگیرید.")}</p>
      )}
    </AuthLayout>
  );
}
