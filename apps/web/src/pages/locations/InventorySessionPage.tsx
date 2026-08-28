import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Check, CheckCheck, MapPin, Play, ScanBarcode,
  Square, TriangleAlert, X,
} from 'lucide-react';
import { INVENTORY_SESSION_STATUS } from '@darin/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Input, Skeleton,
  TableWrapper, Td, Th, cn,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { formatDateTime, formatNumber, formatPercent, toPersianDigits } from '@/lib/format';

interface Progress {
  id: string; name: string; status: string; expectedCount: number;
  scanned: number; found: number; unexpected: number; unknown: number;
  duplicate: number; remaining: number; completionRate: number;
}

interface ScanResult {
  barcode: string;
  result: 'FOUND' | 'MOVED' | 'UNEXPECTED' | 'UNKNOWN' | 'DUPLICATE';
  message: string;
  copy: {
    id: string; accessionNumber: string; title: string;
    expectedLocation: string | null; status: string;
  } | null;
  progress: { scanned: number; expected: number; found: number };
}

interface DiscrepancyReport {
  session: {
    id: string; name: string; status: string;
    startedAt: string | null; completedAt: string | null; scopeLocation: string | null;
  };
  summary: {
    expected: number; scanned: number; found: number; missing: number;
    moved: number; unexpected: number; unknown: number; completionRate: number;
  };
  missing: Array<{
    copyId: string; accessionNumber: string; barcode: string;
    title: string; expectedLocation: string | null; status: string;
  }>;
  moved: Array<{
    copyId: string; accessionNumber: string; title: string;
    expectedLocation: string | null; foundLocation: string | null;
  }>;
  unexpected: Array<{
    copyId: string | null; barcode: string; title: string | null; homeLocation: string | null;
  }>;
  unknown: Array<{ barcode: string; scannedAt: string }>;
}

