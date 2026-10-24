import { LOCALE, tr } from '../i18n';
import { FormEvent, useEffect, useState } from 'react';
import { api, Product } from '../api';
import Icon from './Icon';
import { Button, Field, Modal, useUi } from './ui';

interface Props {
  open: boolean;
  product?: Product | null; // edit mode when provided
  categories?: string[];
  onClose: () => void;
  onSaved: (p: Product) => void;
}

const EMPTY = { sku: '', name: '', description: '', price: '', discount_price: '', stock: '', category: '' };
type FormState = typeof EMPTY;

export default function ProductForm({ open, product, categories = [], onClose, onSaved }: Props) {
  const { toast } = useUi();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [attrs, setAttrs] = useState<{ k: string; v: string }[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setError('');
    setFiles([]);
    if (product) {
      setForm({
        sku: product.sku,
        name: product.name,
        description: product.description || '',
        price: String(Number(product.price)),
        discount_price: product.discount_price ? String(Number(product.discount_price)) : '',
        stock: String(product.stock),
        category: product.category || '',
      });
      setAttrs(Object.entries(product.attributes || {}).map(([k, v]) => ({ k, v: String(v) })));
    } else {
      setForm(EMPTY);
      setAttrs([{ k: tr("رنگ"), v: '' }, { k: tr("سایز"), v: '' }]);
    }
  }, [open, product]);

  const f = (k: keyof FormState) => ({
    value: form[k],
    onChange: (e: { target: { value: string } }) => setForm((s) => ({ ...s, [k]: e.target.value })),
  });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = {
        ...form,
        discount_price: form.discount_price === '' ? null : form.discount_price,
        attributes: Object.fromEntries(attrs.filter((a) => a.k.trim() && a.v.trim()).map((a) => [a.k.trim(), a.v.trim()])),
      };
      const res = product
        ? await api.put<{ product: Product; changes: unknown[] }>(`/products/${product.id}`, body)
        : await api.post<{ product: Product; changes: unknown[] }>('/products', body);
      let saved = res.product;
      if (files.length) {
        const fd = new FormData();
        files.forEach((file) => fd.append('images', file));
        saved = await api.upload<Product>(`/products/${saved.id}/images`, fd);
      }
      toast(
        res.changes?.length
          ? `${tr("ذخیره شد")} — ${res.changes.length.toLocaleString(LOCALE)} ${tr("تغییر شناسایی شد و برای کانال‌ها محتوا ساخته می‌شود")}`
          : product ? tr("تغییرات ذخیره شد") : tr("محصول جدید اضافه شد"),
      );
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const price = Number(form.price || 0);
  const disc = Number(form.discount_price || 0);
  const percent = price && disc && disc < price ? Math.round(((price - disc) / price) * 100) : 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={product ? tr("ویرایش محصول") : tr("افزودن محصول جدید")}
      subtitle={product ? `${tr("کد کالا:")} ${product.sku}` : tr("اطلاعات محصول را وارد کنید؛ تغییرات بعدی قیمت و موجودی به‌صورت خودکار ردیابی می‌شود.")}
      footer={
        <>
          <Button variant="secondary" type="button" onClick={onClose}>{tr("انصراف")}</Button>
          <Button form="product-form" type="submit" loading={busy} icon="check">{product ? tr("ذخیره تغییرات") : tr("افزودن محصول")}</Button>
        </>
      }
    >
      <form id="product-form" onSubmit={save} className="form-sections">
        {error && <div className="alert alert-danger"><Icon name="alert" /><span>{error}</span></div>}
        <div className="form-section">
          <h4>{tr("اطلاعات اصلی")}</h4>
          <div className="form-grid">
            <Field label={tr("نام محصول")}><input required {...f('name')} placeholder={tr("مثلاً: تی‌شرت نخی مردانه")} /></Field>
            <Field label={tr("کد کالا (SKU)")} hint={product ? tr("کد کالا قابل تغییر نیست") : tr("شناسه یکتا؛ برای به‌روزرسانی از CSV استفاده می‌شود")}>
              <input required disabled={!!product} dir="ltr" {...f('sku')} placeholder="TSH-001" />
            </Field>
            <Field label={tr("دسته‌بندی")}>
              <input list="category-list" {...f('category')} placeholder={tr("مثلاً: پوشاک مردانه")} />
              <datalist id="category-list">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label={tr("موجودی")}><input required type="number" min={0} step={1} {...f('stock')} placeholder={tr("۰")} /></Field>
            <Field label={tr("توضیحات")} full><textarea rows={3} {...f('description')} placeholder={tr("توضیح کوتاه درباره جنس، کاربرد و مزیت‌های محصول")} /></Field>
          </div>
        </div>

        <div className="form-section">
          <h4>{tr("قیمت‌گذاری")}</h4>
          <div className="form-grid">
            <Field label={tr("قیمت (تومان)")}><input required type="number" min={0} {...f('price')} placeholder="500000" /></Field>
            <Field label={tr("قیمت با تخفیف (اختیاری)")} hint={percent ? `${percent.toLocaleString(LOCALE)}${tr("٪ تخفیف")}` : tr("خالی بگذارید اگر تخفیف ندارد")}>
              <input type="number" min={0} {...f('discount_price')} placeholder="450000" />
            </Field>
          </div>
        </div>

        <div className="form-section">
          <h4>{tr("ویژگی‌ها")} <small className="muted">{tr("— در متن‌های تبلیغاتی استفاده می‌شوند")}</small></h4>
          <div className="attr-list">
            {attrs.map((a, i) => (
              <div key={i} className="attr-row">
                <input placeholder={tr("عنوان (مثلاً رنگ)")} value={a.k} onChange={(e) => setAttrs((s) => s.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} />
                <input placeholder={tr("مقدار (مثلاً سفید)")} value={a.v} onChange={(e) => setAttrs((s) => s.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
                <button type="button" className="icon-btn" onClick={() => setAttrs((s) => s.filter((_, j) => j !== i))} aria-label={tr("حذف ویژگی")}><Icon name="x" size={16} /></button>
              </div>
            ))}
            <Button type="button" variant="ghost" size="sm" icon="plus" onClick={() => setAttrs((s) => [...s, { k: '', v: '' }])}>{tr("افزودن ویژگی")}</Button>
          </div>
        </div>

        {!product && (
          <div className="form-section">
            <h4>{tr("عکس و فیلم محصول")}</h4>
            <label className="dropzone">
              <input type="file" accept="image/*,video/*" multiple hidden onChange={(e) => setFiles([...files, ...Array.from(e.target.files || [])])} />
              <Icon name="upload" size={24} />
              <span>{tr("برای انتخاب عکس و فیلم کلیک کنید")}</span>
              <small>{tr("عکس (JPG، PNG، WEBP) یا فیلم (MP4) — حداکثر ۵۰ مگابایت؛ اولین مورد، رسانه اصلی است")}</small>
            </label>
            {files.length > 0 && (
              <div className="thumb-row">
                {files.map((file, i) => (
                  <div key={i} className="thumb">
                    {file.type.startsWith('video/') ? <video src={URL.createObjectURL(file)} muted /> : <img src={URL.createObjectURL(file)} alt="" />}
                    <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={tr("حذف")}><Icon name="x" size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}
