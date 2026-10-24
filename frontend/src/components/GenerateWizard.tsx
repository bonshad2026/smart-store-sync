import { tr } from '../i18n';
import { useEffect, useState } from 'react';
import { api, Destination, fa, Kind, KIND_HINTS, KIND_LABELS, Platform, Product, Template } from '../api';
import { href } from '../router';
import Icon from './Icon';
import { Badge, Button, Modal, PlatformIcon, ProductImage, useUi } from './ui';

interface Target {
  platformId: number;
  source: string; // 'auto' | 'ai' | `t:<templateId>`
}

const KIND_ICONS: Record<Kind, string> = { intro: 'star', discount: 'tag', restock: 'box', price_change: 'trending' };

/** Step-by-step content creation: 1) message type  2) networks & content source per network */
export default function GenerateWizard({ open, product, onClose, onDone }: {
  open: boolean; product: Product; onClose: () => void; onDone: (count: number) => void;
}) {
  const { toast } = useUi();
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<Kind>('intro');
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [dests, setDests] = useState<Destination[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [ai, setAi] = useState(false);
  const [targets, setTargets] = useState<Target[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    const hasDiscount = product.discount_price && Number(product.discount_price) < Number(product.price);
    setKind(hasDiscount ? 'discount' : 'intro');
    Promise.all([
      api.get<Platform[]>('/platforms'),
      api.get<Destination[]>('/destinations'),
      api.get<Template[]>('/templates'),
      api.get<{ ai: boolean }>('/meta'),
    ])
      .then(([p, d, t, m]) => {
        const enabled = p.filter((x) => x.enabled);
        setPlatforms(enabled);
        setDests(d);
        setTemplates(t);
        setAi(m.ai);
        // preselect every network that already has an active destination
        setTargets(
          enabled
            .filter((x) => d.some((dd) => dd.platform_id === x.id && dd.enabled))
            .map((x) => ({ platformId: x.id, source: m.ai ? 'ai' : 'auto' })),
        );
      })
      .catch((e) => toast(e.message, 'danger'));
  }, [open, product, toast]);

  const destCount = (pid: number) => dests.filter((d) => d.platform_id === pid && d.enabled).length;
  const toggle = (pid: number) =>
    setTargets((t) => (t.some((x) => x.platformId === pid) ? t.filter((x) => x.platformId !== pid) : [...t, { platformId: pid, source: ai ? 'ai' : 'auto' }]));
  const setSource = (pid: number, source: string) => setTargets((t) => t.map((x) => (x.platformId === pid ? { ...x, source } : x)));

  const generate = async () => {
    setBusy(true);
    try {
      const payload = targets.map((t) => {
        if (t.source.startsWith('t:')) {
          const tpl = templates.find((x) => x.id === Number(t.source.slice(2)));
          return { platformId: t.platformId, templateId: tpl?.id, destinationId: tpl?.destination_id ?? null, mode: 'template' };
        }
        return { platformId: t.platformId, mode: t.source === 'ai' ? 'ai' : 'template' };
      });
      const r = await api.post<unknown[]>('/contents/generate', { productId: product.id, kind, targets: payload });
      toast(`${fa(r.length)} ${tr("محتوا ساخته شد و آماده بررسی است")}`);
      onDone(r.length);
    } catch (e) {
      toast((e as Error).message, 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={tr("ساخت محتوای تبلیغاتی")}
      subtitle={product.name}
      footer={
        <>
          {step === 1 ? (
            <Button variant="secondary" onClick={onClose}>{tr("انصراف")}</Button>
          ) : (
            <Button variant="secondary" icon="chevronRight" onClick={() => setStep(step - 1)}>{tr("مرحله قبل")}</Button>
          )}
          {step < 3 ? (
            <Button icon="chevronLeft" disabled={step === 2 && !targets.length} onClick={() => setStep(step + 1)}>{tr("مرحله بعد")}</Button>
          ) : (
            <Button icon="sparkles" loading={busy} disabled={!targets.length} onClick={generate}>
              {tr("ساخت")} {fa(targets.length)} {tr("محتوا")}
            </Button>
          )}
        </>
      }
    >
      <WizardProgress
        step={step}
        steps={[
          { title: tr("نوع پیام"), hint: KIND_LABELS[kind] },
          { title: tr("شبکه‌ها و نوع محتوا"), hint: targets.length ? `${fa(targets.length)} ${tr("شبکه انتخاب شد")}` : tr("انتخاب نشده") },
          { title: tr("بررسی و ساخت"), hint: tr("مرور نهایی") },
        ]}
        onJump={(n) => (n < step || (n === 3 && targets.length) || n === 2) && setStep(n)}
      />

      {step === 1 ? (
        <div className="kind-grid">
          {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
            <button key={k} className={`kind-card ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>
              <span className="kind-icon"><Icon name={KIND_ICONS[k]} size={22} /></span>
              <strong>{KIND_LABELS[k]}</strong>
              <small>{KIND_HINTS[k]}</small>
              {kind === k && <span className="kind-check"><Icon name="check" size={14} strokeWidth={3} /></span>}
            </button>
          ))}
        </div>
      ) : step === 3 ? (
        <div className="wizard-review">
          <div className="wr-product">
            <ProductImage src={product.image_url} name={product.name} className="thumb-56" rounded={12} />
            <div>
              <strong>{product.name}</strong>
              <small><Icon name={KIND_ICONS[kind]} size={14} /> {KIND_LABELS[kind]}</small>
            </div>
          </div>
          <ul className="wr-list">
            {targets.map((t) => {
              const p = platforms.find((x) => x.id === t.platformId);
              if (!p) return null;
              const tpl = t.source.startsWith('t:') ? templates.find((x) => x.id === Number(t.source.slice(2))) : undefined;
              return (
                <li key={t.platformId}>
                  <PlatformIcon icon={p.icon} color={p.color} size={32} />
                  <div className="grow">
                    <strong>{p.name}</strong>
                    <small>{t.source === 'ai' ? tr("نوشتن با هوش مصنوعی") : tpl ? tpl.name : tr("قالب پیش‌فرض")}</small>
                  </div>
                  <Badge tone={destCount(p.id) ? 'success' : 'neutral'}>{destCount(p.id) ? `${fa(destCount(p.id))} ${tr("مقصد فعال")}` : tr("بدون مقصد")}</Badge>
                </li>
              );
            })}
          </ul>
          <p className="hint-box"><Icon name="check" size={16} /> {tr("محتواها پس از ساخت در صف تأیید قرار می‌گیرند و تا تأیید شما چیزی منتشر نمی‌شود.")}</p>
        </div>
      ) : (
        <div className="target-list">
          {!ai && (
            <p className="hint-box"><Icon name="wand" size={16} /> {tr("کلید هوش مصنوعی تنظیم نشده؛ متن‌ها از روی قالب‌ها ساخته می‌شوند و می‌توانید پیش از انتشار ویرایششان کنید.")}</p>
          )}
          {platforms.map((p) => {
            const t = targets.find((x) => x.platformId === p.id);
            const count = destCount(p.id);
            const tpls = templates.filter((x) => x.platform_id === p.id && x.kind === kind);
            return (
              <div key={p.id} className={`target-row ${t ? 'active' : ''}`}>
                <label className="target-main">
                  <input type="checkbox" checked={!!t} onChange={() => toggle(p.id)} />
                  <PlatformIcon icon={p.icon} color={p.color} size={38} />
                  <div>
                    <strong>{p.name}</strong>
                    <small>{count ? `${fa(count)} ${tr("مقصد فعال")}` : tr("بدون مقصد — فقط ساخت متن")}</small>
                  </div>
                </label>
                {t && (
                  <select value={t.source} onChange={(e) => setSource(p.id, e.target.value)} aria-label={`${tr("نوع محتوا برای")} ${p.name}`}>
                    <option value="auto">{tr("قالب پیش‌فرض")} {p.name}</option>
                    <option value="ai" disabled={!ai}>{tr("نوشتن با هوش مصنوعی")}{ai ? '' : tr(" (نیاز به کلید API)")}</option>
                    {tpls.length > 0 && (
                      <optgroup label={tr("قالب‌های تعریف‌شده")}>
                        {tpls.map((x) => (
                          <option key={x.id} value={`t:${x.id}`}>
                            {x.name}{x.destination_id ? ` — ${tr("ویژه")} ${dests.find((d) => d.id === x.destination_id)?.name || tr("مقصد")}` : ''}{x.is_default ? ' ★' : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                )}
                {!count && !t && <a className="link-sm" href={href(`/channels/${p.id}`)}>{tr("تعریف مقصد")}</a>}
              </div>
            );
          })}
          {platforms.length === 0 && <Badge tone="warning">{tr("هیچ شبکه فعالی وجود ندارد — از «کانال‌های انتشار» فعال کنید")}</Badge>}
        </div>
      )}
    </Modal>
  );
}

/** Wizard header: numbered steps + "N done, M left" progress */
function WizardProgress({ step, steps, onJump }: { step: number; steps: { title: string; hint?: string }[]; onJump: (n: number) => void }) {
  const done = step - 1;
  const left = steps.length - done;
  return (
    <div className="wizard-progress">
      <div className="wp-head">
        <strong>{tr("مرحله")} {fa(step)} {tr("از")} {fa(steps.length)}</strong>
        <span className="wp-counts">
          <span className="wp-done"><Icon name="check" size={13} strokeWidth={2.6} /> {fa(done)} {tr("انجام شده")}</span>
          <span className="wp-left"><Icon name="clock" size={13} /> {fa(left)} {tr("مانده")}</span>
        </span>
      </div>
      <div className="wp-bar"><i style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      <ol className="wp-steps">
        {steps.map((s, i) => {
          const n = i + 1;
          const state = n < step ? 'done' : n === step ? 'current' : 'todo';
          return (
            <li key={n} className={`wp-step ${state}`}>
              <button type="button" onClick={() => onJump(n)}>
                <span className="wp-num">{state === 'done' ? <Icon name="check" size={14} strokeWidth={3} /> : fa(n)}</span>
                <span className="wp-text"><strong>{s.title}</strong>{s.hint && <small>{s.hint}</small>}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