const RESULT_STYLES: Record<
  ScanResult['result'],
  { tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'; label: string }
> = {
  FOUND: { tone: 'success', label: 'یافت شد' },
  MOVED: { tone: 'warning', label: 'جابه‌جا شده' },
  UNEXPECTED: { tone: 'info', label: 'خارج از محدوده' },
  UNKNOWN: { tone: 'danger', label: 'ناشناخته' },
  DUPLICATE: { tone: 'neutral', label: 'تکراری' },
};

/**
 * اجرای یک جلسه شمارش (قوانین ۵۰، ۵۱، ۵۲).
 *
 * ── کتابدار جلوی قفسه ایستاده ───────────────────────────────────────────
 * دستش بارکدخوان است و چشمش به صفحه. پس از هر اسکن باید در یک نگاه
 * بفهمد: درست بود؟ جای دیگری باید باشد؟ اصلاً مال این کتابخانه هست؟
 * کارت نتیجه با رنگ و متن فارسی همین را می‌گوید و تمرکز روی کادر
 * می‌ماند تا اسکن بعدی بی‌وقفه انجام شود.
 *
 * ── گزارش مغایرت جدا از شمارش است ───────────────────────────────────────
 * «مفقود اعلام کردن» تصمیمی با پیامد مالی است. بستن جلسه آن را خودکار
 * انجام نمی‌دهد؛ کتابدار پس از دیدن فهرست، آگاهانه تصمیم می‌گیرد.
 */
export function InventorySessionPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();

  const [barcode, setBarcode] = React.useState('');
  const [scans, setScans] = React.useState<ScanResult[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [completeOpen, setCompleteOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [selectedMissing, setSelectedMissing] = React.useState<string[]>([]);
  const [markLostOpen, setMarkLostOpen] = React.useState(false);
  const [applyOpen, setApplyOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const { data: progress, isLoading } = useQuery({
    queryKey: ['inventory', id, 'progress'],
    queryFn: () => api.get<Progress>(`/inventory/${id}`),
    enabled: !!id,
    // شمارش را ممکن است چند نفر هم‌زمان انجام دهند؛ پیشرفت باید تازه بماند
    refetchInterval: (q) =>
      (q.state.data)?.status === 'IN_PROGRESS' ? 15_000 : false,
  });

  const isDone = progress?.status === 'COMPLETED' || progress?.status === 'CANCELLED';

  const { data: report } = useQuery({
    queryKey: ['inventory', id, 'report'],
    queryFn: () => api.get<DiscrepancyReport>(`/inventory/${id}/report`),
    enabled: !!id && !!progress && progress.status !== 'DRAFT',
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['inventory', id] });
  };

  const start = useMutation({
    mutationFn: () => api.post(`/inventory/${id}/start`),
    onSuccess: () => {
      toast.success('شمارش آغاز شد', 'حالا بارکد کتاب‌ها را اسکن کنید.');
      invalidate();
      setTimeout(() => inputRef.current?.focus(), 100);
    },
    onError: (err) => toast.apiError(err, 'شروع شمارش انجام نشد'),
  });

  const scan = useMutation({
    mutationFn: (value: string) =>
      api.post<ScanResult>(`/inventory/${id}/scan`, { barcode: value }),
    onSuccess: (result) => {
      setScans((s) => [result, ...s].slice(0, 60));
      setBarcode('');
      setError(null);
      // پیشرفت را از پاسخ همین اسکن به‌روز می‌کنیم؛ درخواست جدا لازم نیست
      queryClient.setQueryData<Progress>(['inventory', id, 'progress'], (old) =>
        old
          ? { ...old, scanned: result.progress.scanned, found: result.progress.found,
              remaining: Math.max(0, old.expectedCount - result.progress.found),
              completionRate:
                old.expectedCount > 0
                  ? Math.round((result.progress.found / old.expectedCount) * 100)
                  : 0 }
          : old,
      );
      inputRef.current?.focus();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'ثبت اسکن انجام نشد.');
      setBarcode('');
      inputRef.current?.focus();
    },
  });

  const complete = useMutation({
    mutationFn: () => api.post(`/inventory/${id}/complete`),
    onSuccess: () => {
      toast.success('جلسه شمارش بسته شد', 'گزارش مغایرت آماده است.');
      setCompleteOpen(false);
      invalidate();
    },
    onError: (err) => toast.apiError(err, 'بستن جلسه انجام نشد'),
  });

  const cancelSession = useMutation({
    mutationFn: () => api.post(`/inventory/${id}/cancel`),
    onSuccess: () => {
      toast.success('جلسه شمارش لغو شد');
      setCancelOpen(false);
      invalidate();
    },
    onError: (err) => toast.apiError(err, 'لغو جلسه انجام نشد'),
  });

  const markLost = useMutation({
    mutationFn: () => api.post(`/inventory/${id}/mark-lost`, { copyIds: selectedMissing }),
    onSuccess: () => {
      toast.success(`${toPersianDigits(selectedMissing.length)} نسخه مفقود اعلام شد`);
      setMarkLostOpen(false);
      setSelectedMissing([]);
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['copies'] });
    },
    onError: (err) => toast.apiError(err, 'ثبت مفقودی انجام نشد'),
  });

  const applyLocations = useMutation({
    mutationFn: () => api.post<{ updated: number }>(`/inventory/${id}/apply-locations`),
    onSuccess: (result) => {
      toast.success(`محل ${toPersianDigits(result.updated)} نسخه اصلاح شد`);
      setApplyOpen(false);
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['copies'] });
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
    },
    onError: (err) => toast.apiError(err, 'اصلاح محل نسخه‌ها انجام نشد'),
  });

  if (isLoading || !progress) {
    return (
      <>
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-64" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        breadcrumb={
          <nav className="flex items-center gap-1 text-xs text-content-muted" aria-label="مسیر">
            <Link to="/inventory" className="hover:text-primary hover:underline">شمارش موجودی</Link>
            <span aria-hidden>/</span>
            <span className="truncate">{progress.name}</span>
          </nav>
        }
        title={progress.name}
        description={
          report?.session.scopeLocation
            ? `محدوده: ${report.session.scopeLocation}`
            : 'محدوده: کل کتابخانه'
        }
        actions={
          <>
            <Badge tone={progress.status === 'IN_PROGRESS' ? 'info' : progress.status === 'COMPLETED' ? 'success' : 'neutral'}>
              {INVENTORY_SESSION_STATUS[
                progress.status as keyof typeof INVENTORY_SESSION_STATUS
              ] ?? progress.status}
            </Badge>
            {can('inventory.manage') && progress.status === 'DRAFT' ? (
              <Button
                variant="primary"
                onClick={() => start.mutate()}
                loading={start.isPending}
                icon={<Play className="size-4" />}
              >
                شروع شمارش
              </Button>
            ) : null}
            {can('inventory.manage') && progress.status === 'IN_PROGRESS' ? (
              <>
                <Button variant="ghost" onClick={() => setCancelOpen(true)} icon={<X className="size-4" />}>
                  لغو جلسه
                </Button>
                <Button
                  variant="primary"
                  onClick={() => setCompleteOpen(true)}
                  icon={<CheckCheck className="size-4" />}
                >
                  پایان شمارش
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {/* ── پیشرفت ───────────────────────────────────────────────────── */}
      <Card className="mb-4">
        <div className="p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-sm text-content-muted">
              {formatNumber(progress.found)} از {formatNumber(progress.expectedCount)} نسخه یافت شد
            </p>
            <p className="text-lg font-bold text-content">
              {formatPercent(progress.completionRate)}
            </p>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-surface-sunken">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                progress.completionRate >= 95
                  ? 'bg-success'
                  : progress.completionRate >= 60
                    ? 'bg-info'
                    : 'bg-warning',
              )}
              style={{ width: `${Math.min(100, progress.completionRate)}%` }}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="اسکن‌شده" value={formatNumber(progress.scanned)} />
            <Stat label="یافت‌شده" value={formatNumber(progress.found)} tone="success" />
            <Stat label="باقیمانده" value={formatNumber(progress.remaining)} tone="warning" />
            <Stat label="خارج از محدوده" value={formatNumber(progress.unexpected)} />
            <Stat label="ناشناخته" value={formatNumber(progress.unknown)} tone="danger" />
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ── کادر اسکن ─────────────────────────────────────────────── */}
        {progress.status === 'IN_PROGRESS' && can('inventory.manage') ? (
          <div className="space-y-4 lg:col-span-2">
            <Card>
              <CardHeader title="اسکن بارکد" description="کتاب‌ها را یکی‌یکی از قفسه اسکن کنید." />
              <div className="space-y-3 p-4">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (barcode.trim()) scan.mutate(barcode.trim());
                  }}
                  className="flex gap-2"
                >
                  <div className="flex-1">
                    <Input
                      ref={inputRef}
                      value={barcode}
                      onChange={(e) => setBarcode(e.target.value)}
                      autoFocus
                      autoComplete="off"
                      ltr
                      placeholder="بارکد یا شماره ثبت"
                      aria-label="بارکد نسخه"
                      prefixIcon={<ScanBarcode className="size-4" />}
                      className="h-11 text-base"
                    />
                  </div>
                  <Button
                    type="submit"
                    variant="primary"
                    size="lg"
                    disabled={!barcode.trim()}
                    loading={scan.isPending}
                  >
                    ثبت اسکن
                  </Button>
                </form>

                {error ? (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-content"
                  >
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                    <span className="min-w-0 flex-1">{error}</span>
                  </div>
                ) : null}
              </div>
            </Card>

            <Card>
              <CardHeader
                title="اسکن‌های این نشست"
                description={`${toPersianDigits(scans.length)} اسکن`}
              />
              {scans.length > 0 ? (
                <ul className="max-h-[28rem] divide-y divide-border overflow-y-auto">
                  {scans.map((result, index) => {
                    const style = RESULT_STYLES[result.result];
                    return (
                      <li key={`${result.barcode}-${index}`} className="flex items-start gap-3 px-4 py-2.5">
                        <div
                          className={cn(
                            'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full',
                            result.result === 'FOUND'
                              ? 'bg-success text-white'
                              : result.result === 'UNKNOWN'
                                ? 'bg-danger text-white'
                                : 'bg-warning text-white',
                          )}
                        >
                          {result.result === 'FOUND' ? (
                            <Check className="size-3.5" />
                          ) : (
                            <AlertTriangle className="size-3.5" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-content">
                            {result.copy?.title ?? `بارکد ${result.barcode}`}
                          </p>
                          <p className="text-xs text-content-muted">{result.message}</p>
                          {result.copy?.expectedLocation ? (
                            <p className="mt-0.5 flex items-center gap-1 text-2xs text-content-subtle">
                              <MapPin className="size-3" />
                              محل ثبت‌شده: {result.copy.expectedLocation}
                            </p>
                          ) : null}
                        </div>
                        <Badge tone={style.tone}>{style.label}</Badge>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState
                  icon={<ScanBarcode className="size-6" />}
                  title="هنوز اسکنی ثبت نشده"
                  description="اولین کتاب را از قفسه بردارید و بارکدش را اسکن کنید."
                />
              )}
            </Card>
          </div>
        ) : (
          <div className="space-y-4 lg:col-span-2">
            {progress.status === 'DRAFT' ? (
              <Card>
                <EmptyState
                  icon={<Play className="size-6" />}
                  title="جلسه هنوز شروع نشده"
                  description="با شروع جلسه، فهرست نسخه‌های مورد انتظار ثبت می‌شود و می‌توانید اسکن را آغاز کنید."
                  action={
                    can('inventory.manage') ? (
                      <Button
                        variant="primary"
                        onClick={() => start.mutate()}
                        loading={start.isPending}
                      >
                        شروع شمارش
                      </Button>
                    ) : null
                  }
                />
              </Card>
            ) : null}

            {/* ── گزارش مغایرت ─────────────────────────────────────── */}
            {report && isDone ? (
              <>
                <Card>
                  <CardHeader
                    title="کتاب‌های یافت‌نشده"
                    description="در محدوده شمارش انتظار می‌رفتند اما اسکن نشدند"
                    action={
                      can('copies.change_status') && report.missing.length > 0 ? (
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={selectedMissing.length === 0}
                          onClick={() => setMarkLostOpen(true)}
                        >
                          مفقود اعلام کن ({toPersianDigits(selectedMissing.length)})
                        </Button>
                      ) : null
                    }
                  />
                  {report.missing.length > 0 ? (
                    <TableWrapper>
                      <thead>
                        <tr>
                          <Th className="w-10">
                            <input
                              type="checkbox"
                              aria-label="انتخاب همه کتاب‌های یافت‌نشده"
                              checked={selectedMissing.length === report.missing.length}
                              onChange={(e) =>
                                setSelectedMissing(
                                  e.target.checked ? report.missing.map((m) => m.copyId) : [],
                                )
                              }
                              className="size-4 rounded border-border-strong text-primary focus:ring-primary/30"
                            />
                          </Th>
                          <Th>شماره ثبت</Th>
                          <Th>کتاب</Th>
                          <Th>محل ثبت‌شده</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.missing.map((item) => (
                          <tr key={item.copyId} className="transition hover:bg-surface-sunken">
                            <Td>
                              <input
                                type="checkbox"
                                aria-label={`انتخاب ${item.accessionNumber}`}
                                checked={selectedMissing.includes(item.copyId)}
                                onChange={(e) =>
                                  setSelectedMissing((s) =>
                                    e.target.checked
                                      ? [...s, item.copyId]
                                      : s.filter((x) => x !== item.copyId),
                                  )
                                }
                                className="size-4 rounded border-border-strong text-primary focus:ring-primary/30"
                              />
                            </Td>
                            <Td>
                              <Link
                                to={`/copies/${item.copyId}`}
                                className="field-ltr text-xs font-medium text-content hover:text-primary hover:underline"
                              >
                                {item.accessionNumber}
                              </Link>
                            </Td>
                            <Td className="text-sm text-content">{item.title}</Td>
                            <Td className="text-xs text-content-muted">
                              {item.expectedLocation ?? '—'}
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </TableWrapper>
                  ) : (
                    <EmptyState
                      icon={<Check className="size-6" />}
                      title="همه کتاب‌های مورد انتظار پیدا شدند"
                    />
                  )}
                </Card>

                {report.moved.length > 0 ? (
                  <Card>
                    <CardHeader
                      title="کتاب‌های جابه‌جاشده"
                      description="جای دیگری پیدا شدند؛ محل ثبت‌شده در سیستم قدیمی است."
                      action={
                        can('copies.move') ? (
                          <Button size="sm" variant="primary" onClick={() => setApplyOpen(true)}>
                            اصلاح محل همه
                          </Button>
                        ) : null
                      }
                    />
                    <TableWrapper>
                      <thead>
                        <tr>
                          <Th>شماره ثبت</Th>
                          <Th>کتاب</Th>
                          <Th>محل ثبت‌شده</Th>
                          <Th>محل واقعی</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.moved.map((item) => (
                          <tr key={item.copyId} className="transition hover:bg-surface-sunken">
                            <Td>
                              <Link
                                to={`/copies/${item.copyId}`}
                                className="field-ltr text-xs font-medium text-content hover:text-primary hover:underline"
                              >
                                {item.accessionNumber}
                              </Link>
                            </Td>
                            <Td className="text-sm text-content">{item.title}</Td>
                            <Td className="text-xs text-content-muted">
                              {item.expectedLocation ?? '—'}
                            </Td>
                            <Td className="text-xs text-success-content">
                              {item.foundLocation ?? '—'}
                            </Td>
                          </tr>
                        ))}
                      </tbody>
                    </TableWrapper>
                  </Card>
                ) : null}

                {report.unknown.length > 0 ? (
                  <Card>
                    <CardHeader
                      title="بارکدهای ناشناخته"
                      description="این بارکدها در سیستم ثبت نشده‌اند — احتمالاً کتاب فهرست‌نشده"
                    />
                    <ul className="divide-y divide-border">
                      {report.unknown.map((item) => (
                        <li
                          key={item.barcode}
                          className="flex items-center justify-between gap-3 px-4 py-2"
                        >
                          <span className="field-ltr text-sm text-content">{item.barcode}</span>
                          <span className="text-2xs text-content-subtle">
                            {formatDateTime(item.scannedAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                ) : null}
              </>
            ) : null}
          </div>
        )}

        {/* ── ستون کناری ────────────────────────────────────────────── */}
        <div className="space-y-4">
          {report ? (
            <Card>
              <CardHeader title="خلاصه مغایرت" />
              <dl className="space-y-2 px-4 py-3 text-sm">
                <SummaryRow label="مورد انتظار" value={formatNumber(report.summary.expected)} />
                <SummaryRow label="اسکن‌شده" value={formatNumber(report.summary.scanned)} />
                <SummaryRow label="یافت‌شده" value={formatNumber(report.summary.found)} tone="success" />
                <SummaryRow label="یافت‌نشده" value={formatNumber(report.summary.missing)} tone="danger" />
                <SummaryRow label="جابه‌جاشده" value={formatNumber(report.summary.moved)} tone="warning" />
                <SummaryRow label="خارج از محدوده" value={formatNumber(report.summary.unexpected)} />
                <SummaryRow label="ناشناخته" value={formatNumber(report.summary.unknown)} tone="danger" />
              </dl>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="راهنمای شمارش" />
            <ul className="space-y-2 p-4 text-xs leading-relaxed text-content-muted">
              <li>کتاب‌هایی که در لحظه شمارش در امانت‌اند، «مفقود» شمرده نمی‌شوند.</li>
              <li>اسکن تکراری یک نسخه، دوباره شمرده نمی‌شود و فقط هشدار می‌دهد.</li>
              <li>می‌توانید جلسه را نیمه‌کاره رها کنید و بعداً ادامه دهید.</li>
              <li>«مفقود اعلام کردن» عملی جداگانه است و با بستن جلسه خودکار انجام نمی‌شود.</li>
            </ul>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={completeOpen}
        onClose={() => setCompleteOpen(false)}
        onConfirm={() => complete.mutate()}
        loading={complete.isPending}
        tone="primary"
        title="پایان شمارش"
        confirmLabel="بستن جلسه"
        message={
          <>
            <p>
              جلسه بسته می‌شود و گزارش مغایرت نهایی تولید می‌گردد. پس از بستن، امکان
              اسکن جدید در این جلسه وجود ندارد.
            </p>
            {progress.remaining > 0 ? (
              <p className="mt-2 rounded border border-warning/30 bg-warning-soft px-2.5 py-1.5 text-warning-content">
                {toPersianDigits(progress.remaining)} نسخه هنوز اسکن نشده‌اند و در گزارش
                «یافت‌نشده» خواهند بود.
              </p>
            ) : null}
          </>
        }
      />

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={() => cancelSession.mutate()}
        loading={cancelSession.isPending}
        title="لغو جلسه شمارش"
        confirmLabel="لغو جلسه"
        message="جلسه لغو می‌شود و اسکن‌های ثبت‌شده دیگر مبنای گزارش نخواهند بود. وضعیت هیچ نسخه‌ای تغییر نمی‌کند."
      />

      <ConfirmDialog
        open={markLostOpen}
        onClose={() => setMarkLostOpen(false)}
        onConfirm={() => markLost.mutate()}
        loading={markLost.isPending}
        title="مفقود اعلام کردن نسخه‌ها"
        confirmLabel="مفقود اعلام کن"
        message={
          <>
            <p>
              وضعیت {toPersianDigits(selectedMissing.length)} نسخه به «مفقود» تغییر می‌کند و
              از موجودی قابل امانت خارج می‌شوند.
            </p>
            <p className="mt-2 rounded border border-warning/30 bg-warning-soft px-2.5 py-1.5 text-warning-content">
              رکورد نسخه‌ها حذف نمی‌شود و تاریخچه امانتشان می‌ماند. اگر بعداً پیدا
              شدند، می‌توانید وضعیت را به «موجود» برگردانید.
            </p>
          </>
        }
      />

      <ConfirmDialog
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        onConfirm={() => applyLocations.mutate()}
        loading={applyLocations.isPending}
        tone="primary"
        title="اصلاح محل نسخه‌های جابه‌جاشده"
        confirmLabel="اصلاح کن"
        message={
          <p>
            محل ثبت‌شده {toPersianDigits(report?.moved.length ?? 0)} نسخه به محلی که در
            شمارش پیدا شدند تغییر می‌کند. این تغییر در تاریخچه جابه‌جایی هر نسخه ثبت
            می‌شود.
          </p>
        }
      />

      {progress.status === 'CANCELLED' ? (
        <Card className="mt-4">
          <EmptyState
            icon={<Square className="size-6" />}
            title="این جلسه لغو شده است"
            action={
              <Button onClick={() => navigate('/inventory')}>بازگشت به فهرست جلسات</Button>
            }
          />
        </Card>
      ) : null}
    </>
  );
}

function Stat({
  label, value, tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const colors = {
    neutral: 'text-content',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
  };
  return (
    <div className="rounded border border-border px-3 py-2">
      <p className="text-2xs text-content-muted">{label}</p>
      <p className={cn('mt-0.5 text-base font-bold', colors[tone])}>{value}</p>
    </div>
  );
}

function SummaryRow({
  label, value, tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const colors = {
    neutral: 'text-content',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
  };
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-content-muted">{label}</dt>
      <dd className={cn('font-semibold', colors[tone])}>{value}</dd>
    </div>
  );
}
