import { DIR, LOCALE, tr } from '../i18n';
import {
  api,
  Change,
  Content,
  fa,
  FIELD_LABELS,
  KIND_LABELS,
  Product,
  Publication,
  stripTags,
  timeAgo,
  toman,
} from "../api";
import HeroSlider, { HeroSlide, parseSlides } from "../components/HeroSlider";
import Icon from "../components/Icon";
import {
  Badge,
  Card,
  EmptyState,
  ErrorBox,
  PlatformChip,
  PlatformIcon,
  ProductImage,
  Skeleton,
  Truncate,
  useLoad,
} from "../components/ui";
import { href } from "../router";

interface DashboardData {
  counts: Record<string, number>;
  platforms: {
    id: number;
    key: string;
    name: string;
    color: string;
    icon: string;
    destinations: number;
    sent_30d: number;
  }[];
  pending: Content[];
  recentChanges: Change[];
  failed: Publication[];
  activity: { day: string; sent: number }[];
}

const fmtValue = (field: string, v: string | null) =>
  v === null
    ? "—"
    : field.includes("price")
      ? toman(v)
      : field === "stock"
        ? fa(v)
        : v;

export default function Dashboard() {
  const { data, error, loading, reload } = useLoad(() =>
    api.get<DashboardData>("/dashboard"),
  );
  const health = useLoad(() => api.get<Record<string, string>>("/health"));
  const settings = useLoad(() => api.get<Record<string, string>>("/settings"));
  const products = useLoad(() => api.get<Product[]>("/products"));

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (loading && !data) {
    return (
      <div className="stack-16">
        <Skeleton h={120} r={18} />
        <div className="kpi-grid">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} h={110} r={16} />
          ))}
        </div>
        <Skeleton h={260} r={16} />
      </div>
    );
  }
  if (!data) return null;
  const c = data.counts;
  const hour = new Date().getHours();
  const greet = hour < 12 ? tr("صبح بخیر") : hour < 17 ? tr("روز بخیر") : tr("عصر بخیر");
  const store = settings.data?.store_name || tr("فروشگاه من");
  const status = c.pending_contents
    ? `${fa(c.pending_contents)} ${tr("محتوا منتظر تأیید شماست.")}`
    : c.manual_ready
      ? `${fa(c.manual_ready)} ${tr("محتوا آماده انتشار دستی است.")}`
      : tr("همه چیز مرتب است. محصولات و کانال‌ها همگام هستند.");
  const custom = parseSlides(settings.data?.hero_slides);
  // Without custom slides: a welcome slide + up to 3 products that have photos
  const slides: HeroSlide[] = custom.length
    ? custom
    : [
        {
          image: "",
          title: `${greet}${tr("؛ به دستیار فروشگاه‌یار خوش آمدید")}`,
          subtitle: status,
          link: c.pending_contents ? "/content" : "/products",
          link_label: c.pending_contents ? tr("بررسی محتوا") : tr("مدیریت محصولات"),
        },
        ...(products.data || [])
          .filter((p) => p.image_url && !/\.(mp4|webm|mov|m4v)(\?|$)/i.test(p.image_url))
          .slice(0, 3)
          .map((p) => ({
            image: p.image_url,
            title: p.name,
            subtitle: p.description?.slice(0, 120) || "",
            link: `/products/${p.id}`,
            link_label: tr("مشاهده محصول"),
          })),
      ];
  const maxSent = Math.max(1, ...data.activity.map((a) => a.sent));
  const totalSent14 = data.activity.reduce((s, a) => s + a.sent, 0);

  const kpis = [
    {
      label: tr("محصولات"),
      value: c.products,
      icon: "box",
      tone: "brand",
      link: "/products",
      sub: c.out_of_stock ? `${fa(c.out_of_stock)} ${tr("ناموجود")}` : tr("همه موجود"),
    },
    {
      label: tr("در انتظار تأیید"),
      value: c.pending_contents,
      icon: "sparkles",
      tone: "warning",
      link: "/content",
      sub: tr("محتوای آماده بررسی"),
    },
    {
      label: tr("ارسال ۳۰ روز اخیر"),
      value: c.sent_30d,
      icon: "send",
      tone: "success",
      link: "/content",
      sub: `${fa(c.destinations)} ${tr("مقصد فعال")}`,
    },
    {
      label: tr("ارسال ناموفق"),
      value: c.failed_publications,
      icon: "alert",
      tone: c.failed_publications ? "danger" : "neutral",
      link: "/content",
      sub: c.failed_publications ? tr("نیاز به بررسی") : tr("بدون خطا"),
    },
  ];

  return (
    <div className="stack-20">
      <div className="dash-top">
        <HeroSlider
          slides={slides}
          logo={settings.data?.logo_url || undefined}
          storeName={store}
        />

        <aside className="stats-glass" aria-label={tr("آمار فروشگاه")}>
          <span className="sg-blob sg-blob-1" />
          <span className="sg-blob sg-blob-2" />
          <div className="sg-head">
            <div>
              <strong>{tr("آمار فروشگاه")}</strong>
              <small>{new Date().toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long" })}</small>
            </div>
            <span className="sg-head-ico"><Icon name="trending" size={18} /></span>
          </div>
          <div className="sg-grid">
            {kpis.map((k) => (
              <a key={k.label} className={`sg-tile sg-${k.tone}`} href={href(k.link)}>
                <span className="sg-tile-top">
                  <span className="sg-ico"><Icon name={k.icon} size={16} /></span>
                  <span className="sg-value">{fa(k.value)}</span>
                </span>
                <span className="sg-label">{k.label}</span>
                <span className="sg-sub">{k.sub}</span>
              </a>
            ))}
          </div>
          {health.data && (
            <div className="sg-status">
              <StatusLine ok={health.data.telegram === "configured"} label={tr("ربات تلگرام")} />
              <StatusLine ok={health.data.ai === "configured"} label={tr("هوش مصنوعی")} off={tr("حالت قالب")} />
              <StatusLine ok={c.destinations > 0} label={`${fa(c.destinations)} ${tr("مقصد انتشار")}`} off={tr("بدون مقصد")} />
            </div>
          )}
        </aside>
      </div>

      <div className="dash-grid">
        <Card
          title={tr("فعالیت انتشار")}
          subtitle={`${fa(totalSent14)} ${tr("ارسال در ۱۴ روز اخیر")}`}
        >
          <div
            className="bars"
            role="img"
            aria-label={tr("نمودار تعداد ارسال روزانه")}
          >
            {data.activity.map((a) => (
              <div
                key={a.day}
                className="bar-col"
                title={`${new Date(a.day).toLocaleDateString(LOCALE)}: ${fa(a.sent)} ${tr("ارسال")}`}
              >
                <div
                  className="bar"
                  style={{
                    height: `${Math.max(4, (a.sent / maxSent) * 100)}%`,
                  }}
                  data-empty={a.sent === 0}
                />
                <span>
                  {new Date(a.day).toLocaleDateString(LOCALE, {
                    day: "numeric",
                  })}
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card
          title={tr("کانال‌ها")}
          actions={
            <a className="link-sm" href={href("/channels")}>
              {tr("مدیریت")}
            </a>
          }
        >
          <ul className="channel-list">
            {data.platforms.map((p) => (
              <li key={p.id}>
                <a href={href(`/channels/${p.id}`)}>
                  <PlatformIcon icon={p.icon} color={p.color} size={34} />
                  <div className="grow">
                    <strong>{p.name}</strong>
                    <small>
                      {p.destinations
                        ? `${fa(p.destinations)} ${tr("مقصد")}`
                        : tr("بدون مقصد")}
                    </small>
                  </div>
                  <span className="channel-num">
                    {fa(p.sent_30d)}
                    <small>{tr("ارسال")}</small>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="dash-grid">
        <Card
          title={tr("منتظر تأیید شما")}
          actions={
            <a className="link-sm" href={href("/content")}>
              {tr("همه")}
            </a>
          }
        >
          {data.pending.length === 0 ? (
            <EmptyState
              icon="check"
              title={tr("صف تأیید خالی است")}
              text={tr("محتوای جدید پس از تغییر قیمت یا موجودی، اینجا ظاهر می‌شود.")}
            />
          ) : (
            <ul className="mini-list">
              {data.pending.map((p) => (
                <li key={p.id}>
                  <a href={href("/content")}>
                    <ProductImage
                      src={p.product_image}
                      name={p.product_name}
                      className="thumb-44"
                      rounded={10}
                    />
                    <div className="grow min-0">
                      <div className="row gap-8 align-center wrap">
                        <strong className="ellipsis">{p.product_name}</strong>
                        <PlatformChip
                          name={p.platform_name}
                          icon={p.platform_icon}
                          color={p.platform_color}
                        />
                      </div>
                      <small className="ellipsis">
                        {KIND_LABELS[p.kind]} · {stripTags(p.body).slice(0, 70)}
                      </small>
                    </div>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={tr("آخرین تغییرات محصولات")}>
          {data.recentChanges.length === 0 ? (
            <EmptyState icon="history" title={tr("تغییری ثبت نشده")} />
          ) : (
            <ul className="mini-list">
              {data.recentChanges.map((ch) => (
                <li key={ch.id}>
                  <a href={href(`/products/${ch.product_id}`)}>
                    <ProductImage
                      src={ch.image_url}
                      name={ch.product_name}
                      className="thumb-44"
                      rounded={10}
                    />
                    <div className="grow min-0">
                      <strong className="ellipsis">{ch.product_name}</strong>
                      <small>
                        {FIELD_LABELS[ch.field] || ch.field}:{" "}
                        <span className="old-val">
                          {fmtValue(ch.field, ch.old_value)}
                        </span>{" "}
                        {DIR === "rtl" ? "←" : "→"}{" "}
                        <span className="new-val">
                          {fmtValue(ch.field, ch.new_value)}
                        </span>
                      </small>
                    </div>
                    <small className="muted nowrap">
                      {timeAgo(ch.created_at)}
                    </small>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {data.failed.length > 0 && (
        <Card
          title={
            <span className="row gap-8 align-center">
              <Icon name="alert" className="text-danger" /> {tr("ارسال‌های ناموفق")}
            </span>
          }
          actions={
            <a className="link-sm" href={href("/content")}>
              {tr("بررسی و تلاش مجدد")}
            </a>
          }
        >
          <ul className="mini-list">
            {data.failed.map((f) => (
              <li key={f.id}>
                <div className="mini-row">
                  <PlatformIcon
                    icon={f.platform_icon}
                    color={f.platform_color}
                    size={34}
                  />
                  <div className="grow min-0">
                    <strong>
                      {f.product_name} {DIR === "rtl" ? "←" : "→"} {f.destination_name}
                    </strong>
                    <small className="text-danger"><Truncate text={f.message} max={70} /></small>
                  </div>
                  <Badge tone="danger">{tr("ناموفق")}</Badge>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function StatusLine({
  ok,
  label,
  off,
}: {
  ok: boolean;
  label: string;
  off?: string;
}) {
  return (
    <div className="status-line">
      <span className={`status-dot ${ok ? "ok" : "warn"}`} />
      <span>{label}</span>
      <small>{ok ? tr("متصل") : off || tr("تنظیم نشده")}</small>
    </div>
  );
}
