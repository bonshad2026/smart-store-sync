import { tr } from '../i18n';
import { useEffect, useState } from 'react';
import { api, authHeaders } from '../api';
import Icon from '../components/Icon';
import { Badge, Button, Card, Field, PageHeader, Skeleton, useLoad, useUi } from '../components/ui';
import { href } from '../router';

interface N8nStatus { reachable: boolean; editor_url: string; product_webhook: string }
interface WorkflowInfo { file: string; name: string; nodes: { name: string; type: string }[] }

const NODE_ICON: Record<string, string> = {
  webhook: 'link', if: 'share', code: 'file', httpRequest: 'send', scheduleTrigger: 'clock',
};

export default function Automation() {
  const { toast } = useUi();
  const status = useLoad(() => api.get<N8nStatus>('/n8n/status'));
  const flows = useLoad(() => api.get<WorkflowInfo[]>('/n8n/workflows'));
  const settings = useLoad(() => api.get<Record<string, string>>('/settings'));
  const [hook, setHook] = useState('');
  const [welcome, setWelcome] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!settings.data) return;
    setHook(settings.data.n8n_feedback_webhook || '');
    setWelcome(settings.data.bot_welcome || '');
  }, [settings.data]);

  const editor = status.data?.editor_url || 'http://localhost:5678';
  const save = async () => {
    setBusy(true);
    try {
      await api.put('/settings', { n8n_feedback_webhook: hook.trim(), bot_welcome: welcome.trim() });
      toast(tr("تنظیمات اتوماسیون ذخیره شد"));
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };
  const download = async (file: string) => {
    const res = await fetch(`/api/n8n/workflows/${file}`, { headers: authHeaders() });
    const blob = new Blob([await res.text()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <PageHeader icon="layers" title={tr("اتوماسیون (n8n)")}
        subtitle={tr("گردش‌کارهای خودکار فروشگاه را در n8n ببینید و تغییر دهید؛ مثلاً واکنش خودکار به بازخورد کاربران.")}
        actions={<a className="btn btn-primary btn-md" href={editor} target="_blank" rel="noreferrer"><Icon name="external" size={17} /><span>{tr("باز کردن ویرایشگر n8n")}</span></a>} />

      <section className="n8n-hero">
        <div className="n8n-hero-status">
          {status.loading && !status.data ? <Skeleton h={60} /> : (
            <>
              <span className={`n8n-dot ${status.data?.reachable ? 'ok' : 'off'}`} />
              <div>
                <strong>{status.data?.reachable ? tr("n8n در حال اجراست") : tr("n8n در دسترس نیست")}</strong>
                <small dir="ltr">{editor}</small>
              </div>
            </>
          )}
        </div>
        <p>
          {status.data?.reachable
            ? tr("ویرایشگر گرافیکی n8n در یک تب جدید باز می‌شود (n8n اجازه نمایش داخل صفحات دیگر را نمی‌دهد). بار اول یک حساب مدیر در خود n8n بسازید.")
            : tr("سرویس n8n همراه پروژه در Docker است؛ با update.bat یا docker compose up -d اجرا می‌شود.")}
        </p>
      </section>

      <div className="dash-grid">
        <Card title={<span className="row gap-8 align-center"><Icon name="file" /> {tr("گردش‌کارهای آماده")}</span>}
          subtitle={tr("در n8n از منوی Workflows ← Import from File این فایل‌ها را وارد و سپس فعال (Active) کنید.")}>
          {!flows.data ? <Skeleton h={160} /> : (
            <ul className="wf-list">
              {flows.data.map((w) => (
                <li key={w.file}>
                  <div className="wf-head">
                    <strong>{w.name}</strong>
                    <Button size="sm" variant="secondary" icon="download" onClick={() => download(w.file)}>{tr("دانلود")}</Button>
                  </div>
                  <div className="wf-nodes">
                    {w.nodes.map((n, i) => (
                      <span key={i} className="wf-node-wrap">
                        <span className="wf-node" title={n.type}><Icon name={NODE_ICON[n.type] || 'zap'} size={13} />{n.name}</span>
                        {i < w.nodes.length - 1 && <Icon name="chevronLeft" size={14} className="wf-arrow" />}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={<span className="row gap-8 align-center"><Icon name="inbox" /> {tr("بازخورد کاربران ← n8n")}</span>}
          subtitle={tr("هر کلیک روی دکمه تعاملی یا پیام به ربات، به این آدرس n8n فرستاده می‌شود تا هر واکنشی که بخواهید بسازید.")}>
          <div className="form-grid">
            <Field label={tr("آدرس وب‌هوک بازخورد در n8n")} full hint={tr("برای گردش‌کار آماده: http://n8n:5678/webhook/feedback — خالی = ارسال نشود")}>
              <input dir="ltr" value={hook} onChange={(e) => setHook(e.target.value)} placeholder="http://n8n:5678/webhook/feedback" />
            </Field>
            <Field label={tr("پیام خوش‌آمد ربات")} full hint={tr("وقتی کسی ربات را Start کند یا پیام بدهد، این متن فرستاده می‌شود.")}>
              <textarea rows={2} value={welcome} onChange={(e) => setWelcome(e.target.value)} />
            </Field>
            <div className="form-actions full">
              <a className="link-sm" href={href('/feedback')}><Icon name="inbox" size={14} /> {tr("رفتن به بازخوردها")}</a>
              <span className="grow" />
              <Button icon="check" loading={busy} onClick={save}>{tr("ذخیره")}</Button>
            </div>
          </div>
        </Card>
      </div>

      <Card title={<span className="row gap-8 align-center"><Icon name="key" /> {tr("ارتباط n8n با پنل")}</span>}>
        <div className="api-ref">
          <div>
            <Badge tone="info">{tr("رویداد")}</Badge>
            <code dir="ltr">POST → n8n: {'{ event: "feedback", feedback: { kind, text, button_title, tg_name, ... }, product }'}</code>
          </div>
          <div>
            <Badge tone="success">API</Badge>
            <code dir="ltr">POST {'{{ $env.SSS_API_URL }}'}/feedback/:id/reply {'{ text }'}</code>
            <small className="muted">{tr("پاسخ دادن به کاربر از داخل n8n")}</small>
          </div>
          <div>
            <Badge tone="success">API</Badge>
            <code dir="ltr">POST {'{{ $env.SSS_API_URL }}'}/contents/generate · /contents/publish-due · /operations/retry-failed</code>
            <small className="muted">{tr("ساخت محتوا، انتشار زمان‌بندی‌شده و تلاش مجدد")}</small>
          </div>
          <small className="muted">{tr("متغیر SSS_API_URL و SSS_API_KEY از قبل در کانتینر n8n تنظیم شده‌اند.")}</small>
        </div>
      </Card>
    </>
  );
}
