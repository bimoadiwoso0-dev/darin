import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Download, RefreshCcw, Undo2 } from 'lucide-react';
import { LOAN_STATUS } from '@darin/shared';
import { api, ApiError, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Select,
  TableSkeleton, TableWrapper, Td, Th,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { FilterBar } from '@/components/shared/FilterBar';
import { Pagination } from '@/components/shared/Pagination';
import { SortableHeader } from '@/components/shared/SortableHeader';
import { useDebounced, useUrlFilters } from '@/hooks/useUrlFilters';
import {
  formatDate, formatMoney, formatNumber, formatRelative, toDateInputValue, toPersianDigits,
} from '@/lib/format';

interface LoanRow {
  id: string; loanNumber: string; status: string; loanedAt: string; dueAt: string;
  returnedAt: string | null; renewalCount: number;
  memberName: string;
  daysRemaining: number;
  outstandingFine: number;
  member: {
    id: string; memberCode: string; firstName: string; lastName: string; mobile: string | null;
  };
  copy: {
    id: string; barcode: string; accessionNumber: string;
    book: { id: string; title: string; volumeTitle: string | null };
    location: { fullCode: string } | null;
  };
}

const DEFAULTS = {
  q: '',
  page: 1,
  pageSize: 20,
  sort: 'dueAt',
  order: 'asc',
  status: 'ACTIVE,OVERDUE',
  overdueOnly: '',
  dueBefore: '',
  from: '',
  to: '',
};

/**
 * فهرست امانت‌ها (قوانین ۲۱، ۲۵، ۳۲).
 *
 * ── پیش‌فرض: امانت‌های باز ───────────────────────────────────────────────
 * ۹۵٪ مواقع کتابدار دنبال کتاب‌هایی است که هنوز برنگشته‌اند. تاریخچه
 * بازگشت‌داده‌شده‌ها هم در دسترس است اما پیش‌فرض نیست.
 *
 * ── تمدید و بازگشت درجا ─────────────────────────────────────────────────
 * وقتی عضوی تلفنی تمدید می‌خواهد، کتابدار نباید سه صفحه جلو برود. دکمه
 * تمدید در همان ردیف است و اگر قانونی مانع شود، پیام فارسی سرور نمایش
 * داده می‌شود.
 */
export function LoansListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();
  const { values, setFilters, reset, hasActiveFilters } = useUrlFilters(DEFAULTS);

  const [searchInput, setSearchInput] = React.useState(values.q);
  const debouncedSearch = useDebounced(searchInput, 300);
  const [returnTarget, setReturnTarget] = React.useState<LoanRow | null>(null);
  const [exporting, setExporting] = React.useState(false);

  React.useEffect(() => {
    if (debouncedSearch !== values.q) setFilters({ q: debouncedSearch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const query = {
    q: values.q || undefined,
    page: values.page,
    pageSize: values.pageSize,
    sort: values.sort,
    order: values.order,
    status: values.status || undefined,
    overdueOnly: values.overdueOnly || undefined,
    dueBefore: values.dueBefore || undefined,
    from: values.from || undefined,
    to: values.to || undefined,
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['loans', query],
    queryFn: () => api.get<Paginated<LoanRow>>('/loans', query),
    placeholderData: (previous) => previous,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['loans'] });
    void queryClient.invalidateQueries({ queryKey: ['copies'] });
    void queryClient.invalidateQueries({ queryKey: ['members'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const renew = useMutation({
    mutationFn: (loanId: string) =>
      api.post<{ dueAt: string; remainingRenewals: number }>(`/loans/${loanId}/renew`),
    onSuccess: (result) => {
      toast.success(
        'امانت تمدید شد',
        `موعد جدید: ${formatDate(result.dueAt)} — ${toPersianDigits(result.remainingRenewals)} تمدید باقی مانده`,
      );
      invalidate();
    },
    onError: (error) => {
      // تمدید ممکن است به‌دلیل رزرو دیگری رد شود؛ پیام سرور گویاست
      if (error instanceof ApiError) toast.error('تمدید انجام نشد', error.message);
      else toast.apiError(error, 'تمدید انجام نشد');
    },
  });

  const returnLoan = useMutation({
    mutationFn: (loanId: string) => api.post(`/loans/${loanId}/return`),
    onSuccess: () => {
      toast.success('بازگشت ثبت شد');
      setReturnTarget(null);
      invalidate();
    },
    onError: (error) => toast.apiError(error, 'ثبت بازگشت انجام نشد'),
  });

  const onExport = async () => {
    setExporting(true);
    try {
      await api.download('/reports/active-loans/export', { format: 'xlsx' });
      toast.success('فایل خروجی ساخته شد', 'دانلود در مرورگر آغاز شد.');
    } catch (error) {
      toast.apiError(error, 'خروجی گرفتن انجام نشد');
    } finally {
      setExporting(false);
    }
  };

  const activeFilterCount = [
    values.status !== DEFAULTS.status ? values.status : '',
    values.overdueOnly, values.dueBefore, values.from, values.to,
  ].filter(Boolean).length;

  const clearAll = () => { reset(); setSearchInput(''); };

  return (
    <>
      <PageHeader
        title="امانت‌ها"
        description={data ? `${formatNumber(data.meta.total)} رکورد` : 'در حال بارگذاری…'}
        actions={
          <>
            {can('reports.export') ? (
              <Button onClick={() => void onExport()} loading={exporting} icon={<Download className="size-4" />}>
                خروجی Excel
              </Button>
            ) : null}
            {can('loans.return') ? (
              <Button variant="primary" onClick={() => navigate('/returns')} icon={<Undo2 className="size-4" />}>
                ثبت بازگشت
              </Button>
            ) : null}
          </>
        }
      />

      <Card>
        <FilterBar
          search={searchInput}
          onSearchChange={setSearchInput}
          placeholder="شماره امانت، بارکد یا کد عضویت…"
          activeCount={activeFilterCount}
          onReset={hasActiveFilters ? clearAll : undefined}
        >
          <Field label="وضعیت امانت">
            <Select
              value={values.status}
              onChange={(e) => setFilters({ status: e.target.value })}
              aria-label="فیلتر وضعیت"
            >
              <option value="ACTIVE,OVERDUE">امانت‌های باز</option>
              <option value="">همه رکوردها</option>
              {Object.entries(LOAN_STATUS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Select>
          </Field>

          <Field label="فقط دیرکرددارها">
            <Select
              value={values.overdueOnly}
              onChange={(e) => setFilters({ overdueOnly: e.target.value })}
              aria-label="فیلتر دیرکرد"
            >
              <option value="">همه امانت‌ها</option>
              <option value="true">فقط دیرکرددارها</option>
            </Select>
          </Field>

          <Field label="موعد پیش از" hint="برای یافتن کتاب‌هایی که به‌زودی سررسید می‌شوند.">
            <Input
              type="date" ltr value={toDateInputValue(values.dueBefore || undefined)}
              onChange={(e) =>
                setFilters({
                  dueBefore: e.target.value ? new Date(e.target.value).toISOString() : '',
                })
              }
            />
          </Field>

          <Field label="امانت از تاریخ">
            <Input
              type="date" ltr value={toDateInputValue(values.from || undefined)}
              onChange={(e) =>
                setFilters({ from: e.target.value ? new Date(e.target.value).toISOString() : '' })
              }
            />
          </Field>
        </FilterBar>

        {isLoading ? (
          <TableSkeleton columns={6} />
        ) : data && data.data.length > 0 ? (
          <>
            <TableWrapper className={isFetching ? 'opacity-60 transition-opacity' : undefined}>
              <thead>
                <tr>
                  <Th>کتاب</Th>
                  <Th>عضو</Th>
                  <SortableHeader
                    column="loanedAt" label="تاریخ امانت" defaultOrder="desc"
                    sort={values.sort} order={values.order as 'asc' | 'desc'}
                    onSort={(sort, order) => setFilters({ sort, order })}
                  />
                  <SortableHeader
                    column="dueAt" label="موعد بازگشت"
                    sort={values.sort} order={values.order as 'asc' | 'desc'}
                    onSort={(sort, order) => setFilters({ sort, order })}
                  />
                  <Th className="w-24">وضعیت</Th>
                  <Th className="w-40">عملیات</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((loan) => {
                  const open = loan.status === 'ACTIVE' || loan.status === 'OVERDUE';
                  return (
                    <tr key={loan.id} className="transition hover:bg-surface-sunken">
                      <Td>
                        <Link
                          to={`/books/${loan.copy.book.id}`}
                          className="text-sm text-content hover:text-primary hover:underline"
                        >
                          {loan.copy.book.title}
                        </Link>
                        <p className="field-ltr mt-0.5 text-xs text-content-muted">
                          {loan.copy.barcode}
                          {loan.copy.location ? ` · ${loan.copy.location.fullCode}` : ''}
                        </p>
                      </Td>
                      <Td>
                        <Link
                          to={`/members/${loan.member.id}`}
                          className="text-sm text-content hover:text-primary hover:underline"
                        >
                          {loan.memberName}
                        </Link>
                        <p className="field-ltr mt-0.5 text-xs text-content-muted">
                          {loan.member.memberCode}
                          {loan.member.mobile ? ` · ${loan.member.mobile}` : ''}
                        </p>
                      </Td>
                      <Td className="text-xs text-content-muted">{formatDate(loan.loanedAt)}</Td>
                      <Td className="text-xs">
                        {formatDate(loan.dueAt)}
                        {open ? (
                          <span
                            className={
                              loan.daysRemaining < 0
                                ? 'block text-2xs text-danger'
                                : loan.daysRemaining <= 2
                                  ? 'block text-2xs text-warning'
                                  : 'block text-2xs text-content-subtle'
                            }
                          >
                            {formatRelative(loan.dueAt)}
                          </span>
                        ) : loan.returnedAt ? (
                          <span className="block text-2xs text-content-subtle">
                            بازگشت: {formatDate(loan.returnedAt)}
                          </span>
                        ) : null}
                      </Td>
                      <Td>
                        <Badge tone={loanStatusTone(loan.status)}>
                          {LOAN_STATUS[loan.status as keyof typeof LOAN_STATUS] ?? loan.status}
                        </Badge>
                        {loan.outstandingFine > 0 ? (
                          <Badge tone="danger" className="ms-1">
                            {formatMoney(loan.outstandingFine)}
                          </Badge>
                        ) : null}
                      </Td>
                      <Td>
                        {open ? (
                          <div className="flex gap-1">
                            {can('loans.renew') ? (
                              <Button
                                size="sm"
                                onClick={() => renew.mutate(loan.id)}
                                loading={renew.isPending && renew.variables === loan.id}
                                icon={<RefreshCcw className="size-3.5" />}
                              >
                                تمدید
                              </Button>
                            ) : null}
                            {can('loans.return') ? (
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => setReturnTarget(loan)}
                                icon={<Undo2 className="size-3.5" />}
                              >
                                بازگشت
                              </Button>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-xs text-content-subtle">—</span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
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
            icon={<BookOpen className="size-6" />}
            title={hasActiveFilters ? 'امانتی با این فیلترها یافت نشد' : 'امانت بازی وجود ندارد'}
            description={
              hasActiveFilters ? 'فیلترها را تغییر دهید یا پاک کنید.' : undefined
            }
            action={hasActiveFilters ? <Button onClick={clearAll}>پاک کردن فیلترها</Button> : null}
          />
        )}
      </Card>

      <ConfirmDialog
        open={!!returnTarget}
        onClose={() => setReturnTarget(null)}
        onConfirm={() => returnTarget && returnLoan.mutate(returnTarget.id)}
        loading={returnLoan.isPending}
        tone="primary"
        title="ثبت بازگشت"
        confirmLabel="ثبت بازگشت"
        message={
          returnTarget ? (
            <>
              <p>
                بازگشت «{returnTarget.copy.book.title}» از {returnTarget.memberName} ثبت می‌شود.
              </p>
              {returnTarget.daysRemaining < 0 ? (
                <p className="mt-2 rounded border border-warning/30 bg-warning-soft px-2.5 py-1.5 text-warning-content">
                  این امانت {toPersianDigits(Math.abs(returnTarget.daysRemaining))} روز دیرکرد
                  دارد و جریمه به‌صورت خودکار محاسبه و ثبت خواهد شد.
                </p>
              ) : null}
            </>
          ) : null
        }
      />
    </>
  );
}

export function loanStatusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'ACTIVE': return 'success';
    case 'OVERDUE': return 'danger';
    case 'LOST': return 'danger';
    case 'RETURNED': return 'neutral';
    default: return 'warning';
  }
}
