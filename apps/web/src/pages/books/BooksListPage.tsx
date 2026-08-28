import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BookPlus, Download, Library, Tags } from 'lucide-react';
import { CONTRIBUTOR_ROLE, LANGUAGES } from '@darin/shared';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import {
  Badge, Button, Card, EmptyState, Field, Input, Select, TableSkeleton, TableWrapper, Td, Th,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { FilterBar } from '@/components/shared/FilterBar';
import { Pagination } from '@/components/shared/Pagination';
import { SortableHeader } from '@/components/shared/SortableHeader';
import { EntityPicker } from '@/components/shared/EntityPicker';
import { useDebounced, useUrlFilters } from '@/hooks/useUrlFilters';
import { formatIdentifier, formatNumber, toPersianDigits } from '@/lib/format';

interface BookRow {
  id: string;
  title: string;
  subtitle: string | null;
  publicationYear: number | null;
  isbn13: string | null;
  language: string;
  edition: number | null;
  volumeNumber: number | null;
  volumeTitle: string | null;
  parentBookId: string | null;
  createdAt: string;
  deletedAt: string | null;
  publisher: { id: string; name: string } | null;
  series: { id: string; title: string } | null;
  contributors: Array<{ role: string; person: { id: string; fullName: string } }>;
  categories: Array<{ category: { id: string; name: string } }>;
  copyCount: number;
  availableCount: number;
}

const DEFAULTS = {
  q: '',
  page: 1,
  pageSize: 20,
  sort: 'createdAt',
  order: 'desc',
  publisherId: '',
  personId: '',
  categoryId: '',
  seriesId: '',
  language: '',
  yearFrom: '',
  yearTo: '',
  availableOnly: '',
  hasCopies: '',
  includeDeleted: '',
};

/**
 * فهرست کتاب‌ها (قوانین ۳۳، ۹۵، ۹۶).
 *
 * ── فیلترها در نشانی صفحه ────────────────────────────────────────────────
 * «کتاب‌های ناشر نی که موجود نیستند» یک نشانی قابل اشتراک‌گذاری می‌شود؛
 * کتابدار می‌تواند آن را نشانک کند یا برای همکارش بفرستد.
 *
 * ── خروجی Excel واقعی است ────────────────────────────────────────────────
 * دکمه خروجی، فایل واقعی تولیدشده در سرور را دانلود می‌کند (قانون ۱۳۴).
 */
export function BooksListPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const { values, setFilters, reset, hasActiveFilters } = useUrlFilters(DEFAULTS);

  const [searchInput, setSearchInput] = React.useState(values.q);
  const debouncedSearch = useDebounced(searchInput, 300);

  // برچسب انتخاب‌ها فقط برای نمایش نگه داشته می‌شود — در URL فقط شناسه است
  const [labels, setLabels] = React.useState<Record<string, string | null>>({});
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
    publisherId: values.publisherId || undefined,
    personId: values.personId || undefined,
    categoryId: values.categoryId || undefined,
    seriesId: values.seriesId || undefined,
    language: values.language || undefined,
    yearFrom: values.yearFrom || undefined,
    yearTo: values.yearTo || undefined,
    availableOnly: values.availableOnly || undefined,
    hasCopies: values.hasCopies || undefined,
    includeDeleted: values.includeDeleted || undefined,
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['books', query],
    queryFn: () => api.get<Paginated<BookRow>>('/books', query),
    // نگه‌داشتن نتیجه قبلی هنگام تغییر صفحه — جدول خالی و پرش چیدمان ندارد
    placeholderData: (previous) => previous,
  });

  const activeFilterCount = [
    values.publisherId, values.personId, values.categoryId, values.seriesId,
    values.language, values.yearFrom, values.yearTo, values.availableOnly,
    values.hasCopies, values.includeDeleted,
  ].filter(Boolean).length;

  const onExport = async () => {
    setExporting(true);
    try {
      await api.download('/reports/collection-inventory/export', {
        format: 'xlsx',
        categoryId: values.categoryId || undefined,
      });
      toast.success('فایل خروجی ساخته شد', 'دانلود در مرورگر آغاز شد.');
    } catch (error) {
      toast.apiError(error, 'خروجی گرفتن انجام نشد');
    } finally {
      setExporting(false);
    }
  };

  const clearAll = () => { reset(); setSearchInput(''); setLabels({}); };

  return (
    <>
      <PageHeader
        title="کتاب‌ها"
        description={data ? `${formatNumber(data.meta.total)} عنوان در مجموعه` : 'در حال بارگذاری…'}
        actions={
          <>
            {can('reports.export') ? (
              <Button onClick={() => void onExport()} loading={exporting} icon={<Download className="size-4" />}>
                خروجی Excel
              </Button>
            ) : null}
            {can('books.create') ? (
              <Button
                variant="primary"
                onClick={() => navigate('/books/new')}
                icon={<BookPlus className="size-4" />}
              >
                ثبت کتاب جدید
              </Button>
            ) : null}
          </>
        }
      />

      <Card>
        <FilterBar
          search={searchInput}
          onSearchChange={setSearchInput}
          placeholder="عنوان، پدیدآورنده، ناشر یا شابک…"
          activeCount={activeFilterCount}
          onReset={hasActiveFilters ? clearAll : undefined}
        >
          <Field label="ناشر">
            <EntityPicker
              endpoint="/publishers"
              value={values.publisherId || null}
              valueLabel={labels.publisher ?? null}
              onChange={(id, label) => {
                setLabels((l) => ({ ...l, publisher: label }));
                setFilters({ publisherId: id ?? '' });
              }}
              mapItem={(item: { id: string; name: string; bookCount: number }) => ({
                id: item.id, label: item.name, hint: `${toPersianDigits(item.bookCount)} کتاب`,
              })}
              placeholder="همه ناشران"
            />
          </Field>

          <Field label="پدیدآورنده">
            <EntityPicker
              endpoint="/persons"
              value={values.personId || null}
              valueLabel={labels.person ?? null}
              onChange={(id, label) => {
                setLabels((l) => ({ ...l, person: label }));
                setFilters({ personId: id ?? '' });
              }}
              mapItem={(item: { id: string; fullName: string; bookCount: number }) => ({
                id: item.id, label: item.fullName, hint: `${toPersianDigits(item.bookCount)} اثر`,
              })}
              placeholder="همه پدیدآورندگان"
            />
          </Field>

          <Field label="مجموعه">
            <EntityPicker
              endpoint="/series"
              value={values.seriesId || null}
              valueLabel={labels.series ?? null}
              onChange={(id, label) => {
                setLabels((l) => ({ ...l, series: label }));
                setFilters({ seriesId: id ?? '' });
              }}
              mapItem={(item: { id: string; title: string; bookCount: number }) => ({
                id: item.id, label: item.title, hint: `${toPersianDigits(item.bookCount)} جلد`,
              })}
              placeholder="همه مجموعه‌ها"
            />
          </Field>

          <Field label="زبان">
            <Select
              value={values.language}
              onChange={(e) => setFilters({ language: e.target.value })}
              aria-label="فیلتر زبان"
            >
              <option value="">همه زبان‌ها</option>
              {Object.entries(LANGUAGES).map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </Select>
          </Field>

          <Field label="سال انتشار از">
            <Input
              type="number" ltr value={values.yearFrom} placeholder="۱۳۸۰"
              onChange={(e) => setFilters({ yearFrom: e.target.value })}
              aria-label="سال انتشار از"
            />
          </Field>

          <Field label="سال انتشار تا">
            <Input
              type="number" ltr value={values.yearTo} placeholder="۱۴۰۵"
              onChange={(e) => setFilters({ yearTo: e.target.value })}
              aria-label="سال انتشار تا"
            />
          </Field>

          <Field label="وضعیت موجودی">
            <Select
              value={values.availableOnly ? 'available' : values.hasCopies === 'false' ? 'nocopies' : ''}
              onChange={(e) => {
                const v = e.target.value;
                setFilters({
                  availableOnly: v === 'available' ? 'true' : '',
                  hasCopies: v === 'nocopies' ? 'false' : '',
                });
              }}
              aria-label="فیلتر موجودی"
            >
              <option value="">همه کتاب‌ها</option>
              <option value="available">فقط دارای نسخه موجود</option>
              <option value="nocopies">بدون نسخه فیزیکی</option>
            </Select>
          </Field>

          {can('books.delete') ? (
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
          <TableSkeleton columns={6} />
        ) : data && data.data.length > 0 ? (
          <>
            <TableWrapper className={isFetching ? 'opacity-60 transition-opacity' : undefined}>
              <thead>
                <tr>
                  <SortableHeader
                    column="title" label="عنوان و پدیدآورنده"
                    sort={values.sort} order={values.order as 'asc' | 'desc'}
                    onSort={(sort, order) => setFilters({ sort, order })}
                  />
                  <Th>ناشر</Th>
                  <SortableHeader
                    column="publicationYear" label="سال" numeric defaultOrder="desc"
                    sort={values.sort} order={values.order as 'asc' | 'desc'}
                    onSort={(sort, order) => setFilters({ sort, order })}
                  />
                  <Th>شابک</Th>
                  <SortableHeader
                    column="copies" label="موجود / کل" numeric defaultOrder="desc"
                    sort={values.sort} order={values.order as 'asc' | 'desc'}
                    onSort={(sort, order) => setFilters({ sort, order })}
                  />
                  <Th className="w-28">وضعیت</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((book) => (
                  <tr
                    key={book.id}
                    onClick={() => navigate(`/books/${book.id}`)}
                    className="cursor-pointer transition hover:bg-surface-sunken"
                  >
                    <Td>
                      <Link
                        to={`/books/${book.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-content hover:text-primary hover:underline"
                      >
                        {book.title}
                      </Link>
                      {book.volumeNumber ? (
                        <span className="ms-1 text-xs text-content-muted">
                          (جلد {toPersianDigits(book.volumeNumber)})
                        </span>
                      ) : null}
                      {book.deletedAt ? <Badge tone="danger" className="ms-2">بایگانی‌شده</Badge> : null}
                      <p className="mt-0.5 truncate text-xs text-content-muted">
                        {book.contributors.length > 0
                          ? book.contributors
                              .map((c) =>
                                c.role === 'AUTHOR'
                                  ? c.person.fullName
                                  : `${c.person.fullName} (${CONTRIBUTOR_ROLE[c.role as keyof typeof CONTRIBUTOR_ROLE] ?? c.role})`,
                              )
                              .join('، ')
                          : 'بدون پدیدآورنده'}
                      </p>
                    </Td>
                    <Td className="text-xs text-content-muted">{book.publisher?.name ?? '—'}</Td>
                    <Td numeric className="text-xs">
                      {book.publicationYear ? toPersianDigits(book.publicationYear) : '—'}
                    </Td>
                    <Td className="field-ltr text-xs text-content-muted">
                      {formatIdentifier(book.isbn13)}
                    </Td>
                    <Td numeric className="text-xs">
                      {toPersianDigits(book.availableCount)} / {toPersianDigits(book.copyCount)}
                    </Td>
                    <Td>
                      {book.copyCount === 0 ? (
                        <Badge tone="neutral">بدون نسخه</Badge>
                      ) : book.availableCount > 0 ? (
                        <Badge tone="success">موجود</Badge>
                      ) : (
                        <Badge tone="warning">همه در امانت</Badge>
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
            icon={hasActiveFilters ? <Tags className="size-6" /> : <Library className="size-6" />}
            title={hasActiveFilters ? 'کتابی با این فیلترها یافت نشد' : 'هنوز کتابی ثبت نشده'}
            description={
              hasActiveFilters
                ? 'فیلترها را تغییر دهید یا پاک کنید.'
                : 'اولین کتاب را ثبت کنید یا فهرست موجود را از فایل Excel وارد کنید.'
            }
            action={
              hasActiveFilters ? (
                <Button onClick={clearAll}>پاک کردن فیلترها</Button>
              ) : can('books.create') ? (
                <Button variant="primary" onClick={() => navigate('/books/new')}>ثبت کتاب جدید</Button>
              ) : null
            }
          />
        )}
      </Card>
    </>
  );
}
