import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  AlertTriangle, BookMarked, BookOpen, Boxes, CalendarClock, Library,
  TrendingUp, Undo2, UserPlus, Users,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  Badge, Button, Card, CardHeader, EmptyState, Skeleton, cn,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import {
  formatDateTime, formatMoney, formatNumber, formatRelative, toPersianDigits,
} from '@/lib/format';

/**
 * داشبورد (قوانین ۴، ۵۹، ۱۰۷، ۱۰۸).
 *
 * ── قانون ۱۰۸: هیچ عدد ثابتی ─────────────────────────────────────────────
 * تمام اعداد این صفحه از `/dashboard/overview` می‌آیند که خودش آنها را با
 * `count` و `SUM` از دیتابیس می‌گیرد. هیچ مقدار نمونه‌ای در این فایل نیست.
 *
 * ── چرا یک درخواست ───────────────────────────────────────────────────────
 * ۹ بخش صفحه در یک Endpoint جمع شده‌اند تا صفحه با یک رفت‌وبرگشت شبکه
 * کامل شود، نه ۹ تا.
 */

type RangePreset = 'today' | 'week' | 'month' | 'year';

const RANGES: Array<{ key: RangePreset; label: string }> = [
  { key: 'today', label: 'امروز' },
  { key: 'week', label: 'هفته' },
  { key: 'month', label: 'ماه' },
  { key: 'year', label: 'سال' },
];

interface Overview {
  range: { from: string; to: string; label: string };
  summary: {
    collection: {
      titles: number; copies: number; available: number; onLoan: number;
      reservedHold: number; lost: number; damaged: number; inRepair: number;
      notLoanable: number; newThisMonth: number;
    };
    members: {
      total: number; active: number; inactive: number; expired: number;
      suspended: number; blocked: number; newThisMonth: number;
    };
    circulation: {
      loansToday: number; returnsToday: number; overdueToday: number;
      overdueTotal: number; activeReservations: number; readyForPickup: number;
    };
    finance: { outstandingAmount: number; outstandingCount: number };
  };
  trend: Array<{ period: string; loans: number; returns: number; overdue: number }>;
  growth: Array<{ period: string; added: number; cumulative: number }>;
  popularBooks: Array<{ id: string; title: string; authors: string[]; loanCount: number }>;
  popularCategories: Array<{ id: string; name: string; loanCount: number }>;
  topMembers: Array<{ id: string; memberCode: string; fullName: string; loanCount: number }>;
  topAuthors: Array<{ id: string; fullName: string; loanCount: number }>;
  activity: Array<{
    id: string; action: string; entityType: string; entityId: string | null;
    entityLabel: string | null; userLabel: string | null; createdAt: string;
  }>;
  dueSoon: Array<{
    id: string; loanNumber: string; dueAt: string;
    member: { id: string; memberCode: string; firstName: string; lastName: string; mobile: string | null };
    copy: { barcode: string; book: { id: string; title: string } };
  }>;
}

/** برچسب فارسی رویدادهای گزارش فعالیت. */
const ACTION_LABELS: Record<string, string> = {
  checkout: 'امانت',
  return: 'بازگشت',
  renew: 'تمدید',
  reserve: 'رزرو',
  create: 'ثبت',
  delete: 'حذف',
  create_copies: 'افزودن نسخه',
  pay_fine: 'پرداخت جریمه',
  move_copies: 'جابه‌جایی نسخه',
};

const ENTITY_LABELS: Record<string, string> = {
  Book: 'کتاب',
  BookCopy: 'نسخه',
  Member: 'عضو',
  Loan: 'امانت',
  Reservation: 'رزرو',
  Fine: 'جریمه',
  Location: 'مکان',
  Person: 'پدیدآورنده',
  Publisher: 'ناشر',
  Category: 'دسته‌بندی',
  User: 'کاربر',
};

