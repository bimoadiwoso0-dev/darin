import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, BookOpen, Check, ScanBarcode, Trash2, TriangleAlert, User, X,
} from 'lucide-react';
import { COPY_STATUS, MEMBER_STATUS } from '@darin/shared';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import {
  Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal,
  Spinner, cn,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { MemberQuickSearch } from '@/components/circulation/MemberQuickSearch';
import { formatDate, formatMoney, formatRelative, toPersianDigits } from '@/lib/format';

interface MemberSummary {
  id: string; memberCode: string; firstName: string; lastName: string; fullName: string;
  mobile: string | null; status: string; expiresAt: string | null; activeLoans: number;
}

interface Eligibility {
  policy: {
    maxLoans: number; loanDays: number; maxRenewals: number;
    maxReservations: number; dailyFineAmount: number; canReserve: boolean;
  };
  violations: Array<{ code: string; message: string; overridable: boolean }>;
  canProceed: boolean;
  canOverride: boolean;
}

interface ScannedCopy {
  id: string; barcode: string; accessionNumber: string; status: string; isLoanable: boolean;
  positionCode: string | null;
  book: { id: string; title: string; volumeTitle: string | null; volumeNumber: number | null };
  location: { id: string; name: string; fullCode: string } | null;
  currentLoan: {
    id: string; dueAt: string; renewalCount: number; status: string;
    member: { id: string; firstName: string; lastName: string; memberCode: string };
  } | null;
}

interface CheckoutResult {
  batchId: string;
  loans: Array<{
    id: string; loanNumber: string; dueAt: string;
    copy: { id: string; barcode: string; accessionNumber: string };
    book: { id: string; title: string };
  }>;
  warnings: string[];
}

/**
 * میز امانت (قوانین ۱۹، ۲۰، ۸۹، ۹۰، ۱۲۰).
 *
 * ── جریان کار واقعی کتابدار ─────────────────────────────────────────────
 * عضو جلوی میز می‌ایستد و چند کتاب روی پیشخوان می‌گذارد. کتابدار:
 *   ۱. کارت عضو را اسکن یا نامش را تایپ می‌کند
 *   ۲. بارکد کتاب‌ها را پشت‌سرهم اسکن می‌کند
 *   ۳. یک بار تأیید می‌کند
 * صفحه دقیقاً همین سه گام است. تمرکز پس از انتخاب عضو خودکار به کادر
 * بارکد می‌رود تا دست کتابدار از اسکنر جدا نشود.
 *
 * ── چرا سبد پیش از ثبت ──────────────────────────────────────────────────
 * ثبت جداگانه هر کتاب یعنی اگر کتاب سوم مشکل داشته باشد، دو کتاب اول
 * ثبت شده‌اند و باید دستی برگردانده شوند. سبد به کتابدار اجازه می‌دهد
 * قبل از ثبت، فهرست را ببیند و اصلاح کند.
 *
 * ── هشدارها مانع نیستند مگر آنکه باید باشند ─────────────────────────────
 * سرور برای هر تخلف قانون می‌گوید قابل عبور هست یا نه. «سقف امانت پر شده»
 * با مجوز مدیر قابل عبور است؛ «این نسخه برای عضو دیگری کنار گذاشته شده»
 * نیست — چون حق کسی است که در صف بوده.
 */
export function CirculationDeskPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [memberId, setMemberId] = React.useState<string | null>(searchParams.get('memberId'));
  const [cart, setCart] = React.useState<ScannedCopy[]>([]);
  const [barcodeInput, setBarcodeInput] = React.useState('');
  const [scanError, setScanError] = React.useState<string | null>(null);
  const [scanning, setScanning] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [customDays, setCustomDays] = React.useState('');
  const [overrideOpen, setOverrideOpen] = React.useState(false);
  const [result, setResult] = React.useState<CheckoutResult | null>(null);

  const barcodeRef = React.useRef<HTMLInputElement>(null);

  const { data: member } = useQuery({
    queryKey: ['members', memberId, 'summary'],
    queryFn: () => api.get<MemberSummary>(`/members/${memberId}`),
    enabled: !!memberId,
  });

  const { data: eligibility } = useQuery({
    queryKey: ['loans', 'eligibility', memberId, cart.length],
    queryFn: () =>
      api.get<Eligibility>(`/loans/eligibility/${memberId}`, { items: Math.max(cart.length, 1) }),
    enabled: !!memberId,
  });

  // پس از انتخاب عضو، تمرکز خودکار به کادر بارکد (قانون ۱۲۰)
  React.useEffect(() => {
    if (memberId) barcodeRef.current?.focus();
  }, [memberId]);

  const addBarcode = async (raw: string) => {
    const barcode = raw.trim();
    if (!barcode) return;

    setScanError(null);

    // نسخه‌ای که همین حالا در سبد است، دوباره افزوده نمی‌شود
    if (cart.some((c) => c.barcode === barcode || c.accessionNumber === barcode)) {
      setScanError('این نسخه هم‌اکنون در فهرست امانت است.');
      setBarcodeInput('');
      return;
    }

    setScanning(true);
    try {
      const copy = await api.get<ScannedCopy>(`/copies/by-barcode/${encodeURIComponent(barcode)}`);

      if (copy.currentLoan) {
        setScanError(
          `این نسخه هم‌اکنون نزد ${copy.currentLoan.member.firstName} ${copy.currentLoan.member.lastName} است (موعد ${formatDate(copy.currentLoan.dueAt)}). ابتدا آن را دریافت کنید.`,
        );
        setBarcodeInput('');
        return;
      }

      if (!copy.isLoanable) {
        setScanError('این نسخه قابل امانت نیست (نسخه مرجع یا سالن مطالعه).');
        setBarcodeInput('');
        return;
      }

      if (copy.status !== 'AVAILABLE' && copy.status !== 'RESERVED_HOLD') {
        setScanError(
          `وضعیت این نسخه «${COPY_STATUS[copy.status as keyof typeof COPY_STATUS] ?? copy.status}» است و قابل امانت نیست.`,
        );
        setBarcodeInput('');
        return;
      }

      setCart((c) => [...c, copy]);
      setBarcodeInput('');
    } catch (error) {
      setScanError(error instanceof ApiError ? error.message : 'نسخه یافت نشد.');
      setBarcodeInput('');
    } finally {
      setScanning(false);
      barcodeRef.current?.focus();
    }
  };

  const checkout = useMutation({
    mutationFn: (override: boolean) =>
      api.post<CheckoutResult>('/loans/checkout', {
        memberId,
        copyIds: cart.map((c) => c.id),
        loanDays: customDays ? Number(customDays) : undefined,
        note: note.trim() || undefined,
        override,
      }),
    onSuccess: (data) => {
      setResult(data);
      setCart([]);
      setNote('');
      setCustomDays('');
      setOverrideOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['members'] });
      void queryClient.invalidateQueries({ queryKey: ['copies'] });
      void queryClient.invalidateQueries({ queryKey: ['loans'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      toast.success(
        `${toPersianDigits(data.loans.length)} کتاب امانت داده شد`,
        data.loans[0] ? `موعد بازگشت: ${formatDate(data.loans[0].dueAt)}` : undefined,
      );
    },
    onError: (error) => {
      // سرور می‌گوید کدام تخلف‌ها با مجوز قابل عبورند
      if (error instanceof ApiError && error.isOverridable) {
        setOverrideOpen(true);
        return;
      }
      toast.apiError(error, 'ثبت امانت انجام نشد');
    },
  });

  const reset = () => {
    setMemberId(null);
    setCart([]);
    setNote('');
    setCustomDays('');
    setResult(null);
    setScanError(null);
  };

  const blockingViolations = eligibility?.violations.filter((v) => !v.overridable) ?? [];
  const warningViolations = eligibility?.violations.filter((v) => v.overridable) ?? [];
  const canSubmit = !!memberId && cart.length > 0 && blockingViolations.length === 0;

  return (
    <>
      <PageHeader
        title="میز امانت"
        description="کارت عضو را اسکن کنید، سپس بارکد کتاب‌ها را پشت‌سرهم بزنید."
        actions={
          memberId ? (
            <Button variant="ghost" onClick={reset} icon={<X className="size-4" />}>
              شروع دوباره
            </Button>
          ) : null
        }
      />

      {/* ── نتیجه آخرین امانت ─────────────────────────────────────────── */}
      {result ? (
        <Card className="mb-4 border-success/40">
          <div className="flex items-start gap-3 p-4">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success text-white">
              <Check className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-content">
                {toPersianDigits(result.loans.length)} کتاب با موفقیت امانت داده شد
              </p>
              <ul className="mt-2 space-y-1">
                {result.loans.map((loan) => (
                  <li key={loan.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <Link
                      to={`/books/${loan.book.id}`}
                      className="text-content hover:text-primary hover:underline"
                    >
                      {loan.book.title}
                    </Link>
                    <span className="field-ltr text-content-subtle">{loan.copy.barcode}</span>
                    <Badge tone="success">موعد {formatDate(loan.dueAt)}</Badge>
                  </li>
                ))}
              </ul>
              {result.warnings.length > 0 ? (
                <div className="mt-2 rounded border border-warning/30 bg-warning-soft px-2.5 py-1.5 text-xs text-warning-content">
                  {result.warnings.map((w) => <p key={w}>{w}</p>)}
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setResult(null)}
              aria-label="بستن"
              className="rounded p-1 text-content-subtle hover:text-content"
            >
              <X className="size-4" />
            </button>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* ── گام ۱: انتخاب عضو ──────────────────────────────────── */}
          <Card>
            <CardHeader
              title="گام ۱ — انتخاب عضو"
              description="کد عضویت، نام یا شماره موبایل"
              action={member ? <Badge tone="success">انتخاب شد</Badge> : null}
            />
            <div className="p-4">
              {member ? (
                <div className="flex flex-wrap items-center gap-3 rounded border border-border bg-surface-sunken p-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
                    <User className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/members/${member.id}`}
                      className="text-sm font-medium text-content hover:text-primary hover:underline"
                    >
                      {member.fullName}
                    </Link>
                    <p className="field-ltr text-xs text-content-muted">{member.memberCode}</p>
                  </div>
                  <Badge tone={member.status === 'ACTIVE' ? 'success' : 'danger'}>
                    {MEMBER_STATUS[member.status as keyof typeof MEMBER_STATUS] ?? member.status}
                  </Badge>
                  <Button variant="ghost" size="sm" onClick={() => { setMemberId(null); setCart([]); }}>
                    تغییر عضو
                  </Button>
                </div>
              ) : (
                <MemberQuickSearch onSelect={(selectedId) => setMemberId(selectedId)} autoFocus />
              )}
            </div>
          </Card>

          {/* ── گام ۲: اسکن کتاب‌ها ────────────────────────────────── */}
          <Card className={!memberId ? 'opacity-50' : undefined}>
            <CardHeader
              title="گام ۲ — اسکن کتاب‌ها"
              description="بارکد، شماره ثبت یا کد کتابخانه"
              action={
                cart.length > 0 ? (
                  <Badge tone="primary">{toPersianDigits(cart.length)} کتاب</Badge>
                ) : null
              }
            />
            <div className="space-y-3 p-4">
              <form
                onSubmit={(e) => { e.preventDefault(); void addBarcode(barcodeInput); }}
                className="flex gap-2"
              >
                <div className="flex-1">
                  <Input
                    ref={barcodeRef}
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    disabled={!memberId}
                    ltr
                    autoComplete="off"
                    placeholder="بارکد را اسکن کنید یا تایپ کنید و Enter بزنید"
                    aria-label="بارکد کتاب"
                    prefixIcon={<ScanBarcode className="size-4" />}
                    suffix={scanning ? <Spinner className="size-3.5" /> : undefined}
                  />
                </div>
                <Button type="submit" disabled={!memberId || !barcodeInput.trim()} loading={scanning}>
                  افزودن
                </Button>
              </form>

              {scanError ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-content"
                >
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 flex-1">{scanError}</span>
                  <button
                    type="button"
                    onClick={() => setScanError(null)}
                    aria-label="بستن خطا"
                    className="rounded p-0.5"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ) : null}

              {cart.length > 0 ? (
                <ul className="divide-y divide-border rounded border border-border">
                  {cart.map((copy, index) => (
                    <li key={copy.id} className="flex items-center gap-3 px-3 py-2.5">
                      <span className="w-5 shrink-0 text-center text-xs text-content-subtle">
                        {toPersianDigits(index + 1)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-content">
                          {copy.book.title}
                          {copy.book.volumeNumber
                            ? ` (جلد ${toPersianDigits(copy.book.volumeNumber)})`
                            : ''}
                        </p>
                        <p className="field-ltr truncate text-xs text-content-muted">
                          {copy.barcode} · {copy.accessionNumber}
                          {copy.location ? ` · ${copy.location.fullCode}` : ''}
                        </p>
                      </div>
                      {copy.status === 'RESERVED_HOLD' ? (
                        <Badge tone="info">کنارگذاشته‌شده برای رزرو</Badge>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`حذف ${copy.book.title} از فهرست`}
                        onClick={() => setCart((c) => c.filter((x) => x.id !== copy.id))}
                        icon={<Trash2 className="size-4" />}
                        className="shrink-0 text-content-subtle hover:text-danger"
                      />
                    </li>
                  ))}
                </ul>
              ) : memberId ? (
                <EmptyState
                  icon={<ScanBarcode className="size-6" />}
                  title="هنوز کتابی اسکن نشده"
                  description="بارکد کتاب‌ها را یکی‌یکی اسکن کنید."
                  className="py-8"
                />
              ) : (
                <EmptyState
                  icon={<User className="size-6" />}
                  title="ابتدا عضو را انتخاب کنید"
                  className="py-8"
                />
              )}
            </div>
          </Card>

          {/* ── گام ۳: تأیید ───────────────────────────────────────── */}
          {cart.length > 0 ? (
            <Card>
              <CardHeader title="گام ۳ — تأیید و ثبت" />
              <div className="space-y-4 p-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="مدت امانت (روز)"
                    hint={
                      eligibility
                        ? `پیش‌فرض این عضو: ${toPersianDigits(eligibility.policy.loanDays)} روز`
                        : undefined
                    }
                  >
                    <Input
                      type="number" min={1} max={365} ltr value={customDays}
                      onChange={(e) => setCustomDays(e.target.value)}
                      placeholder={
                        eligibility ? String(eligibility.policy.loanDays) : 'پیش‌فرض'
                      }
                    />
                  </Field>

                  <Field label="یادداشت" hint="در سابقه امانت ثبت می‌شود.">
                    <Input value={note} onChange={(e) => setNote(e.target.value)} />
                  </Field>
                </div>

                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  onClick={() => checkout.mutate(false)}
                  loading={checkout.isPending}
                  disabled={!canSubmit}
                  icon={<BookOpen className="size-5" />}
                >
                  ثبت امانت {toPersianDigits(cart.length)} کتاب
                </Button>

                {blockingViolations.length > 0 ? (
                  <p className="text-center text-xs text-danger">
                    تا رفع مشکلات بالا امکان ثبت امانت وجود ندارد.
                  </p>
                ) : null}
              </div>
            </Card>
          ) : null}
        </div>

        {/* ── ستون کناری: وضعیت عضو ─────────────────────────────────── */}
        <div className="space-y-4">
          {member && eligibility ? (
            <>
              {blockingViolations.length > 0 || warningViolations.length > 0 ? (
                <Card
                  className={
                    blockingViolations.length > 0 ? 'border-danger/40' : 'border-warning/40'
                  }
                >
                  <CardHeader
                    title={blockingViolations.length > 0 ? 'مانع امانت' : 'هشدار'}
                    description={
                      blockingViolations.length > 0
                        ? 'این موارد باید برطرف شوند.'
                        : 'با مجوز مدیر قابل عبور است.'
                    }
                  />
                  <ul className="divide-y divide-border">
                    {blockingViolations.map((v) => (
                      <li key={v.code} className="flex items-start gap-2 px-4 py-2.5">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" />
                        <span className="text-xs leading-relaxed text-content">{v.message}</span>
                      </li>
                    ))}
                    {warningViolations.map((v) => (
                      <li key={v.code} className="flex items-start gap-2 px-4 py-2.5">
                        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                        <span className="text-xs leading-relaxed text-content">{v.message}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : (
                <Card className="border-success/40">
                  <div className="flex items-center gap-2 p-4 text-sm text-success-content">
                    <Check className="size-4 shrink-0 text-success" />
                    این عضو مانعی برای امانت گرفتن ندارد.
                  </div>
                </Card>
              )}

              <Card>
                <CardHeader title="وضعیت عضو" />
                <dl className="space-y-2 px-4 py-3 text-xs">
                  <Row
                    label="امانت‌های جاری"
                    value={`${toPersianDigits(member.activeLoans)} از ${toPersianDigits(eligibility.policy.maxLoans)}`}
                    tone={member.activeLoans >= eligibility.policy.maxLoans ? 'danger' : 'normal'}
                  />
                  <Row
                    label="مدت امانت"
                    value={`${toPersianDigits(eligibility.policy.loanDays)} روز`}
                  />
                  <Row
                    label="جریمه روزانه دیرکرد"
                    value={formatMoney(eligibility.policy.dailyFineAmount)}
                  />
                  <Row
                    label="انقضای عضویت"
                    value={
                      member.expiresAt
                        ? `${formatDate(member.expiresAt)} (${formatRelative(member.expiresAt)})`
                        : 'بدون انقضا'
                    }
                    tone={
                      member.expiresAt && new Date(member.expiresAt) < new Date()
                        ? 'danger'
                        : 'normal'
                    }
                  />
                </dl>
                <div className="border-t border-border p-3">
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => navigate(`/members/${member.id}`)}
                  >
                    مشاهده پروفایل کامل
                  </Button>
                </div>
              </Card>
            </>
          ) : (
            <Card>
              <EmptyState
                icon={<User className="size-6" />}
                title="عضوی انتخاب نشده"
                description="پس از انتخاب عضو، وضعیت و قوانین او اینجا نمایش داده می‌شود."
              />
            </Card>
          )}
        </div>
      </div>

      <OverrideDialog
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        violations={warningViolations}
        loading={checkout.isPending}
        onConfirm={() => checkout.mutate(true)}
      />
    </>
  );
}

function Row({
  label, value, tone = 'normal',
}: {
  label: string;
  value: string;
  tone?: 'normal' | 'danger';
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-content-muted">{label}</dt>
      <dd className={cn('font-medium', tone === 'danger' ? 'text-danger' : 'text-content')}>
        {value}
      </dd>
    </div>
  );
}

/**
 * تأیید عبور از محدودیت (قانون ۲۲).
 *
 * سرور تخلف را رد کرده اما گفته «قابل عبور». اینجا کتابدار صریحاً و آگاهانه
 * تأیید می‌کند؛ این تصمیم در گزارش فعالیت‌ها با نام او ثبت می‌شود.
 */
function OverrideDialog({
  open, onClose, violations, loading, onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  violations: Array<{ code: string; message: string }>;
  loading: boolean;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="عبور از محدودیت"
      description="این تصمیم با نام شما در گزارش فعالیت‌ها ثبت می‌شود."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>انصراف</Button>
          <Button variant="danger" onClick={onConfirm} loading={loading}>
            تأیید و ثبت امانت
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-content-muted">
          محدودیت‌های زیر رعایت نشده‌اند اما با مجوز شما قابل عبورند:
        </p>
        <ul className="space-y-1.5">
          {violations.map((v) => (
            <li
              key={v.code}
              className="flex items-start gap-2 rounded border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-content"
            >
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {v.message}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
