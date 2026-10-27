import { LANG, setLang, tr } from '../i18n';
import { FormEvent, useEffect, useState } from 'react';
import { authApi, setToken, User } from '../api';
import { AppMark } from '../components/BrandLogo';
import Icon from '../components/Icon';
import { Button, ErrorBox, Field, Tabs } from '../components/ui';
import { useTheme } from '../theme';

type Mode = 'login' | 'register';

/** Login / sign-up screen shown until the user has a valid session */
export default function Auth({ onAuthed }: { onAuthed: (user: User) => void }) {
  const theme = useTheme();
  const [mode, setMode] = useState<Mode>('login');
  const [status, setStatus] = useState<{ has_users: boolean; registration_open: boolean } | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'register' && password !== confirm) return setError(tr("رمز عبور و تکرار آن یکسان نیستند"));
    setBusy(true);
    try {
      const res = mode === 'login' ? await authApi.login(email, password) : await authApi.register(name, email, password);
      setToken(res.token);
      onAuthed(res.user);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  const firstRun = status && !status.has_users;
  const canRegister = !status || status.registration_open;

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

        <h2 className="auth-title">
          {firstRun ? tr("ساخت حساب مدیر") : mode === 'login' ? tr("ورود به پنل") : tr("ساخت حساب کاربری")}
        </h2>
        <p className="muted auth-sub">
          {firstRun
            ? tr("هنوز هیچ کاربری ثبت نشده است. اولین حساب، مدیر فروشگاه خواهد بود.")
            : mode === 'login' ? tr("برای مدیریت فروشگاه وارد حساب خود شوید.") : tr("اطلاعات خود را برای ساخت حساب وارد کنید.")}
        </p>

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
            <div className="auth-pw" dir="ltr">
              <input
                type={showPw ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'register' ? 8 : 1}
              />
              <button type="button" className="icon-btn" onClick={() => setShowPw(!showPw)} aria-label={showPw ? tr("پنهان کردن رمز") : tr("نمایش رمز")}>
                <Icon name={showPw ? 'x' : 'eye'} size={17} />
              </button>
            </div>
          </Field>
          {mode === 'register' && (
            <Field label={tr("تکرار رمز عبور")}>
              <input dir="ltr" type={showPw ? 'text' : 'password'} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
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
      </section>
    </div>
  );
}
