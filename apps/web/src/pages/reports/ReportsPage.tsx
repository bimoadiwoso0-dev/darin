import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download, FileSpreadsheet, Printer } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import {
  Badge, Button, Card, CardHeader, EmptyState, Field, TableSkeleton,
  TableWrapper, Td, Th, cn,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { Pagination } from '@/components/shared/Pagination';
import { JalaliDateInput } from '@/components/shared/JalaliDateInput';
import { LocationSelect } from '@/components/shared/LocationSelect';
import { usePrintArea } from '@/hooks/usePrintArea';
import { useUrlFilters } from '@/hooks/useUrlFilters';
import { formatDate, formatMoney, formatNumber, toPersianDigits } from '@/lib/format';

interface ReportColumn {
  key: string;
  label: string;
  type?: 'number' | 'date' | 'money' | 'text';
}

interface ReportDefinition {
  key: string;
  title: string;
  description: string;
  group: 'collection' | 'circulation' | 'members' | 'finance' | 'operations';
  columns: ReportColumn[];
}

const GROUP_LABELS: Record<ReportDefinition['group'], string> = {
  collection: 'مجموعه',
  circulation: 'امانت',
  members: 'اعضا',
  finance: 'مالی',
  operations: 'عملیات',
};

const DEFAULTS = {
  key: '',
  page: 1,
  pageSize: 50,
  from: '',
  to: '',
  locationId: '',
};

/**
 * گزارش‌ها (قوانین ۳۷، ۳۸، ۹۹).
 *
 * ── چرا یک صفحه برای همه گزارش‌ها ───────────────────────────────────────
 * تعریف هر گزارش (عنوان، ستون‌ها، نوع هر ستون) از سرور می‌آید. افزودن
 * گزارش جدید در Backend، بدون هیچ تغییری در این صفحه، آن را به فهرست
 * اضافه می‌کند. ساختن ۱۲ صفحه تقریباً یکسان، ۱۲ برابر کار نگهداری بود.
 *
 * ── خروجی واقعی است (قانون ۱۳۴) ─────────────────────────────────────────
 * دکمه Excel یک فایل xlsx واقعی از سرور می‌گیرد که همان فیلترهای صفحه را
 * اعمال کرده است — نه یک نمونه ثابت.
 */
export function ReportsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const print = usePrintArea();
  const { values, setFilters } = useUrlFilters(DEFAULTS);
  const [exporting, setExporting] = React.useState<'xlsx' | 'csv' | null>(null);

  const { data: definitions, isLoading: definitionsLoading } = useQuery({
    queryKey: ['reports', 'definitions'],
    queryFn: () => api.get<ReportDefinition[]>('/reports'),
    staleTime: Infinity,
  });

  const activeKey = values.key || definitions?.[0]?.key || '';

  const reportQuery = {
    page: values.page,
    pageSize: values.pageSize,
    from: values.from || undefined,
    to: values.to || undefined,
    locationId: values.locationId || undefined,
  };

  const { data: report, isLoading, isFetching } = useQuery({
    queryKey: ['reports', activeKey, reportQuery],
    queryFn: () =>
      api.get<Paginated<Record<string, unknown>> & { definition: ReportDefinition }>(
        `/reports/${activeKey}`,
        reportQuery,
      ),
    enabled: !!activeKey,
    placeholderData: (previous) => previous,
  });

  const onExport = async (format: 'xlsx' | 'csv') => {
    setExporting(format);
    try {
      await api.download(`/reports/${activeKey}/export`, { ...reportQuery, format });
      toast.success('فایل خروجی ساخته شد', 'دانلود در مرورگر آغاز شد.');
    } catch (error) {
      toast.apiError(error, 'خروجی گرفتن انجام نشد');
    } finally {
      setExporting(null);
    }
  };

  const grouped = React.useMemo(() => {
    const map = new Map<ReportDefinition['group'], ReportDefinition[]>();
    for (const definition of definitions ?? []) {
      const list = map.get(definition.group) ?? [];
      list.push(definition);
      map.set(definition.group, list);
    }
    return [...map.entries()];
  }, [definitions]);

  const definition = report?.definition;

  return (
    <>
      <PageHeader
        title="گزارش‌ها"
        description={
          definition ? definition.description : `${toPersianDigits(definitions?.length ?? 0)} گزارش موجود`
        }
        actions={
          activeKey ? (
            <>
              <Button onClick={print} icon={<Printer className="size-4" />}>چاپ</Button>
              {can('reports.export') ? (
                <>
                  <Button
                    onClick={() => void onExport('csv')}
                    loading={exporting === 'csv'}
                    icon={<Download className="size-4" />}
                  >
                    CSV
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => void onExport('xlsx')}
                    loading={exporting === 'xlsx'}
                    icon={<FileSpreadsheet className="size-4" />}
                  >
                    خروجی Excel
                  </Button>
                </>
              ) : null}
            </>
          ) : null
        }
      />

      <div className="grid gap-4 lg:grid-cols-4">
        {/* ── فهرست گزارش‌ها ─────────────────────────────────────────── */}
        <Card className="no-print lg:col-span-1">
          <CardHeader title="انتخاب گزارش" />
          {definitionsLoading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="skeleton h-8 rounded" />
              ))}
            </div>
          ) : (
            <nav className="p-2">
              {grouped.map(([group, items]) => (
                <div key={group} className="mb-3 last:mb-0">
                  <p className="px-2 pb-1 text-2xs font-semibold uppercase tracking-wide text-content-subtle">
                    {GROUP_LABELS[group]}
                  </p>
                  <ul className="space-y-0.5">
                    {items.map((item) => (
                      <li key={item.key}>
                        <button
                          type="button"
                          onClick={() => setFilters({ key: item.key, page: 1 })}
                          className={cn(
                            'w-full rounded px-2.5 py-2 text-start text-sm transition',
                            activeKey === item.key
                              ? 'bg-primary-soft font-medium text-primary'
                              : 'text-content-muted hover:bg-surface-sunken hover:text-content',
                          )}
                        >
                          {item.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          )}
        </Card>

        {/* ── نتیجه گزارش ───────────────────────────────────────────── */}
        <div className="lg:col-span-3">
          <Card className="print-area">
            <CardHeader
              title={definition?.title ?? 'گزارش'}
              description={
                report ? `${formatNumber(report.meta.total)} ردیف` : 'در حال بارگذاری…'
              }
              action={
                report && report.meta.total > 0 ? (
                  <Badge tone="neutral">{formatNumber(report.meta.total)} رکورد</Badge>
                ) : null
              }
            />

            {/* فیلترهای مشترک همه گزارش‌ها */}
            <div className="no-print grid gap-3 border-b border-border bg-surface-sunken p-3 sm:grid-cols-3">
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
              <Field label="محدود به مکان">
                <LocationSelect
                  value={values.locationId || null}
                  onChange={(id) => setFilters({ locationId: id ?? '' })}
                  placeholder="همه مکان‌ها"
                />
              </Field>
            </div>

            {isLoading ? (
              <TableSkeleton columns={6} />
            ) : report && report.data.length > 0 && definition ? (
              <>
                <TableWrapper className={isFetching ? 'opacity-60 transition-opacity' : undefined}>
                  <thead>
                    <tr>
                      {definition.columns.map((column) => (
                        <Th
                          key={column.key}
                          numeric={column.type === 'number'}
                          amount={column.type === 'money'}
                        >
                          {column.label}
                        </Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.data.map((row, index) => (
                      <tr key={index} className="transition hover:bg-surface-sunken">
                        {definition.columns.map((column) => (
                          <Td
                            key={column.key}
                            numeric={column.type === 'number'}
                            amount={column.type === 'money'}
                            className="text-xs"
                          >
                            {renderCell(row[column.key], column.type)}
                          </Td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </TableWrapper>

                <Pagination
                  meta={report.meta}
                  onPageChange={(page) => setFilters({ page }, { resetPage: false })}
                  onPageSizeChange={(pageSize) => setFilters({ pageSize })}
                />
              </>
            ) : (
              <EmptyState
                icon={<BarChart3 className="size-6" />}
                title="این گزارش در بازه انتخاب‌شده داده‌ای ندارد"
                description="بازه تاریخ یا مکان را تغییر دهید."
              />
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

/**
 * نمایش یک سلول بر اساس نوع ستون.
 *
 * نوع ستون از تعریف گزارش در سرور می‌آید، پس قالب‌بندی تاریخ شمسی و مبلغ
 * برای همه گزارش‌ها یکسان است و در هر گزارش تکرار نمی‌شود.
 */
function renderCell(value: unknown, type?: ReportColumn['type']): React.ReactNode {
  if (value === null || value === undefined || value === '') {
    return <span className="text-content-subtle">—</span>;
  }
  if (type === 'date') {
    return formatDate(value instanceof Date || typeof value === 'string' ? value : null);
  }
  if (type === 'money') return formatMoney(Number(value));
  if (type === 'number') return toPersianDigits(Number(value));

  /*
   * ستون‌های گزارش مقدار ساده دارند، اما مقدار از JSON سرور می‌آید و نوعش
   * `unknown` است. اگر روزی ستونی آرایه یا شیء برگرداند، `String(value)`
   * در گزارش کتابدار «[object Object]» چاپ می‌کرد — چیزی که نه معنا دارد
   * نه می‌شود فهمید از کجا آمده.
   */
  if (Array.isArray(value)) return value.map((v) => String(v)).join('، ');
  if (typeof value === 'object') {
    return <code className="field-ltr text-2xs">{JSON.stringify(value)}</code>;
  }
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- آرایه و شیء بالاتر جدا شده‌اند
  return String(value);
}
