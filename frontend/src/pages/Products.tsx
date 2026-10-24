import { tr } from '../i18n';
import { useEffect, useMemo, useState } from 'react';
import { api, discountPercent, fa, finalPrice, Product, timeAgo, toman } from '../api';
import Icon from '../components/Icon';
import ProductForm from '../components/ProductForm';
import {
  Badge, Button, Card, EmptyState, ErrorBox, LoadingGrid, PageHeader, ProductImage, useLoad, usePersistent, useUi,
} from '../components/ui';
import { href, navigate, useRoute } from '../router';

interface ImportResult {
  total: number; created: number; updated: number; unchanged: number; changes: number;
  errors: { row: number; sku?: string; error: string }[];
}

type StockFilter = 'all' | 'in' | 'out' | 'sale';

export default function Products() {
  const { toast } = useUi();
  const { query } = useRoute();
  const q = query.get('q') || '';
  const [search, setSearch] = useState(q);
  useEffect(() => setSearch(q), [q]);
  const [category, setCategory] = useState('');
  const [stock, setStock] = useState<StockFilter>('all');
  const [view, setView] = usePersistent<'grid' | 'list'>('sss_products_view', 'grid');
  const [formOpen, setFormOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const { data, error, loading, reload } = useLoad(() => api.get<Product[]>(`/products?search=${encodeURIComponent(search)}`), [search]);
  const cats = useLoad(() => api.get<{ category: string; count: number }[]>('/categories'));

  const products = useMemo(
    () =>
      (data || []).filter((p) => {
        if (category && p.category !== category) return false;
        if (stock === 'in') return p.stock > 0;
        if (stock === 'out') return p.stock === 0;
        if (stock === 'sale') return discountPercent(p) > 0;
        return true;
      }),
    [data, category, stock],
  );

  const importFile = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    setImporting(true);
    try {
      const r = await api.upload<ImportResult>('/products/import', fd);
      toast(`${fa(r.total)} ${tr("ردیف خوانده شد:")} ${fa(r.created)} ${tr("جدید،")} ${fa(r.updated)} ${tr("به‌روزرسانی،")} ${fa(r.unchanged)} ${tr("بدون تغییر")}`);
      if (r.errors.length) toast(`${tr("خطا در")} ${fa(r.errors.length)} ${tr("ردیف:")} ${r.errors.slice(0, 3).map((e) => `${tr("ردیف")} ${fa(e.row)}: ${e.error}`).join(' | ')}`, 'danger');
      reload();
      cats.reload();
    } catch (err) {
      toast((err as Error).message, 'danger');
    } finally {
      setImporting(false);
    }
  };

  const total = data?.length || 0;
  const outCount = (data || []).filter((p) => p.stock === 0).length;
  const saleCount = (data || []).filter((p) => discountPercent(p) > 0).length;

  return (
    <>
      <PageHeader
        icon="box" title={tr("محصولات")}
        subtitle={`${fa(total)} ${tr("محصول در کاتالوگ مرکزی")}`}
        actions={
          <>
            <label title={tr("فایل اکسل را با فرمت CSV ذخیره و انتخاب کنید")} className={`btn btn-secondary btn-md ${importing ? 'is-loading' : ''}`}>
              {importing ? <span className="spinner" /> : <span className="excel-ico"><Icon name="excel" size={17} /></span>}
              <span>{tr("ورود از اکسل (CSV)")}</span>
              <input type="file" accept=".csv,text/csv" hidden disabled={importing}
                onChange={(e) => { const file = e.target.files?.[0]; if (file) importFile(file); e.target.value = ''; }} />
            </label>
            <Button icon="plus" onClick={() => setFormOpen(true)}>{tr("محصول جدید")}</Button>
          </>
        }
      />

      <div className="toolbar">
        <div className="search-box">
          <Icon name="search" size={18} />
          <input placeholder={tr("جستجو در نام، کد کالا یا دسته‌بندی…")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="segmented">
          {([['all', tr("همه"), total], ['in', tr("موجود"), total - outCount], ['out', tr("ناموجود"), outCount], ['sale', tr("تخفیف‌دار"), saleCount]] as const).map(([k, label, n]) => (
            <button key={k} className={stock === k ? 'active' : ''} onClick={() => setStock(k)}>
              {label} <span className="muted-num">{fa(n)}</span>
            </button>
          ))}
        </div>
        <div className="view-toggle" role="group" aria-label={tr("نحوه نمایش")}>
          <button className={view === 'grid' ? 'active' : ''} onClick={() => setView('grid')} title={tr("نمایش کارتی")}><Icon name="grid" size={17} /></button>
          <button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')} title={tr("نمایش لیستی")}><Icon name="list" size={17} /></button>
        </div>
      </div>

      {(cats.data?.length || 0) > 0 && (
        <div className="chips">
          <button className={`chip ${!category ? 'active' : ''}`} onClick={() => setCategory('')}>{tr("همه دسته‌ها")}</button>
          {cats.data!.map((c) => (
            <button key={c.category} className={`chip ${category === c.category ? 'active' : ''}`} onClick={() => setCategory(category === c.category ? '' : c.category)}>
              {c.category} <span className="muted-num">{fa(c.count)}</span>
            </button>
          ))}
        </div>
      )}

      {error ? (
        <ErrorBox error={error} onRetry={reload} />
      ) : loading && !data ? (
        <LoadingGrid />
      ) : products.length === 0 ? (
        <Card>
          <EmptyState
            icon="box"
            title={total ? tr("محصولی با این فیلتر پیدا نشد") : tr("هنوز محصولی ثبت نشده است")}
            text={total ? tr("فیلترها یا عبارت جستجو را تغییر دهید.") : tr("محصول را دستی اضافه کنید یا فایل CSV کاتالوگ را وارد کنید (نمونه در پوشه sample-data).")}
            action={!total && <Button icon="plus" onClick={() => setFormOpen(true)}>{tr("افزودن اولین محصول")}</Button>}
          />
        </Card>
      ) : view === 'grid' ? (
        <div className="product-grid">
          {products.map((p) => <ProductCard key={p.id} p={p} />)}
        </div>
      ) : (
        <Card padded={false}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>{tr("محصول")}</th><th>{tr("دسته‌بندی")}</th><th>{tr("قیمت")}</th><th>{tr("موجودی")}</th><th>{tr("آخرین تغییر")}</th><th /></tr>
              </thead>
              <tbody>
                {products.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => navigate(`/products/${p.id}`)}>
                    <td>
                      <div className="row gap-12 align-center">
                        <ProductImage src={p.image_url} name={p.name} className="thumb-48" rounded={10} />
                        <div>
                          <div className="strong">{p.name}</div>
                          <div className="muted mono-sm">{p.sku}</div>
                        </div>
                      </div>
                    </td>
                    <td>{p.category ? <Badge>{p.category}</Badge> : <span className="muted">—</span>}</td>
                    <td><Price p={p} /></td>
                    <td><StockBadge stock={p.stock} /></td>
                    <td className="muted">{timeAgo(p.updated_at)}</td>
                    <td className="row-end"><Icon name="chevronLeft" className="muted" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ProductForm
        open={formOpen}
        categories={(cats.data || []).map((c) => c.category)}
        onClose={() => setFormOpen(false)}
        onSaved={(p) => { setFormOpen(false); navigate(`/products/${p.id}`); }}
      />
    </>
  );
}

export function Price({ p, large }: { p: Product; large?: boolean }) {
  const pct = discountPercent(p);
  return (
    <div className={`price ${large ? 'price-lg' : ''}`}>
      {pct > 0 && (
        <div className="price-old">
          <s>{fa(p.price)}</s>
          <span className="discount-pill">{fa(pct)}{tr("٪")}</span>
        </div>
      )}
      <div className="price-now">{toman(finalPrice(p))}</div>
    </div>
  );
}

export function StockBadge({ stock }: { stock: number }) {
  if (stock === 0) return <Badge tone="danger" dot>{tr("ناموجود")}</Badge>;
  if (stock <= 5) return <Badge tone="warning" dot>{fa(stock)} {tr("عدد — رو به اتمام")}</Badge>;
  return <Badge tone="success" dot>{fa(stock)} {tr("عدد")}</Badge>;
}

function ProductCard({ p }: { p: Product }) {
  const pct = discountPercent(p);
  return (
    <a className="product-card" href={href(`/products/${p.id}`)}>
      <div className="product-card-media">
        <ProductImage src={p.image_url} name={p.name} rounded={0} />
        {pct > 0 && (
          <span className="ribbon"><Icon name="percent" size={13} />{fa(pct)}{tr("٪ تخفیف")}</span>
        )}
        {(p.images?.length || 0) > 1 && (
          <span className="media-count"><Icon name="image" size={13} />{fa(p.images.length)}</span>
        )}
        {p.stock === 0 && <span className="overlay-out">{tr("ناموجود")}</span>}
        <span className="card-cta">{tr("مشاهده جزئیات")}</span>
      </div>
      <div className="product-card-body">
        <div className="pc-title">
          <span className="pc-title-ico"><Icon name="tag" size={14} /></span>
          <h4 title={p.name}>{p.name}</h4>
          <span className={`pc-stock ${p.stock === 0 ? 'out' : p.stock <= 5 ? 'low' : ''}`} title={tr("موجودی")}>
            <Icon name="cart" size={14} />{fa(p.stock)}
          </span>
        </div>
        <div className="pc-foot">
          <span className="pc-cat" title={p.category}><Icon name="folder" size={13} />{p.category || '—'}</span>
          <div className="pc-price">
            {pct > 0 && <s>{fa(p.price)}</s>}
            <strong>{fa(finalPrice(p))}</strong>
            <small>{tr("تومان")}</small>
          </div>
          {pct > 0 && <span className="pc-pill">{fa(pct)}{tr("٪")}</span>}
        </div>
      </div>
    </a>
  );
}
