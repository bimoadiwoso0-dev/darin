import * as React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BookmarkCheck, Check, MapPin, ScanBarcode, TriangleAlert, Undo2, Wallet, X,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import {
  Badge, Button, Card, CardHeader, EmptyState, Input, Spinner, cn,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { formatDate, formatDateTime, formatMoney, toPersianDigits } from '@/lib/format';

interface ReturnResult {
  loanId: string;
  loanNumber: string;
  bookTitle: string;
  copyBarcode: string;
  returnedAt: string;
  wasOverdue: boolean;
  overdueDays: number;
  fine: { id: string; amount: number } | null;
  heldForReservation: {
    reservationId: string; memberName: string; memberCode: string; expiresAt: string;
  } | null;
  shelfLocation: string | null;
}

/**
 * ثبت بازگشت (قوانین ۲۳، ۲۴، ۹۰).
 *
 * ── یک اسکن، تمام ─────────────────────────────────────────────────────────
 * کتابدار نباید اول عضو را پیدا کند بعد کتاب را. بارکد کتاب یکتاست و
 * سیستم خودش امانت باز آن را می‌یابد. صف کتاب‌های برگشتی معمولاً بلند است
 * و هر حرکت اضافه در آن ضرب می‌شود.
 *
 * ── چرا سیاهه نتایج می‌ماند ──────────────────────────────────────────────
 * کتابدار ده کتاب پشت‌سرهم اسکن می‌کند. اگر هر نتیجه جای قبلی را بگیرد،
 * نمی‌فهمد کدام کتاب جریمه داشت یا کدام باید کنار گذاشته شود. سیاهه
 * می‌ماند تا آخر کار مرور شود.
 *
 * ── سه چیز مهم پس از بازگشت ─────────────────────────────────────────────
 *   ۱. جریمه دیرکرد (اگر باشد) — باید به عضو گفته شود
 *   ۲. رزرو در انتظار — کتاب باید کنار گذاشته شود، نه به قفسه برود
 *   ۳. محل قفسه — کتابدار باید بداند کجا بگذاردش
 * هر سه در همان کارت نتیجه و با رنگ متمایز نشان داده می‌شوند.
 */
export function ReturnsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [barcode, setBarcode] = React.useState('');
  const [damaged, setDamaged] = React.useState(false);
  const [results, setResults] = React.useState<ReturnResult[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const submit = useMutation({
    mutationFn: (value: string) =>
      api.post<ReturnResult>('/loans/return', {
        barcode: value,
        condition: damaged ? 'DAMAGED' : 'GOOD',
      }),
    onSuccess: (result) => {
      setResults((r) => [result, ...r]);
      setBarcode('');
      setError(null);
      setDamaged(false);
      void queryClient.invalidateQueries({ queryKey: ['loans'] });
      void queryClient.invalidateQueries({ queryKey: ['copies'] });
      void queryClient.invalidateQueries({ queryKey: ['members'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });

      if (result.heldForReservation) {
        toast.warning(
          'این کتاب رزرو دارد',
          `برای ${result.heldForReservation.memberName} کنار گذاشته شد — به قفسه برنگردانید.`,
        );
      } else if (result.fine) {
        toast.warning(
          'بازگشت با دیرکرد ثبت شد',
          `${toPersianDigits(result.overdueDays)} روز دیرکرد — جریمه ${formatMoney(result.fine.amount)}`,
        );
      } else {
        toast.success('بازگشت ثبت شد', result.bookTitle);
      }
      inputRef.current?.focus();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'ثبت بازگشت انجام نشد.');
      setBarcode('');
      inputRef.current?.focus();
    },
  });

  const totalFines = results.reduce((sum, r) => sum + (r.fine?.amount ?? 0), 0);
  const heldCount = results.filter((r) => r.heldForReservation).length;

  return (
    <>
      <PageHeader
        title="ثبت بازگشت"
        description="بارکد کتاب را اسکن کنید — نیازی به انتخاب عضو نیست."
        actions={
          results.length > 0 ? (
            <Button variant="ghost" onClick={() => setResults([])} icon={<X className="size-4" />}>
              پاک کردن سیاهه
            </Button>
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title="اسکن بارکد" />
            <div className="space-y-3 p-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (barcode.trim()) submit.mutate(barcode.trim());
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
                    placeholder="بارکد، شماره ثبت یا کد کتابخانه"
                    aria-label="بارکد کتاب بازگشتی"
                    prefixIcon={<ScanBarcode className="size-4" />}
                    suffix={submit.isPending ? <Spinner className="size-3.5" /> : undefined}
                    className="h-11 text-base"
                  />
                </div>
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  disabled={!barcode.trim()}
                  loading={submit.isPending}
                  icon={<Undo2 className="size-5" />}
                >
                  ثبت بازگشت
                </Button>
              </form>

              <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-content-muted">
                <input
                  type="checkbox"
                  checked={damaged}
                  onChange={(e) => setDamaged(e.target.checked)}
                  className="size-4 rounded border-border-strong text-danger focus:ring-danger/30"
                />
                این نسخه آسیب دیده است
                {damaged ? (
                  <Badge tone="danger">وضعیت نسخه «آسیب‌دیده» ثبت می‌شود</Badge>
                ) : null}
              </label>

              {error ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-content"
                >
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 flex-1">{error}</span>
                  <button
                    type="button"
                    onClick={() => setError(null)}
                    aria-label="بستن خطا"
                    className="rounded p-0.5"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : null}
            </div>
          </Card>

          {/* ── سیاهه بازگشت‌های این نشست ─────────────────────────── */}
          <div className="mt-4 space-y-2">
            {results.length === 0 ? (
              <Card>
                <EmptyState
                  icon={<Undo2 className="size-6" />}
                  title="هنوز بازگشتی ثبت نشده"
                  description="کتاب‌های برگشتی را یکی‌یکی اسکن کنید؛ نتیجه هرکدام اینجا می‌ماند."
                />
              </Card>
            ) : (
              results.map((result) => (
                <ReturnCard key={`${result.loanId}-${result.returnedAt}`} result={result} />
              ))
            )}
          </div>
        </div>

        {/* ── خلاصه نشست ────────────────────────────────────────────── */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="خلاصه این نشست" />
            <dl className="space-y-2 px-4 py-3 text-sm">
              <div className="flex items-baseline justify-between">
                <dt className="text-content-muted">کتاب دریافت‌شده</dt>
                <dd className="font-semibold text-content">{toPersianDigits(results.length)}</dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-content-muted">جریمه ثبت‌شده</dt>
                <dd className={cn('font-semibold', totalFines > 0 ? 'text-danger' : 'text-content')}>
                  {totalFines > 0 ? formatMoney(totalFines) : '—'}
                </dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-content-muted">کنارگذاشته برای رزرو</dt>
                <dd className={cn('font-semibold', heldCount > 0 ? 'text-warning' : 'text-content')}>
                  {toPersianDigits(heldCount)}
                </dd>
              </div>
            </dl>
          </Card>

          {heldCount > 0 ? (
            <Card className="border-warning/40">
              <CardHeader
                title="کنار گذاشته شود"
                description="این کتاب‌ها را به قفسه برنگردانید"
              />
              <ul className="divide-y divide-border">
                {results
                  .filter((r) => r.heldForReservation)
                  .map((r) => (
                    <li key={r.loanId} className="px-4 py-2.5">
                      <p className="truncate text-sm text-content">{r.bookTitle}</p>
                      <p className="mt-0.5 text-xs text-warning-content">
                        برای {r.heldForReservation?.memberName} ({r.heldForReservation?.memberCode})
                      </p>
                      <p className="mt-0.5 text-2xs text-content-subtle">
                        مهلت تحویل تا {formatDate(r.heldForReservation?.expiresAt)}
                      </p>
                    </li>
                  ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

function ReturnCard({ result }: { result: ReturnResult }) {
  const tone = result.heldForReservation
    ? 'border-warning/40'
    : result.wasOverdue
      ? 'border-danger/30'
      : 'border-success/30';

  return (
    <Card className={tone}>
      <div className="flex items-start gap-3 p-3.5">
        <div
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full text-white',
            result.heldForReservation
              ? 'bg-warning'
              : result.wasOverdue
                ? 'bg-danger'
                : 'bg-success',
          )}
        >
          {result.heldForReservation ? (
            <BookmarkCheck className="size-4" />
          ) : (
            <Check className="size-4" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-content">{result.bookTitle}</p>
          <p className="field-ltr text-xs text-content-muted">{result.copyBarcode}</p>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {result.wasOverdue ? (
              <Badge tone="danger">
                {toPersianDigits(result.overdueDays)} روز دیرکرد
              </Badge>
            ) : (
              <Badge tone="success">به‌موقع</Badge>
            )}

            {result.fine ? (
              <Badge tone="danger" icon={<Wallet className="size-3" />}>
                جریمه {formatMoney(result.fine.amount)}
              </Badge>
            ) : null}

            {result.shelfLocation && !result.heldForReservation ? (
              <Badge tone="neutral" icon={<MapPin className="size-3" />}>
                {result.shelfLocation}
              </Badge>
            ) : null}
          </div>

          {result.heldForReservation ? (
            <div className="mt-2 rounded border border-warning/30 bg-warning-soft px-2.5 py-1.5 text-xs text-warning-content">
              این کتاب برای{' '}
              <span className="font-medium">{result.heldForReservation.memberName}</span> (
              {result.heldForReservation.memberCode}) رزرو شده است. آن را در قفسه رزروها
              بگذارید — مهلت تحویل تا {formatDate(result.heldForReservation.expiresAt)}.
            </div>
          ) : null}
        </div>

        <div className="shrink-0 text-end">
          <Link
            to={`/loans/${result.loanId}`}
            className="text-2xs text-content-subtle hover:text-primary hover:underline"
          >
            {result.loanNumber}
          </Link>
          <p className="mt-0.5 text-2xs text-content-subtle">
            {formatDateTime(result.returnedAt)}
          </p>
        </div>
      </div>
    </Card>
  );
}
