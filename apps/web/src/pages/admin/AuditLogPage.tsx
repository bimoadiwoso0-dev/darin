import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, FileText, ShieldCheck } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import {
  Badge, Button, Card, EmptyState, Field, Modal, Select, TableSkeleton,
  TableWrapper, Td, Th, cn,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { Pagination } from '@/components/shared/Pagination';
import { JalaliDateInput } from '@/components/shared/JalaliDateInput';
import { useUrlFilters } from '@/hooks/useUrlFilters';
import { formatDateTime, formatNumber, toPersianDigits } from '@/lib/format';

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  userLabel: string | null;
  userId: string | null;
  ip: string | null;
  createdAt: string;
  oldData: unknown;
  newData: unknown;
}

/** برچسب فارسی رویدادها — کلید خام سرور برای کتابدار معنایی ندارد. */
const ACTION_LABELS: Record<string, string> = {
  login: 'ورود به سامانه',
  logout: 'خروج از سامانه',
  login_failed: 'تلاش ناموفق برای ورود',
  password_changed: 'تغییر رمز عبور',
  setup_completed: 'تکمیل راه‌اندازی',
  create: 'ثبت',
  update: 'ویرایش',
  delete: 'حذف (بایگانی)',
  restore: 'بازگردانی از بایگانی',
  checkout: 'ثبت امانت',
  return: 'ثبت بازگشت',
  renew: 'تمدید امانت',
  reserve: 'ثبت رزرو',
  cancel_reservation: 'لغو رزرو',
  pay_fine: 'پرداخت جریمه',
  waive_fine: 'بخشش جریمه',
  create_copies: 'افزودن نسخه',
  move_copies: 'جابه‌جایی نسخه',
  change_status: 'تغییر وضعیت',
  bulk_update: 'ویرایش گروهی',
  import: 'ورود اطلاعات',
  export: 'خروجی گرفتن',
  backup_created: 'ساخت پشتیبان',
  backup_restored: 'بازیابی پشتیبان',
  settings_updated: 'تغییر تنظیمات',
  inventory_completed: 'پایان شمارش موجودی',
  mark_lost: 'اعلام مفقودی',
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
  Series: 'مجموعه',
  Donor: 'اهداکننده',
  User: 'کاربر',
  Setting: 'تنظیمات',
  System: 'سامانه',
  InventorySession: 'جلسه شمارش',
  ImportJob: 'ورود اطلاعات',
  Backup: 'پشتیبان',
};

/** رویدادهایی که ارزش برجسته‌سازی دارند — حذف، بخشش جریمه، بازیابی پشتیبان. */
const SENSITIVE_ACTIONS = new Set([
  'delete', 'waive_fine', 'backup_restored', 'settings_updated',
  'mark_lost', 'login_failed', 'password_changed',
]);

const DEFAULTS = {
  page: 1,
  pageSize: 50,
  action: '',
  entityType: '',
  from: '',
  to: '',
};

/**
 * گزارش فعالیت‌ها (قوانین ۵۹، ۶۰، ۷۶).
 *
 * ── چرا این صفحه اهمیت دارد ─────────────────────────────────────────────
 * وقتی کتابی گم می‌شود، جریمه‌ای ناپدید می‌شود یا تنظیمی عوض شده و کسی
 * نمی‌داند چرا، این تنها جایی است که پاسخ دارد: چه کسی، چه زمانی، چه
 * چیزی را تغییر داد و مقدار قبل و بعدش چه بود.
 *
 * ── فقط خواندنی است ─────────────────────────────────────────────────────
 * هیچ عملیات ویرایش یا حذفی روی این رکوردها وجود ندارد — نه در رابط
 * کاربری و نه در API. گزارشی که قابل دستکاری باشد، ارزش حسابرسی ندارد.
 */
