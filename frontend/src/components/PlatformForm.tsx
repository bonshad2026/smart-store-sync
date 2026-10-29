import { tr } from '../i18n';
import { useEffect, useState } from 'react';
import { Delivery, DELIVERY_LABELS, Platform } from '../api';
import Icon, { PLATFORM_ICONS } from './Icon';
import { Field, PlatformIcon, Switch } from './ui';

export const COLORS = ['#229ED9', '#E1306C', '#0EA5E9', '#16A34A', '#F59E0B', '#6366F1', '#8B5CF6', '#EC4899', '#EF4444', '#14B8A6', '#0F172A', '#25D366'];

export type PlatformDraft = Pick<Platform, 'name' | 'icon' | 'color' | 'delivery' | 'max_length' | 'style_guide' | 'enabled'>;

export const EMPTY_PLATFORM: PlatformDraft = { name: '', icon: 'globe', color: '#6366F1', delivery: 'manual', max_length: null, style_guide: '', enabled: true };

/** Which delivery methods a platform may use */
export function allowedDeliveries(p?: Pick<Platform, 'key' | 'is_builtin'> | null): Delivery[] {
  if (!p || !p.is_builtin) return ['manual', 'webhook'];
  if (p.key === 'instagram') return ['instagram', 'manual', 'webhook'];
  if (p.key === 'website') return ['manual', 'webhook'];
  return [];
}

export default function PlatformFields({ value, onChange, platform }: {
  value: PlatformDraft; onChange: (v: PlatformDraft) => void; platform?: Platform | null;
}) {
  const set = <K extends keyof PlatformDraft>(k: K, v: PlatformDraft[K]) => onChange({ ...value, [k]: v });
  const deliveries = allowedDeliveries(platform);
  const [custom, setCustom] = useState(false);
  useEffect(() => setCustom(!COLORS.includes(value.color)), [value.color]);

  return (
    <div className="form-grid">
      <Field label={tr("نام شبکه")} full>
        <div className="row gap-12 align-center">
          <PlatformIcon icon={value.icon} color={value.color} size={44} />
          <input required className="grow" value={value.name} onChange={(e) => set('name', e.target.value)} placeholder={tr("مثلاً: واتساپ، روبیکا، ایتا، دیوار…")} />
        </div>
      </Field>
      <Field label={tr("آیکون")} full>
        <div className="icon-picker">
          {PLATFORM_ICONS.map((i) => (
            <button type="button" key={i} className={value.icon === i ? 'active' : ''} onClick={() => set('icon', i)} aria-label={i}>
              <Icon name={i} size={20} />
            </button>
          ))}
        </div>
      </Field>
      <Field label={tr("رنگ")} full>
        <div className="color-picker">
          {COLORS.map((c) => (
            <button type="button" key={c} style={{ background: c }} className={value.color.toLowerCase() === c.toLowerCase() ? 'active' : ''} onClick={() => set('color', c)} aria-label={c} />
          ))}
          <label className={`color-custom ${custom ? 'active' : ''}`} title={tr("رنگ دلخواه")}>
            <input type="color" value={value.color} onChange={(e) => set('color', e.target.value)} />
            <Icon name="plus" size={14} />
          </label>
        </div>
      </Field>
      {deliveries.length > 0 && (
        <Field label={tr("روش ارسال")} full>
          <div className="radio-cards">
            {deliveries.map((d) => (
              <label key={d} className={`radio-card ${value.delivery === d ? 'active' : ''}`}>
                <input type="radio" name="delivery" checked={value.delivery === d} onChange={() => set('delivery', d)} />
                <Icon name={d === 'webhook' ? 'link' : 'copy'} size={20} />
                <div>
                  <strong>{d === 'webhook' ? tr("ارسال خودکار (وب‌هوک)") : tr("انتشار دستی")}</strong>
                  <small>{d === 'webhook' ? tr("محتوا به آدرس API / n8n / پنل شما ارسال می‌شود") : tr("متن آماده می‌شود تا آن را کپی و منتشر کنید")}</small>
                </div>
              </label>
            ))}
          </div>
        </Field>
      )}
      {deliveries.length === 0 && platform && (
        <Field label={tr("روش ارسال")} full><div className="readonly-box"><Icon name="zap" size={16} /> {DELIVERY_LABELS[platform.delivery]}</div></Field>
      )}
      <Field label={tr("حداکثر طول متن")} hint={tr("برای پیامک یا شبکه‌های دارای محدودیت؛ خالی = بدون محدودیت")}>
        <input type="number" min={1} value={value.max_length ?? ''} onChange={(e) => set('max_length', e.target.value ? Number(e.target.value) : null)} placeholder={tr("مثلاً 2200")} />
      </Field>
      <Field label={tr("وضعیت")}>
        <div className="field-switch"><Switch checked={value.enabled} onChange={(v) => set('enabled', v)} label={value.enabled ? tr("فعال") : tr("غیرفعال")} /></div>
      </Field>
      <Field label={tr("سبک نوشتن برای این شبکه")} full hint={tr("راهنمای لحن و ساختار متن؛ هوش مصنوعی بر اساس آن برای این شبکه می‌نویسد.")}>
        <textarea rows={3} value={value.style_guide} onChange={(e) => set('style_guide', e.target.value)} placeholder={tr("مثلاً: کوتاه و صمیمی، حداکثر ۵ خط، با ایموجی و دعوت به خرید")} />
      </Field>
    </div>
  );
}
