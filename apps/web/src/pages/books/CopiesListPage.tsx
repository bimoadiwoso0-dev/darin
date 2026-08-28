import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, MoveRight, Printer, RefreshCw } from 'lucide-react';
import { ACQUISITION_SOURCE, COPY_CONDITION, COPY_STATUS } from '@darin/shared';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import {
  Badge, Button, Card, EmptyState, Field, Modal, Select, TableSkeleton,
  TableWrapper, Td, Textarea, Th,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { FilterBar } from '@/components/shared/FilterBar';
import { Pagination } from '@/components/shared/Pagination';
import { SortableHeader } from '@/components/shared/SortableHeader';
import { LocationSelect } from '@/components/shared/LocationSelect';
import { LabelPrintModal } from '@/components/books/LabelPrintModal';
import { useDebounced, useUrlFilters } from '@/hooks/useUrlFilters';
import { formatIdentifier, formatNumber, formatRelative, toPersianDigits } from '@/lib/format';

interface CopyRow {
  id: string; copyNumber: number; accessionNumber: string; barcode: string;
  libraryCode: string | null; assetNumber: string | null; status: string;
  condition: string; isLoanable: boolean; positionCode: string | null;
  createdAt: string; deletedAt: string | null;
  book: {
    id: string; title: string; volumeNumber: number | null; volumeTitle: string | null;
    isbn13: string | null;
    contributors: Array<{ person: { fullName: string } }>;
  };
  location: { id: string; name: string; fullCode: string } | null;
  currentLoan: {
    id: string; dueAt: string; status: string;
    member: { id: string; firstName: string; lastName: string; memberCode: string };
  } | null;
}

const DEFAULTS = {
  q: '',
  page: 1,
  pageSize: 50,
  sort: 'accessionNumber',
  order: 'asc',
  status: '',
  condition: '',
  acquisitionSource: '',
  locationId: '',
  locationSubtree: 'true',
  overdueOnly: '',
  includeDeleted: '',
};

/**
 * فهرست نسخه‌های فیزیکی (قوانین ۶، ۹۵).
 *
 * ── چرا فهرست جدا از کتاب‌ها ────────────────────────────────────────────
 * کارهای روزمره کتابدار روی «نسخه» است نه «عنوان»: کدام نسخه‌ها در قفسه
 * ۳ هستند، کدام‌ها آسیب دیده‌اند، برچسب کدام‌ها باید چاپ شود. این فهرست
 * همان دیدِ نسخه‌محور را می‌دهد.
 *
 * ── عملیات گروهی ────────────────────────────────────────────────────────
 * انتخاب چند نسخه و جابه‌جایی یا چاپ برچسب یکجا؛ جابه‌جایی تک‌تک ۴۰ نسخه
 * وقتی یک قفسه عوض می‌شود، غیرقابل تحمل است.
 */
export function CopiesListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();
  const { values, setFilters, reset, hasActiveFilters } = useUrlFilters(DEFAULTS);

  const [searchInput, setSearchInput] = React.useState(values.q);
  const debouncedSearch = useDebounced(searchInput, 300);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [labelOpen, setLabelOpen] = React.useState(false);
  const [moveOpen, setMoveOpen] = React.useState(false);
  const [moveTarget, setMoveTarget] = React.useState<string | null>(null);
  const [moveReason, setMoveReason] = React.useState('');

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
    condition: values.condition || undefined,
    acquisitionSource: values.acquisitionSource || undefined,
    locationId: values.locationId || undefined,
    locationSubtree: values.locationId ? values.locationSubtree : undefined,
    overdueOnly: values.overdueOnly || undefined,
    includeDeleted: values.includeDeleted || undefined,
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['copies', query],
    queryFn: () => api.get<Paginated<CopyRow>>('/copies', query),
    placeholderData: (previous) => previous,
  });

  const move = useMutation({
    mutationFn: () =>
      api.post<{ moved: number }>('/copies/move', {
        copyIds: selected,
        toLocationId: moveTarget,
        reason: moveReason.trim() || undefined,
      }),
    onSuccess: (result) => {
      toast.success(`${toPersianDigits(result.moved)} نسخه جابه‌جا شد`);
      setMoveOpen(false);
      setSelected([]);
      setMoveTarget(null);
      setMoveReason('');
      void queryClient.invalidateQueries({ queryKey: ['copies'] });
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
    },
    onError: (error) => toast.apiError(error, 'جابه‌جایی انجام نشد'),
  });

  const rows = data?.data ?? [];
  const allSelected = rows.length > 0 && selected.length === rows.length;

  const activeFilterCount = [
    values.status, values.condition, values.acquisitionSource,
    values.locationId, values.overdueOnly, values.includeDeleted,
  ].filter(Boolean).length;

  const clearAll = () => { reset(); setSearchInput(''); setSelected([]); };

  return (
    <>
      <PageHeader
        title="نسخه‌های فیزیکی"
        description={data ? `${formatNumber(data.meta.total)} نسخه` : 'در حال بارگذاری…'}
        actions={
          selected.length > 0 ? (
            <>
              <Badge tone="primary">{toPersianDigits(selected.length)} نسخه انتخاب شده</Badge>
              {can('labels.print') ? (
                <Button onClick={() => setLabelOpen(true)} icon={<Printer className="size-4" />}>
                  چاپ برچسب
                </Button>
              ) : null}
              {can('copies.move') ? (
                <Button
                  variant="primary"
                  onClick={() => setMoveOpen(true)}
                  icon={<MoveRight className="size-4" />}
                >
                  جابه‌جایی به مکان دیگر
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => setSelected([])}>لغو انتخاب</Button>
            </>
          ) : null
        }
      />

      <Card>
        <FilterBar
          search={searchInput}
          onSearchChange={setSearchInput}
          placeholder="بارکد، شماره ثبت، کد کتابخانه یا عنوان کتاب…"
          activeCount={activeFilterCount}
          onReset={hasActiveFilters ? clearAll : undefined}
        >
          <Field label="وضعیت نسخه">
            <Select
              value={values.status}
              onChange={(e) => setFilters({ status: e.target.value })}
              aria-label="فیلتر وضعیت"
            >
              <option value="">همه وضعیت‌ها</option>
              {Object.entries(COPY_STATUS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Select>
          </Field>

          <Field label="وضعیت فیزیکی">
            <Select
              value={values.condition}
              onChange={(e) => setFilters({ condition: e.target.value })}
              aria-label="فیلتر وضعیت فیزیکی"
            >
              <option value="">همه</option>
              {Object.entries(COPY_CONDITION).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Select>
          </Field>

          <Field label="نحوه تأمین">
            <Select
              value={values.acquisitionSource}
              onChange={(e) => setFilters({ acquisitionSource: e.target.value })}
              aria-label="فیلتر نحوه تأمین"
            >
              <option value="">همه</option>
              {Object.entries(ACQUISITION_SOURCE).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Select>
          </Field>

          <Field label="مکان" hint={values.locationId ? 'شامل زیرمجموعه‌ها' : undefined}>
            <LocationSelect
              value={values.locationId || null}
              onChange={(id) => setFilters({ locationId: id ?? '' })}
              placeholder="همه مکان‌ها"
            />
          </Field>

          <Field label="فقط دیرکرددارها">
            <Select
              value={values.overdueOnly}
              onChange={(e) => setFilters({ overdueOnly: e.target.value })}
              aria-label="فیلتر دیرکرد"
            >
              <option value="">همه نسخه‌ها</option>
              <option value="true">فقط نسخه‌های دیرکرددار</option>
            </Select>
          </Field>

          {can('copies.delete') ? (
            <Field label="رکوردهای بایگانی‌شده">
              <Select
                value={values.includeDeleted}
                onChange={(e) => setFilters({ includeDeleted: e.target.value })}
                aria-label="نمایش بایگانی‌شده‌ها"
              >
                <option value="">فقط رکوردهای فعال</option>
                <option value="true">شامل بایگانی‌شده‌ها</option>
              </Select>
            </Field>
          ) : null}
        </FilterBar>

        {isLoading ? (
          <TableSkeleton columns={7} />
        ) : data && rows.length > 0 ? (
          <>
            <TableWrapper className={isFetching ? 'opacity-60 transition-opacity' : undefined}>
              <thead>
                <tr>
                  <Th className="w-10">
                    <input
                      type="checkbox"
                      aria-label="انتخاب همه نسخه‌های این صفحه"
                      checked={allSelected}
                      onChange={(e) => setSelected(e.target.checked ? rows.map((r) => r.id) : [])}
                      className="size-4 rounded border-border-strong text-primary focus:ring-primary/30"
                    />
                  </Th>
                  <SortableHeader
                    column="accessionNumber" label="شماره ثبت"
                    sort={values.sort} order={values.order as 'asc' | 'desc'}
                    onSort={(sort, order) => setFilters({ sort, order })}
                  />
                  <Th>بارکد</Th>
                  <Th>کتاب</Th>
                  <Th>مکان</Th>
                  <SortableHeader
                    column="status" label="وضعیت"
                    sort={values.sort} order={values.order as 'asc' | 'desc'}
                    onSort={(sort, order) => setFilters({ sort, order })}
                  />
                  <Th>نزد</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((copy) => (
                  <tr
                    key={copy.id}
                    onClick={() => navigate(`/copies/${copy.id}`)}
                    className="cursor-pointer transition hover:bg-surface-sunken"
                  >
                    <Td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`انتخاب نسخه ${copy.accessionNumber}`}
                        checked={selected.includes(copy.id)}
                        onChange={(e) =>
                          setSelected((s) =>
                            e.target.checked ? [...s, copy.id] : s.filter((x) => x !== copy.id),
                          )
                        }
                        className="size-4 rounded border-border-strong text-primary focus:ring-primary/30"
                      />
                    </Td>
                    <Td className="field-ltr text-xs font-medium">
                      {formatIdentifier(copy.accessionNumber)}
                    </Td>
                    <Td className="field-ltr text-xs text-content-muted">
                      {formatIdentifier(copy.barcode)}
                    </Td>
                    <Td>
                      <Link
                        to={`/books/${copy.book.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-sm text-content hover:text-primary hover:underline"
                      >
                        {copy.book.title}
                        {copy.book.volumeNumber
                          ? ` (جلد ${toPersianDigits(copy.book.volumeNumber)})`
                          : ''}
                      </Link>
                      <p className="mt-0.5 truncate text-xs text-content-muted">
                        {copy.book.contributors.map((c) => c.person.fullName).join('، ') ||
                          'بدون پدیدآورنده'}
                      </p>
                    </Td>
                    <Td className="text-xs text-content-muted">
                      {copy.location ? (
                        <>
                          {copy.location.name}
                          <span className="block font-mono text-2xs text-content-subtle" dir="ltr">
                            {copy.location.fullCode}
                            {copy.positionCode ? ` · ${copy.positionCode}` : ''}
                          </span>
                        </>
                      ) : (
                        <span className="text-content-subtle">بدون مکان</span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={copyStatusTone(copy.status)}>
                        {COPY_STATUS[copy.status as keyof typeof COPY_STATUS] ?? copy.status}
                      </Badge>
                      {!copy.isLoanable ? (
                        <Badge tone="neutral" className="ms-1">غیرقابل امانت</Badge>
                      ) : null}
                    </Td>
                    <Td className="text-xs">
                      {copy.currentLoan ? (
                        <Link
                          to={`/members/${copy.currentLoan.member.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-content-muted hover:text-primary hover:underline"
                        >
                          {copy.currentLoan.member.firstName} {copy.currentLoan.member.lastName}
                          <span
                            className={
                              copy.currentLoan.status === 'OVERDUE'
                                ? 'block text-2xs text-danger'
                                : 'block text-2xs text-content-subtle'
                            }
                          >
                            {formatRelative(copy.currentLoan.dueAt)}
                          </span>
                        </Link>
                      ) : (
                        <span className="text-content-subtle">—</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrapper>

            <Pagination
              meta={data.meta}
              onPageChange={(page) => { setFilters({ page }, { resetPage: false }); setSelected([]); }}
              onPageSizeChange={(pageSize) => { setFilters({ pageSize }); setSelected([]); }}
            />
          </>
        ) : (
          <EmptyState
            icon={<Boxes className="size-6" />}
            title={hasActiveFilters ? 'نسخه‌ای با این فیلترها یافت نشد' : 'هنوز نسخه‌ای ثبت نشده'}
            description={
              hasActiveFilters
                ? 'فیلترها را تغییر دهید یا پاک کنید.'
                : 'نسخه‌های فیزیکی از صفحه هر کتاب افزوده می‌شوند.'
            }
            action={
              hasActiveFilters ? (
                <Button onClick={clearAll} icon={<RefreshCw className="size-4" />}>
                  پاک کردن فیلترها
                </Button>
              ) : (
                <Button variant="primary" onClick={() => navigate('/books')}>
                  رفتن به فهرست کتاب‌ها
                </Button>
              )
            }
          />
        )}
      </Card>

      <LabelPrintModal open={labelOpen} onClose={() => setLabelOpen(false)} copyIds={selected} />

      <Modal
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        title="جابه‌جایی نسخه‌ها"
        description={`${toPersianDigits(selected.length)} نسخه به مکان جدید منتقل می‌شود`}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMoveOpen(false)}>انصراف</Button>
            <Button
              variant="primary"
              onClick={() => move.mutate()}
              loading={move.isPending}
              disabled={!moveTarget}
            >
              جابه‌جا کن
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="مکان مقصد" required>
            <LocationSelect
              value={moveTarget}
              onChange={(locationId) => setMoveTarget(locationId)}
              kinds={['SHELF', 'SHELF_LEVEL', 'POSITION', 'AISLE', 'SECTION', 'ROOM']}
              placeholder="انتخاب مکان مقصد…"
            />
          </Field>

          <Field
            label="دلیل جابه‌جایی"
            hint="در تاریخچه نسخه ثبت می‌شود تا بعداً معلوم باشد چرا جابه‌جا شده."
          >
            <Textarea value={moveReason} onChange={(e) => setMoveReason(e.target.value)} rows={2} />
          </Field>
        </div>
      </Modal>
    </>
  );
}

export function copyStatusTone(
  status: string,
): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (status) {
    case 'AVAILABLE': return 'success';
    case 'ON_LOAN': return 'warning';
    case 'RESERVED_HOLD': return 'info';
    case 'LOST':
    case 'DAMAGED': return 'danger';
    default: return 'neutral';
  }
}