export function AuditLogPage() {
  const { values, setFilters, reset, hasActiveFilters } = useUrlFilters(DEFAULTS);
  const [detail, setDetail] = React.useState<AuditRow | null>(null);

  const { data: actions } = useQuery({
    queryKey: ['audit-logs', 'actions'],
    queryFn: () => api.get<Array<{ action: string; count: number }>>('/audit-logs/actions'),
    staleTime: 5 * 60_000,
  });

  const query = {
    page: values.page,
    pageSize: values.pageSize,
    action: values.action || undefined,
    entityType: values.entityType || undefined,
    from: values.from || undefined,
    to: values.to || undefined,
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['audit-logs', query],
    queryFn: () => api.get<Paginated<AuditRow>>('/audit-logs', query),
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <PageHeader
        title="گزارش فعالیت‌ها"
        description={
          data ? `${formatNumber(data.meta.total)} رویداد ثبت‌شده` : 'در حال بارگذاری…'
        }
        actions={
          hasActiveFilters ? (
            <Button variant="ghost" onClick={reset}>پاک کردن فیلترها</Button>
          ) : null
        }
      />

      <div className="mb-4 flex items-start gap-2 rounded border border-info/30 bg-info-soft px-3 py-2 text-xs text-info-content">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        این گزارش فقط خواندنی است و هیچ راهی برای ویرایش یا حذف رکوردهای آن — نه در
        این صفحه و نه در API — وجود ندارد.
      </div>

      <Card>
        <div className="grid gap-3 border-b border-border p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="نوع فعالیت">
            <Select
              value={values.action}
              onChange={(e) => setFilters({ action: e.target.value })}
              aria-label="فیلتر نوع فعالیت"
            >
              <option value="">همه فعالیت‌ها</option>
              {actions?.map((item) => (
                <option key={item.action} value={item.action}>
                  {ACTION_LABELS[item.action] ?? item.action} ({toPersianDigits(item.count)})
                </option>
              ))}
            </Select>
          </Field>

          <Field label="نوع رکورد">
            <Select
              value={values.entityType}
              onChange={(e) => setFilters({ entityType: e.target.value })}
              aria-label="فیلتر نوع رکورد"
            >
              <option value="">همه رکوردها</option>
              {Object.entries(ENTITY_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Select>
          </Field>

          <Field label="از تاریخ">
            <JalaliDateInput
              value={values.from || null}
              onChange={(iso) => setFilters({ from: iso ?? '' })}
            />
          </Field>

          <Field label="تا تاریخ">
            <JalaliDateInput
              value={values.to || null}
              onChange={(iso) => setFilters({ to: iso ?? '' })}
            />
          </Field>
        </div>

        {isLoading ? (
          <TableSkeleton columns={5} />
        ) : data && data.data.length > 0 ? (
          <>
            <TableWrapper className={isFetching ? 'opacity-60 transition-opacity' : undefined}>
              <thead>
                <tr>
                  <Th className="w-44">زمان</Th>
                  <Th className="w-40">کاربر</Th>
                  <Th className="w-40">فعالیت</Th>
                  <Th>رکورد</Th>
                  <Th className="w-28">جزئیات</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((row) => (
                  <tr key={row.id} className="transition hover:bg-surface-sunken">
                    <Td className="text-xs text-content-muted">
                      {formatDateTime(row.createdAt)}
                      {row.ip ? (
                        <span className="field-ltr block text-2xs text-content-subtle">
                          {row.ip}
                        </span>
                      ) : null}
                    </Td>
                    <Td className="text-xs text-content">{row.userLabel ?? 'سیستم'}</Td>
                    <Td>
                      <Badge tone={SENSITIVE_ACTIONS.has(row.action) ? 'warning' : 'neutral'}>
                        {ACTION_LABELS[row.action] ?? row.action}
                      </Badge>
                    </Td>
                    <Td className="text-xs">
                      <span className="text-content-muted">
                        {ENTITY_LABELS[row.entityType] ?? row.entityType}
                      </span>
                      {row.entityLabel ? (
                        <span className="text-content"> — {row.entityLabel}</span>
                      ) : null}
                      {row.entityId && entityPath(row.entityType, row.entityId) ? (
                        <Link
                          to={entityPath(row.entityType, row.entityId)!}
                          className="ms-1.5 inline-flex items-center text-primary hover:underline"
                        >
                          مشاهده
                          <ChevronLeft className="size-3" />
                        </Link>
                      ) : null}
                    </Td>
                    <Td>
                      {row.oldData || row.newData ? (
                        <Button size="sm" variant="ghost" onClick={() => setDetail(row)}>
                          تغییرات
                        </Button>
                      ) : (
                        <span className="text-xs text-content-subtle">—</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrapper>

            <Pagination
              meta={data.meta}
              onPageChange={(page) => setFilters({ page }, { resetPage: false })}
              onPageSizeChange={(pageSize) => setFilters({ pageSize })}
            />
          </>
        ) : (
          <EmptyState
            icon={<FileText className="size-6" />}
            title="رویدادی با این فیلترها یافت نشد"
            action={hasActiveFilters ? <Button onClick={reset}>پاک کردن فیلترها</Button> : null}
          />
        )}
      </Card>

      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title="جزئیات تغییر"
        description={
          detail
            ? `${ACTION_LABELS[detail.action] ?? detail.action} · ${formatDateTime(detail.createdAt)} · ${detail.userLabel ?? 'سیستم'}`
            : undefined
        }
        size="lg"
        footer={<Button variant="ghost" onClick={() => setDetail(null)}>بستن</Button>}
      >
        {detail ? <ChangeDiff oldData={detail.oldData} newData={detail.newData} /> : null}
      </Modal>
    </>
  );
}

/**
 * نمایش تفاوت مقدار قبل و بعد.
 *
 * فقط فیلدهایی نشان داده می‌شوند که واقعاً تغییر کرده‌اند. نمایش کل رکورد
 * قبل و بعد، کاربر را وادار می‌کند خودش دو ستون JSON را مقایسه کند.
 */
function ChangeDiff({ oldData, newData }: { oldData: unknown; newData: unknown }) {
  const before = (oldData ?? {}) as Record<string, unknown>;
  const after = (newData ?? {}) as Record<string, unknown>;

  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );

  if (keys.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-content-muted">
        تفاوت قابل نمایشی ثبت نشده است.
      </p>
    );
  }

  return (
    <TableWrapper className="rounded border border-border">
      <thead>
        <tr>
          <Th className="w-48">فیلد</Th>
          <Th>مقدار قبل</Th>
          <Th>مقدار بعد</Th>
        </tr>
      </thead>
      <tbody>
        {keys.map((key) => (
          <tr key={key}>
            <Td className="text-xs font-medium text-content">{key}</Td>
            <Td className={cn('text-xs', 'text-danger-content')}>{renderValue(before[key])}</Td>
            <Td className={cn('text-xs', 'text-success-content')}>{renderValue(after[key])}</Td>
          </tr>
        ))}
      </tbody>
    </TableWrapper>
  );
}

function renderValue(value: unknown): React.ReactNode {
  if (value === undefined) return <span className="text-content-subtle">—</span>;
  if (value === null) return <span className="text-content-subtle">خالی</span>;
  if (typeof value === 'boolean') return value ? 'بله' : 'خیر';
  if (typeof value === 'object') {
    return (
      <code className="block max-w-xs overflow-x-auto whitespace-pre-wrap font-mono text-2xs" dir="ltr">
        {JSON.stringify(value, null, 1)}
      </code>
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- حالت شیء در شرط بالا با JSON.stringify پاسخ داده شده
  const text = String(value);
  // تاریخ ISO را شمسی نشان می‌دهیم؛ رشته خام برای کاربر بی‌معناست
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return formatDateTime(text);
  return text;
}

/** لینک به صفحه رکورد — فقط برای انواعی که صفحه اختصاصی دارند. */
function entityPath(entityType: string, entityId: string): string | null {
  const paths: Record<string, string> = {
    Book: `/books/${entityId}`,
    BookCopy: `/copies/${entityId}`,
    Member: `/members/${entityId}`,
    Location: `/locations/${entityId}`,
    InventorySession: `/inventory/${entityId}`,
  };
  return paths[entityType] ?? null;
}
