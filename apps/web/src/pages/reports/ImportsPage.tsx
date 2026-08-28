import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Check, CheckCircle2, FileSpreadsheet, Play, Upload, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import {
  Badge, Button, Card, CardHeader, EmptyState, Field, Select, Skeleton,
  TableWrapper, Td, Th, cn,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { LocationSelect } from '@/components/shared/LocationSelect';
import { formatDateTime, formatNumber, toPersianDigits } from '@/lib/format';

interface ImportField {
  key: string;
  label: string;
  required: boolean;
  hint?: string;
  aliases: string[];
}

interface UploadResult {
  jobId: string;
  headers: string[];
  // سرور هر سلول را با `cellToString` به رشته تبدیل می‌کند؛ `unknown`
  // اینجا فقط باعث می‌شد نمایش به `String(…)` تکیه کند و در حالت مرزی
  // «[object Object]» چاپ شود.
  sampleRows: Array<Record<string, string>>;
  totalRows: number;
  suggestedMapping: Record<string, string>;
  availableFields: ImportField[];
}

interface ValidationSummary {
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;
  errors: Array<{ rowNumber: number; column: string | null; message: string; sample?: string }>;
  duplicates: Array<{ rowNumber: number; title: string; reason: string; existingId: string }>;
}

interface ImportJob {
  id: string; type: string; status: string; originalName: string;
  totalRows: number; importedRows: number; errorRows: number; duplicateRows: number;
  createdAt: string; completedAt: string | null;
}

type Step = 'upload' | 'mapping' | 'validate' | 'done';

const STEPS: Array<{ key: Step; title: string }> = [
  { key: 'upload', title: 'آپلود فایل' },
  { key: 'mapping', title: 'نگاشت ستون‌ها' },
  { key: 'validate', title: 'بررسی و اصلاح' },
  { key: 'done', title: 'اجرا' },
];

/**
 * ورود اطلاعات از Excel (قوانین ۳۶، ۹۸).
 *
 * ── چرا چهار مرحله و نه یک دکمه ─────────────────────────────────────────
 * کتابخانه شما ۱۰٬۰۰۰ رکورد در یک فایل Excel دارد که سال‌ها دست‌به‌دست
 * شده: ستون‌ها نام دلخواه دارند، بعضی ردیف‌ها ناقص‌اند و بعضی تکراری.
 * یک دکمه «وارد کن» یا همه را رد می‌کند یا آشغال وارد دیتابیس می‌کند.
 *
 * مرحله «بررسی» حیاتی است: کل فایل بدون نوشتن حتی یک ردیف در دیتابیس
 * بررسی می‌شود و خطاها با **شماره ردیف** گزارش می‌شوند تا کاربر بتواند
 * فایل را در Excel اصلاح کند و دوباره بیاورد.
 */
export function ImportsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [step, setStep] = React.useState<Step>('upload');
  const [upload, setUpload] = React.useState<UploadResult | null>(null);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [validation, setValidation] = React.useState<ValidationSummary | null>(null);
  const [skipDuplicates, setSkipDuplicates] = React.useState(true);
  const [defaultLocationId, setDefaultLocationId] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ imported: number; skipped: number; failed: number } | null>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const { data: history } = useQuery({
    queryKey: ['imports', 'history'],
    queryFn: () => api.get<ImportJob[]>('/imports', { limit: 10 }),
  });

  const uploadFile = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('type', 'BOOKS');
      return api.upload<UploadResult>('/imports/upload', formData);
    },
    onSuccess: (data) => {
      setUpload(data);
      setMapping(data.suggestedMapping);
      setStep('mapping');
      const mapped = Object.keys(data.suggestedMapping).length;
      toast.success(
        `فایل خوانده شد — ${toPersianDigits(data.totalRows)} ردیف`,
        `${toPersianDigits(mapped)} ستون از ${toPersianDigits(data.headers.length)} ستون خودکار تشخیص داده شد.`,
      );
    },
    onError: (error) => toast.apiError(error, 'خواندن فایل انجام نشد'),
  });

  const saveMapping = useMutation({
    mutationFn: () => api.post(`/imports/${upload?.jobId}/mapping`, { mapping }),
    onSuccess: () => validate.mutate(),
    onError: (error) => toast.apiError(error, 'ثبت نگاشت انجام نشد'),
  });

  const validate = useMutation({
    mutationFn: () => api.post<ValidationSummary>(`/imports/${upload?.jobId}/validate`),
    onSuccess: (summary) => {
      setValidation(summary);
      setStep('validate');
      if (summary.errorRows > 0) {
        toast.warning(
          `${toPersianDigits(summary.errorRows)} ردیف مشکل دارد`,
          'ردیف‌های سالم همچنان قابل ورودند؛ ردیف‌های خطادار وارد نمی‌شوند.',
        );
      } else {
        toast.success('فایل بدون خطاست', 'می‌توانید ورود اطلاعات را اجرا کنید.');
      }
    },
    onError: (error) => toast.apiError(error, 'اعتبارسنجی انجام نشد'),
  });

  const execute = useMutation({
    mutationFn: () =>
      api.post<{ imported: number; skipped: number; failed: number }>(
        `/imports/${upload?.jobId}/execute`,
        { skipDuplicates, defaultLocationId },
      ),
    onSuccess: (data) => {
      setResult(data);
      setStep('done');
      void queryClient.invalidateQueries({ queryKey: ['imports'] });
      void queryClient.invalidateQueries({ queryKey: ['books'] });
      void queryClient.invalidateQueries({ queryKey: ['copies'] });
      toast.success(
        `${toPersianDigits(data.imported)} رکورد وارد شد`,
        data.failed > 0
          ? `${toPersianDigits(data.failed)} ردیف با خطا رد شد.`
          : undefined,
      );
    },
    onError: (error) => toast.apiError(error, 'اجرای ورود اطلاعات انجام نشد'),
  });

  const reset = () => {
    setStep('upload');
    setUpload(null);
    setMapping({});
    setValidation(null);
    setResult(null);
  };

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const ok = /\.(xlsx|xlsm|csv)$/i.test(file.name);
    if (!ok) {
      toast.error('قالب فایل پشتیبانی نمی‌شود', 'فقط xlsx، xlsm و csv پذیرفته می‌شوند.');
      return;
    }
    uploadFile.mutate(file);
  };

  /** فیلدهای الزامی که هنوز به هیچ ستونی وصل نشده‌اند. */
  const missingRequired = React.useMemo(() => {
    if (!upload) return [];
    const mapped = new Set(Object.values(mapping));
    return upload.availableFields.filter((f) => f.required && !mapped.has(f.key));
  }, [upload, mapping]);

  const currentStepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <>
      <PageHeader
        title="ورود اطلاعات از Excel"
        description="فهرست کتاب‌های موجود را از فایل Excel یا CSV به سامانه بیاورید."
        actions={
          step !== 'upload' ? (
            <Button variant="ghost" onClick={reset} icon={<X className="size-4" />}>
              شروع دوباره
            </Button>
          ) : null
        }
      />

      {/* ── نوار گام‌ها ──────────────────────────────────────────────── */}
      <ol className="mb-4 flex items-center gap-2" aria-label="مراحل ورود اطلاعات">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex flex-1 items-center gap-2">
            <div
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                i < currentStepIndex && 'border-success bg-success text-white',
                i === currentStepIndex && 'border-primary bg-primary text-primary-content',
                i > currentStepIndex && 'border-border bg-surface text-content-subtle',
              )}
              aria-current={i === currentStepIndex ? 'step' : undefined}
            >
              {i < currentStepIndex ? <Check className="size-3.5" /> : toPersianDigits(i + 1)}
            </div>
            <span
              className={cn(
                'hidden truncate text-xs sm:block',
                i === currentStepIndex ? 'font-medium text-content' : 'text-content-subtle',
              )}
            >
              {s.title}
            </span>
            {i < STEPS.length - 1 ? (
              <div className={cn('h-px flex-1', i < currentStepIndex ? 'bg-success' : 'bg-border')} />
            ) : null}
          </li>
        ))}
      </ol>

      {/* ── گام ۱: آپلود ────────────────────────────────────────────── */}
      {step === 'upload' ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="انتخاب فایل" description="xlsx، xlsm یا csv — حداکثر ۵۰ مگابایت" />
            <div className="p-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  onFile(e.dataTransfer.files[0]);
                }}
                className={cn(
                  'flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition',
                  dragOver ? 'border-primary bg-primary-soft' : 'border-border bg-surface-sunken',
                )}
              >
                <FileSpreadsheet className="mb-3 size-10 text-content-subtle" />
                <p className="text-sm text-content">فایل را اینجا رها کنید</p>
                <p className="mt-1 text-xs text-content-muted">یا از دکمه زیر انتخاب کنید</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xlsm,.csv"
                  onChange={(e) => onFile(e.target.files?.[0])}
                  className="hidden"
                />
                <Button
                  variant="primary"
                  className="mt-4"
                  onClick={() => fileRef.current?.click()}
                  loading={uploadFile.isPending}
                  icon={<Upload className="size-4" />}
                >
                  انتخاب فایل
                </Button>
              </div>

              <div className="mt-4 rounded border border-info/30 bg-info-soft p-3 text-xs leading-relaxed text-info-content">
                <p className="font-medium">پیش از شروع بدانید</p>
                <ul className="mt-1.5 space-y-1 opacity-90">
                  <li>ردیف اول فایل باید سرستون‌ها باشد؛ نام ستون‌ها هرچه باشد اشکالی ندارد.</li>
                  <li>سیستم ستون‌ها را خودکار تشخیص می‌دهد و شما می‌توانید اصلاحش کنید.</li>
                  <li>
                    پیش از هر تغییری در دیتابیس، کل فایل بررسی می‌شود و خطاها با شماره
                    ردیف گزارش می‌شوند.
                  </li>
                  <li>هیچ ردیفی تا فشردن دکمه «اجرا» در دیتابیس نوشته نمی‌شود.</li>
                </ul>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="تاریخچه ورود اطلاعات" />
            {history && history.length > 0 ? (
              <ul className="divide-y divide-border">
                {history.map((job) => (
                  <li key={job.id} className="px-4 py-2.5">
                    <p className="truncate text-sm text-content">{job.originalName}</p>
                    <p className="mt-0.5 text-xs text-content-muted">
                      {formatNumber(job.importedRows)} از {formatNumber(job.totalRows)} ردیف
                      {job.errorRows > 0 ? ` · ${formatNumber(job.errorRows)} خطا` : ''}
                    </p>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-2xs text-content-subtle">
                        {formatDateTime(job.completedAt ?? job.createdAt)}
                      </span>
                      <Badge tone={job.status === 'COMPLETED' ? 'success' : 'warning'}>
                        {job.status === 'COMPLETED' ? 'انجام شد' : job.status}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="هنوز فایلی وارد نشده" />
            )}
          </Card>
        </div>
      ) : null}

      {/* ── گام ۲: نگاشت ────────────────────────────────────────────── */}
      {step === 'mapping' && upload ? (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="نگاشت ستون‌ها"
              description={`${toPersianDigits(upload.totalRows)} ردیف · ${toPersianDigits(upload.headers.length)} ستون`}
              action={
                <Badge tone={missingRequired.length > 0 ? 'danger' : 'success'}>
                  {missingRequired.length > 0
                    ? `${toPersianDigits(missingRequired.length)} فیلد الزامی وصل نشده`
                    : 'همه فیلدهای الزامی وصل‌اند'}
                </Badge>
              }
            />
            <div className="p-4">
              <p className="mb-3 text-xs text-content-muted">
                هر ستون فایل شما را به فیلد متناظر در سامانه وصل کنید. ستون‌هایی که
                نمی‌خواهید وارد شوند را روی «وارد نشود» بگذارید.
              </p>

              <div className="grid gap-3 sm:grid-cols-2">
                {upload.headers.map((header) => (
                  <div
                    key={header}
                    className="rounded border border-border bg-surface-sunken p-3"
                  >
                    <p className="mb-2 truncate text-sm font-medium text-content" title={header}>
                      {header}
                    </p>
                    <Select
                      value={mapping[header] ?? ''}
                      onChange={(e) =>
                        setMapping((m) => {
                          const next = { ...m };
                          if (e.target.value) next[header] = e.target.value;
                          else delete next[header];
                          return next;
                        })
                      }
                      aria-label={`فیلد متناظر ستون ${header}`}
                    >
                      <option value="">— وارد نشود —</option>
                      {upload.availableFields.map((field) => (
                        <option key={field.key} value={field.key}>
                          {field.label}
                          {field.required ? ' (الزامی)' : ''}
                        </option>
                      ))}
                    </Select>
                    <p className="mt-1.5 truncate text-2xs text-content-subtle">
                      نمونه: {upload.sampleRows[0]?.[header] || '—'}
                    </p>
                  </div>
                ))}
              </div>

              {missingRequired.length > 0 ? (
                <div className="mt-4 rounded border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger-content">
                  این فیلدهای الزامی هنوز به ستونی وصل نشده‌اند:{' '}
                  {missingRequired.map((f) => f.label).join('، ')}
                </div>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="پیش‌نمایش داده" description="۱۰ ردیف اول فایل" />
            <TableWrapper>
              <thead>
                <tr>
                  {upload.headers.map((header) => (
                    <Th key={header}>
                      {header}
                      {mapping[header] ? (
                        <span className="block text-2xs font-normal normal-case text-primary">
                          ←{' '}
                          {upload.availableFields.find((f) => f.key === mapping[header])?.label}
                        </span>
                      ) : (
                        <span className="block text-2xs font-normal normal-case text-content-subtle">
                          وارد نمی‌شود
                        </span>
                      )}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {upload.sampleRows.map((row, index) => (
                  <tr key={index}>
                    {upload.headers.map((header) => (
                      <Td
                        key={header}
                        className={cn('text-xs', !mapping[header] && 'text-content-subtle')}
                      >
                        {row[header] || '—'}
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </TableWrapper>
          </Card>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={reset}>انصراف</Button>
            <Button
              variant="primary"
              onClick={() => saveMapping.mutate()}
              loading={saveMapping.isPending || validate.isPending}
              disabled={missingRequired.length > 0}
            >
              بررسی فایل
            </Button>
          </div>
        </div>
      ) : null}

      {/* ── گام ۳: بررسی ────────────────────────────────────────────── */}
      {step === 'validate' && validation ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Tile label="کل ردیف‌ها" value={formatNumber(validation.totalRows)} />
            <Tile label="آماده ورود" value={formatNumber(validation.validRows)} tone="success" />
            <Tile label="دارای خطا" value={formatNumber(validation.errorRows)} tone="danger" />
            <Tile label="تکراری" value={formatNumber(validation.duplicateRows)} tone="warning" />
          </div>

          {validation.errors.length > 0 ? (
            <Card className="border-danger/30">
              <CardHeader
                title="ردیف‌های دارای خطا"
                description="این ردیف‌ها وارد نمی‌شوند. فایل را در Excel اصلاح کنید و دوباره بیاورید."
              />
              <TableWrapper>
                <thead>
                  <tr>
                    <Th numeric className="w-20">ردیف</Th>
                    <Th className="w-40">ستون</Th>
                    <Th>مشکل</Th>
                    <Th className="w-40">مقدار</Th>
                  </tr>
                </thead>
                <tbody>
                  {validation.errors.slice(0, 100).map((error, index) => (
                    <tr key={index} className="transition hover:bg-surface-sunken">
                      <Td numeric className="text-xs font-medium">
                        {toPersianDigits(error.rowNumber)}
                      </Td>
                      <Td className="text-xs text-content-muted">{error.column ?? '—'}</Td>
                      <Td className="text-xs text-danger-content">{error.message}</Td>
                      <Td className="truncate text-xs text-content-subtle">{error.sample ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrapper>
              {validation.errors.length > 100 ? (
                <p className="border-t border-border px-4 py-2 text-xs text-content-muted">
                  {toPersianDigits(validation.errors.length - 100)} خطای دیگر نمایش داده نشد.
                </p>
              ) : null}
            </Card>
          ) : (
            <Card className="border-success/30">
              <div className="flex items-center gap-3 p-4">
                <CheckCircle2 className="size-5 shrink-0 text-success" />
                <p className="text-sm text-content">
                  هیچ خطایی در فایل یافت نشد. همه {formatNumber(validation.totalRows)} ردیف
                  آماده ورودند.
                </p>
              </div>
            </Card>
          )}

          {validation.duplicates.length > 0 ? (
            <Card className="border-warning/30">
              <CardHeader
                title="رکوردهای احتمالاً تکراری"
                description="این‌ها شبیه کتاب‌های موجود در سامانه‌اند."
              />
              <TableWrapper>
                <thead>
                  <tr>
                    <Th numeric className="w-20">ردیف</Th>
                    <Th>عنوان</Th>
                    <Th>دلیل شباهت</Th>
                  </tr>
                </thead>
                <tbody>
                  {validation.duplicates.slice(0, 50).map((duplicate, index) => (
                    <tr key={index} className="transition hover:bg-surface-sunken">
                      <Td numeric className="text-xs font-medium">
                        {toPersianDigits(duplicate.rowNumber)}
                      </Td>
                      <Td className="text-xs text-content">{duplicate.title}</Td>
                      <Td className="text-xs text-content-muted">{duplicate.reason}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrapper>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="تنظیمات اجرا" />
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label="رکوردهای تکراری">
                <Select
                  value={skipDuplicates ? 'skip' : 'import'}
                  onChange={(e) => setSkipDuplicates(e.target.value === 'skip')}
                >
                  <option value="skip">رد شوند (پیشنهاد می‌شود)</option>
                  <option value="import">به‌عنوان رکورد جدید وارد شوند</option>
                </Select>
              </Field>

              <Field
                label="مکان پیش‌فرض نسخه‌ها"
                hint="نسخه‌های ساخته‌شده در این مکان قرار می‌گیرند."
              >
                <LocationSelect
                  value={defaultLocationId}
                  onChange={(id) => setDefaultLocationId(id)}
                  kinds={['SHELF', 'SHELF_LEVEL', 'POSITION', 'AISLE', 'SECTION', 'ROOM']}
                  placeholder="بدون مکان"
                />
              </Field>
            </div>
          </Card>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={reset}>انصراف</Button>
            <Button
              variant="primary"
              onClick={() => execute.mutate()}
              loading={execute.isPending}
              disabled={validation.validRows === 0}
              icon={<Play className="size-4" />}
            >
              اجرای ورود {toPersianDigits(validation.validRows)} رکورد
            </Button>
          </div>
        </div>
      ) : null}

      {/* ── گام ۴: نتیجه ────────────────────────────────────────────── */}
      {step === 'done' && result ? (
        <Card className="mx-auto max-w-lg border-success/40">
          <div className="p-6 text-center">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-success text-white">
              <Check className="size-7" />
            </div>
            <h2 className="text-lg font-bold text-content">ورود اطلاعات انجام شد</h2>

            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex items-baseline justify-between">
                <dt className="text-content-muted">وارد شد</dt>
                <dd className="font-semibold text-success">{formatNumber(result.imported)}</dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-content-muted">رد شد (تکراری)</dt>
                <dd className="font-semibold text-warning">{formatNumber(result.skipped)}</dd>
              </div>
              <div className="flex items-baseline justify-between">
                <dt className="text-content-muted">ناموفق</dt>
                <dd className="font-semibold text-danger">{formatNumber(result.failed)}</dd>
              </div>
            </dl>

            {result.failed > 0 ? (
              <div className="mt-4 flex items-start gap-2 rounded border border-warning/30 bg-warning-soft p-3 text-start text-xs text-warning-content">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <p>
                  ردیف‌های ناموفق در دیتابیس نوشته نشده‌اند. جزئیات خطای هر ردیف در
                  تاریخچه همین صفحه ثبت شده است.
                </p>
              </div>
            ) : null}

            <div className="mt-5 flex justify-center gap-2">
              <Button onClick={reset}>ورود فایل دیگر</Button>
              <Button variant="primary" onClick={() => { window.location.href = '/books'; }}>
                مشاهده کتاب‌ها
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {(uploadFile.isPending || validate.isPending || execute.isPending) && step === 'upload' ? (
        <Skeleton className="mt-4 h-32" />
      ) : null}
    </>
  );
}

const TILE_TONES = {
  neutral: 'border-border',
  success: 'border-success/30 bg-success-soft',
  warning: 'border-warning/30 bg-warning-soft',
  danger: 'border-danger/30 bg-danger-soft',
} as const;

function Tile({
  label, value, tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: keyof typeof TILE_TONES;
}) {
  return (
    <div className={cn('rounded-lg border bg-surface px-4 py-3', TILE_TONES[tone])}>
      <p className="text-xs text-content-muted">{label}</p>
      <p className="mt-1 text-xl font-bold text-content">{value}</p>
    </div>
  );
}