/** ماه شمسی از کلید `YYYY-MM` میلادی — برای محور نمودارها. */
function periodLabel(period: string): string {
  const [year, month] = period.split('-');
  if (!year || !month) return period;
  const date = new Date(Number(year), Number(month) - 1, 15);
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian', { month: 'short', year: '2-digit' }).format(date);
}

/*
 * ── چرا انیمیشن نمودارها خاموش است ──────────────────────────────────────
 * داشبورد ابزار کار روزانه است، نه صفحه تبلیغاتی. انیمیشن ورودی یعنی
 * کتابدار نیم‌ثانیه اول عدد درست را نمی‌بیند، و در چاپ یا اسکرین‌شات
 * نمودارِ نیمه‌کشیده ثبت می‌شود. رسم بی‌درنگ، هم دقیق‌تر است هم سریع‌تر.
 */
const CHART_COLORS = ['#1e40af', '#0891b2', '#15803d', '#b45309', '#be123c', '#7c3aed', '#0f766e', '#a16207'];

export function DashboardPage() {
  const { can, user } = useAuth();
  const [range, setRange] = React.useState<RangePreset>('month');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard', 'overview', range],
    queryFn: () => api.get<Overview>('/dashboard/overview', { range, months: 12 }),
    staleTime: 60_000,
  });

  if (isError) {
    return (
      <>
        <PageHeader title="داشبورد" />
        <Card>
          <EmptyState
            icon={<AlertTriangle className="size-6" />}
            title="آمار داشبورد بارگذاری نشد"
            description={error instanceof Error ? error.message : undefined}
            action={<Button onClick={() => void refetch()}>تلاش مجدد</Button>}
          />
        </Card>
      </>
    );
  }

  const s = data?.summary;

  return (
    <>
      <PageHeader
        title={`${greeting()}، ${user?.fullName ?? ''}`}
        description={data ? `آمار بازه: ${data.range.label}` : 'در حال بارگذاری آمار…'}
        actions={
          <div className="flex rounded border border-border bg-surface p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRange(r.key)}
                className={cn(
                  'rounded px-3 py-1.5 text-xs transition',
                  range === r.key
                    ? 'bg-primary text-primary-content'
                    : 'text-content-muted hover:bg-surface-sunken',
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      {/* ── کارت‌های آمار کلیدی ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          loading={isLoading}
          icon={<Library className="size-5" />}
          tone="primary"
          label="عنوان‌های ثبت‌شده"
          value={s ? formatNumber(s.collection.titles) : null}
          hint={s ? `${formatNumber(s.collection.copies)} نسخه فیزیکی` : undefined}
          to={can('books.view') ? '/books' : undefined}
        />
        <StatCard
          loading={isLoading}
          icon={<Boxes className="size-5" />}
          tone="success"
          label="نسخه موجود"
          value={s ? formatNumber(s.collection.available) : null}
          hint={s ? `${formatNumber(s.collection.onLoan)} نسخه در امانت` : undefined}
          to={can('copies.view') ? '/copies?status=AVAILABLE' : undefined}
        />
        <StatCard
          loading={isLoading}
          icon={<Users className="size-5" />}
          tone="info"
          label="اعضای فعال"
          value={s ? formatNumber(s.members.active) : null}
          hint={s ? `${formatNumber(s.members.total)} عضو در مجموع` : undefined}
          to={can('members.view') ? '/members?status=ACTIVE' : undefined}
        />
        <StatCard
          loading={isLoading}
          icon={<AlertTriangle className="size-5" />}
          tone={s && s.circulation.overdueTotal > 0 ? 'danger' : 'neutral'}
          label="امانت دیرکرددار"
          value={s ? formatNumber(s.circulation.overdueTotal) : null}
          hint={
            s && s.finance.outstandingAmount > 0
              ? `${formatMoney(s.finance.outstandingAmount)} جریمه پرداخت‌نشده`
              : 'جریمه پرداخت‌نشده‌ای نیست'
          }
          to={can('loans.view') ? '/loans?overdue=true' : undefined}
        />
      </div>

      {/* ── فعالیت امروز ─────────────────────────────────────────────── */}
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MiniStat
          loading={isLoading}
          icon={<BookOpen className="size-4 text-primary" />}
          label="امانت امروز"
          value={s ? formatNumber(s.circulation.loansToday) : null}
        />
        <MiniStat
          loading={isLoading}
          icon={<Undo2 className="size-4 text-success" />}
          label="بازگشت امروز"
          value={s ? formatNumber(s.circulation.returnsToday) : null}
        />
        <MiniStat
          loading={isLoading}
          icon={<BookMarked className="size-4 text-warning" />}
          label="رزرو آماده تحویل"
          value={s ? formatNumber(s.circulation.readyForPickup) : null}
          to={can('reservations.view') ? '/reservations?status=READY' : undefined}
        />
        <MiniStat
          loading={isLoading}
          icon={<UserPlus className="size-4 text-info" />}
          label="عضو جدید این ماه"
          value={s ? formatNumber(s.members.newThisMonth) : null}
        />
      </div>

      {/* ── نمودارها ─────────────────────────────────────────────────── */}
      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="روند امانت و بازگشت"
            description="۱۲ ماه گذشته — بر پایه تاریخ ثبت در دیتابیس"
          />
          <div className="p-4">
            {isLoading ? (
              <Skeleton className="h-64" />
            ) : data && data.trend.some((t) => t.loans || t.returns) ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={data.trend.map((t) => ({ ...t, label: periodLabel(t.period) }))}>
                  <defs>
                    <linearGradient id="loansFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#1e40af" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#1e40af" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="returnsFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#15803d" stopOpacity={0.24} />
                      <stop offset="100%" stopColor="#15803d" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--color-border))" vertical={false} />
                  <XAxis
                    dataKey="label" reversed
                    tick={{ fontSize: 11, fill: 'rgb(var(--color-content-muted))' }}
                    axisLine={false} tickLine={false}
                  />
                  <YAxis
                    orientation="right"
                    tick={{ fontSize: 11, fill: 'rgb(var(--color-content-muted))' }}
                    axisLine={false} tickLine={false}
                    tickFormatter={(v: number) => toPersianDigits(v)}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 12, direction: 'rtl' }} />
                  <Area
                    type="monotone" dataKey="loans" name="امانت"
                    stroke="#1e40af" strokeWidth={2} fill="url(#loansFill)"
                    isAnimationActive={false}
                  />
                  <Area
                    type="monotone" dataKey="returns" name="بازگشت"
                    stroke="#15803d" strokeWidth={2} fill="url(#returnsFill)"
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                icon={<TrendingUp className="size-6" />}
                title="هنوز امانتی ثبت نشده"
                description="پس از ثبت اولین امانت‌ها، روند ماهانه اینجا نمایش داده می‌شود."
              />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="موضوعات پرتقاضا" description={data?.range.label} />
          <div className="p-4">
            {isLoading ? (
              <Skeleton className="h-64" />
            ) : data?.popularCategories.length ? (
              <>
                <ResponsiveContainer width="100%" height={190}>
                  <PieChart>
                    <Pie
                      data={data.popularCategories}
                      dataKey="loanCount"
                      nameKey="name"
                      innerRadius={48}
                      outerRadius={80}
                      paddingAngle={2}
                      isAnimationActive={false}
                    >
                      {data.popularCategories.map((entry, i) => (
                        <Cell key={entry.id} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>

                {/*
                  راهنمای نمودار به‌صورت دستی ساخته می‌شود، نه با `<Legend>`.
                  راهنمای پیش‌فرض recharts آیتم‌ها را چپ‌به‌راست می‌چیند و در
                  RTL نمونه‌رنگ هر آیتم کنار نام آیتم بعدی می‌افتد. این فهرست
                  علاوه بر درست بودن جهت، تعداد امانت هر موضوع را هم نشان
                  می‌دهد که خودش اطلاعات مفیدی است.
                */}
                <ul className="mt-3 space-y-1">
                  {data.popularCategories.map((category, i) => (
                    <li key={category.id} className="flex items-center gap-2 text-xs">
                      <span
                        className="size-2.5 shrink-0 rounded-sm"
                        style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate text-content-muted">
                        {category.name}
                      </span>
                      <span className="shrink-0 font-medium text-content">
                        {formatNumber(category.loanCount)}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <EmptyState title="داده‌ای در این بازه نیست" description="بازه دیگری را انتخاب کنید." />
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        {/* ── موعد نزدیک ────────────────────────────────────────────── */}
        <Card className="xl:col-span-2">
          <CardHeader
            title="موعد بازگشت نزدیک"
            description="۳ روز آینده"
            action={
              can('loans.view') ? (
                <Link to="/loans" className="text-xs text-primary hover:underline">
                  همه امانت‌ها
                </Link>
              ) : null
            }
          />
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : data?.dueSoon.length ? (
            <ul className="divide-y divide-border">
              {data.dueSoon.slice(0, 8).map((loan) => (
                <li key={loan.id} className="flex items-center gap-3 px-4 py-2.5">
                  <CalendarClock className="size-4 shrink-0 text-content-subtle" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-content">{loan.copy.book.title}</p>
                    <p className="truncate text-xs text-content-muted">
                      {loan.member.firstName} {loan.member.lastName} · {loan.member.memberCode}
                    </p>
                  </div>
                  <Badge tone={isDueToday(loan.dueAt) ? 'warning' : 'neutral'}>
                    {formatRelative(loan.dueAt)}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="موعد نزدیکی وجود ندارد"
              description="هیچ امانتی در سه روز آینده سررسید نمی‌شود."
            />
          )}
        </Card>

        {/* ── فعالیت‌های اخیر ───────────────────────────────────────── */}
        <Card>
          <CardHeader
            title="آخرین فعالیت‌ها"
            action={
              can('audit.view') ? (
                <Link to="/audit-logs" className="text-xs text-primary hover:underline">
                  همه
                </Link>
              ) : null
            }
          />
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-8" />)}
            </div>
          ) : data?.activity.length ? (
            <ul className="divide-y divide-border">
              {data.activity.slice(0, 10).map((item) => (
                <li key={item.id} className="px-4 py-2">
                  <p className="truncate text-xs text-content">
                    <span className="font-medium">
                      {ACTION_LABELS[item.action] ?? item.action}
                    </span>
                    {' '}
                    <span className="text-content-muted">
                      {ENTITY_LABELS[item.entityType] ?? item.entityType}
                    </span>
                    {item.entityLabel ? ` — ${item.entityLabel}` : ''}
                  </p>
                  <p className="mt-0.5 text-2xs text-content-subtle">
                    {item.userLabel ?? 'سیستم'} · {formatDateTime(item.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="فعالیتی ثبت نشده" />
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* ── پرترددترین کتاب‌ها ────────────────────────────────────── */}
        <Card>
          <CardHeader title="پرترددترین کتاب‌ها" description={data?.range.label} />
          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-8" />)}
            </div>
          ) : data?.popularBooks.length ? (
            <ol className="divide-y divide-border">
              {data.popularBooks.map((book, i) => (
                <li key={book.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-5 shrink-0 text-center text-xs font-semibold text-content-subtle">
                    {toPersianDigits(i + 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    {can('books.view') ? (
                      <Link
                        to={`/books/${book.id}`}
                        className="block truncate text-sm text-content hover:text-primary hover:underline"
                      >
                        {book.title}
                      </Link>
                    ) : (
                      <p className="truncate text-sm text-content">{book.title}</p>
                    )}
                    <p className="truncate text-xs text-content-muted">
                      {book.authors.join('، ') || 'بدون پدیدآورنده'}
                    </p>
                  </div>
                  <Badge tone="primary">{formatNumber(book.loanCount)} امانت</Badge>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="در این بازه امانتی ثبت نشده" />
          )}
        </Card>

        {/* ── رشد مجموعه ───────────────────────────────────────────── */}
        <Card>
          <CardHeader title="رشد مجموعه" description="نسخه‌های افزوده‌شده در هر ماه" />
          <div className="p-4">
            {isLoading ? (
              <Skeleton className="h-56" />
            ) : data && data.growth.some((g) => g.added > 0) ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={data.growth.map((g) => ({ ...g, label: periodLabel(g.period) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--color-border))" vertical={false} />
                  <XAxis
                    dataKey="label" reversed
                    tick={{ fontSize: 11, fill: 'rgb(var(--color-content-muted))' }}
                    axisLine={false} tickLine={false}
                  />
                  <YAxis
                    orientation="right"
                    tick={{ fontSize: 11, fill: 'rgb(var(--color-content-muted))' }}
                    axisLine={false} tickLine={false}
                    tickFormatter={(v: number) => toPersianDigits(v)}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar
                    dataKey="added" name="نسخه افزوده‌شده" fill="#0891b2"
                    radius={[3, 3, 0, 0]} isAnimationActive={false}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState title="هنوز نسخه‌ای ثبت نشده" />
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

/** سلام بر اساس ساعت — جزئیات کوچکی که رابط را انسانی می‌کند. */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'شب بخیر';
  if (hour < 12) return 'صبح بخیر';
  if (hour < 17) return 'ظهر بخیر';
  return 'عصر بخیر';
}

function isDueToday(dueAt: string): boolean {
  const due = new Date(dueAt);
  const today = new Date();
  return due.toDateString() === today.toDateString();
}

const STAT_TONES = {
  primary: 'bg-primary-soft text-primary',
  success: 'bg-success-soft text-success',
  info: 'bg-info-soft text-info',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-surface-sunken text-content-muted',
} as const;

function StatCard({
  icon, label, value, hint, tone, to, loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  hint?: string;
  tone: keyof typeof STAT_TONES;
  to?: string;
  loading?: boolean;
}) {
  const content = (
    <Card className={cn('p-4 transition', to && 'hover:border-border-strong hover:shadow-raised')}>
      <div className="flex items-start gap-3">
        <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', STAT_TONES[tone])}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-content-muted">{label}</p>
          {loading || value === null ? (
            <Skeleton className="mt-1.5 h-6 w-16" />
          ) : (
            <p className="mt-0.5 text-2xl font-bold text-content">{value}</p>
          )}
          {hint && !loading ? (
            <p className="mt-0.5 truncate text-2xs text-content-subtle">{hint}</p>
          ) : null}
        </div>
      </div>
    </Card>
  );

  return to ? <Link to={to} className="block">{content}</Link> : content;
}

function MiniStat({
  icon, label, value, to, loading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  to?: string;
  loading?: boolean;
}) {
  const content = (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5',
        to && 'transition hover:border-border-strong',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-xs text-content-muted">{label}</span>
      {loading || value === null ? (
        <Skeleton className="h-4 w-8" />
      ) : (
        <span className="text-sm font-semibold text-content">{value}</span>
      )}
    </div>
  );

  return to ? <Link to={to} className="block">{content}</Link> : content;
}

/**
 * راهنمای نمودار.
 * Tooltip پیش‌فرض recharts چپ‌چین است و اعداد را لاتین نشان می‌دهد؛
 * این نسخه راست‌چین و با ارقام فارسی است.
 */
function ChartTooltip({
  active, payload, label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-border bg-surface px-3 py-2 text-xs shadow-overlay">
      {label !== undefined ? (
        <p className="mb-1 font-medium text-content">{label}</p>
      ) : null}
      {payload.map((entry, i) => (
        <p key={i} className="flex items-center gap-2 text-content-muted">
          <span className="size-2 rounded-full" style={{ background: entry.color }} aria-hidden />
          {entry.name}: <span className="font-medium text-content">{formatNumber(Number(entry.value))}</span>
        </p>
      ))}
    </div>
  );
}

