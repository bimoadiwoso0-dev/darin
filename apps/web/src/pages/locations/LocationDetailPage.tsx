import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Boxes, ChevronLeft, MapPin, Printer } from 'lucide-react';
import { COPY_STATUS, LOCATION_KIND } from '@darin/shared';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  Badge, Button, Card, CardHeader, DataRow, EmptyState, Skeleton,
  TableWrapper, Td, Th, cn,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { ShelfLabelModal } from '@/components/locations/ShelfLabelModal';
import { copyStatusTone } from '@/pages/books/CopiesListPage';
import { formatIdentifier, formatNumber, formatPercent, toPersianDigits } from '@/lib/format';

interface LocationDetail {
  id: string; name: string; code: string; fullCode: string; kind: string;
  capacity: number | null; isActive: boolean; note: string | null;
  copyCount: number; available: number | null;
  parent: { id: string; name: string; fullCode: string; kind: string } | null;
  children: Array<{
    id: string; name: string; code: string; fullCode: string; kind: string; capacity: number | null;
  }>;
  breadcrumb: Array<{ id: string; name: string; fullCode: string }>;
}

interface CopyRow {
  id: string; accessionNumber: string; barcode: string; status: string;
  positionCode: string | null;
  book: { id: string; title: string; contributors: Array<{ person: { fullName: string } }> };
  currentLoan: { member: { id: string; firstName: string; lastName: string } } | null;
}

/**
 * جزئیات یک مکان (قوانین ۱۰، ۸۳).
 *
 * ── چرا فهرست نسخه‌ها اینجاست ───────────────────────────────────────────
 * کتابدار جلوی قفسه ایستاده و می‌خواهد بداند طبق سیستم چه چیزهایی باید
 * اینجا باشد — برای قفسه‌چینی، شمارش سرانگشتی یا یافتن کتاب گم‌شده.
 * زیرمجموعه‌ها هم شامل می‌شوند چون «قفسه ۳» یعنی همه طبقه‌هایش.
 */
export function LocationDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [labelOpen, setLabelOpen] = React.useState(false);

  const { data: location, isLoading, isError } = useQuery({
    queryKey: ['locations', id],
    queryFn: () => api.get<LocationDetail>(`/locations/${id}`),
    enabled: !!id,
  });

  const { data: copies, isLoading: copiesLoading } = useQuery({
    queryKey: ['copies', { locationId: id, subtree: true }],
    queryFn: () =>
      api.get<Paginated<CopyRow>>('/copies', {
        locationId: id,
        locationSubtree: true,
        pageSize: 200,
        sort: 'accessionNumber',
        order: 'asc',
      }),
    enabled: !!id && can('copies.view'),
  });

  if (isError) {
    return (
      <Card className="mx-auto max-w-lg">
        <EmptyState
          icon={<MapPin className="size-6" />}
          title="مکان یافت نشد"
          action={<Button onClick={() => navigate('/locations')}>بازگشت به فهرست مکان‌ها</Button>}
        />
      </Card>
    );
  }

  if (isLoading || !location) {
    return (
      <>
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-64" />
      </>
    );
  }

  const utilization =
    location.capacity && location.capacity > 0
      ? Math.round((location.copyCount / location.capacity) * 100)
      : null;

  return (
    <>
      <PageHeader
        breadcrumb={
          <nav className="flex flex-wrap items-center gap-1 text-xs text-content-muted" aria-label="مسیر">
            <Link to="/locations" className="hover:text-primary hover:underline">مکان‌ها</Link>
            {location.breadcrumb.map((ancestor) => (
              <React.Fragment key={ancestor.id}>
                <ChevronLeft className="size-3" aria-hidden />
                <Link
                  to={`/locations/${ancestor.id}`}
                  className="hover:text-primary hover:underline"
                >
                  {ancestor.name}
                </Link>
              </React.Fragment>
            ))}
          </nav>
        }
        title={location.name}
        description={`${LOCATION_KIND[location.kind as keyof typeof LOCATION_KIND] ?? location.kind} · ${location.fullCode}`}
        actions={
          <>
            {can('labels.print') ? (
              <Button onClick={() => setLabelOpen(true)} icon={<Printer className="size-4" />}>
                چاپ برچسب QR
              </Button>
            ) : null}
            {can('copies.view') ? (
              <Button
                variant="primary"
                onClick={() => navigate(`/copies?locationId=${location.id}&locationSubtree=true`)}
                icon={<Boxes className="size-4" />}
              >
                مدیریت نسخه‌های این مکان
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {location.children.length > 0 ? (
            <Card>
              <CardHeader
                title="زیرمجموعه‌ها"
                description={`${toPersianDigits(location.children.length)} مکان`}
              />
              <ul className="divide-y divide-border">
                {location.children.map((child) => (
                  <li key={child.id}>
                    <Link
                      to={`/locations/${child.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-surface-sunken"
                    >
                      <MapPin className="size-4 shrink-0 text-content-subtle" />
                      <span className="min-w-0 flex-1 truncate text-sm text-content">
                        {child.name}
                      </span>
                      <span className="font-mono text-2xs text-content-subtle" dir="ltr">
                        {child.fullCode}
                      </span>
                      <Badge tone="neutral">
                        {LOCATION_KIND[child.kind as keyof typeof LOCATION_KIND] ?? child.kind}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {can('copies.view') ? (
            <Card>
              <CardHeader
                title="نسخه‌های این مکان"
                description="شامل همه زیرمجموعه‌ها"
                action={
                  copies ? (
                    <Badge tone="neutral">{formatNumber(copies.meta.total)} نسخه</Badge>
                  ) : null
                }
              />
              {copiesLoading ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-9" />)}
                </div>
              ) : copies && copies.data.length > 0 ? (
                <TableWrapper>
                  <thead>
                    <tr>
                      <Th>شماره ثبت</Th>
                      <Th>کتاب</Th>
                      <Th>جایگاه</Th>
                      <Th className="w-28">وضعیت</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {copies.data.map((copy) => (
                      <tr key={copy.id} className="transition hover:bg-surface-sunken">
                        <Td>
                          <Link
                            to={`/copies/${copy.id}`}
                            className="field-ltr text-xs font-medium text-content hover:text-primary hover:underline"
                          >
                            {formatIdentifier(copy.accessionNumber)}
                          </Link>
                        </Td>
                        <Td>
                          <Link
                            to={`/books/${copy.book.id}`}
                            className="text-sm text-content hover:text-primary hover:underline"
                          >
                            {copy.book.title}
                          </Link>
                          <p className="mt-0.5 truncate text-xs text-content-muted">
                            {copy.book.contributors.map((c) => c.person.fullName).join('، ') ||
                              'بدون پدیدآورنده'}
                          </p>
                        </Td>
                        <Td className="text-xs text-content-muted">
                          {copy.positionCode ?? '—'}
                        </Td>
                        <Td>
                          <Badge tone={copyStatusTone(copy.status)}>
                            {COPY_STATUS[copy.status as keyof typeof COPY_STATUS] ?? copy.status}
                          </Badge>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrapper>
              ) : (
                <EmptyState
                  icon={<Boxes className="size-6" />}
                  title="نسخه‌ای در این مکان نیست"
                  description="نسخه‌ها را از فهرست نسخه‌ها یا صفحه هر کتاب به اینجا منتقل کنید."
                />
              )}
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="مشخصات مکان" />
            <dl className="px-4 py-3">
              <DataRow label="کد کامل" value={location.fullCode} ltr />
              <DataRow
                label="نوع"
                value={LOCATION_KIND[location.kind as keyof typeof LOCATION_KIND] ?? location.kind}
              />
              <DataRow
                label="والد"
                value={
                  location.parent ? (
                    <Link
                      to={`/locations/${location.parent.id}`}
                      className="hover:text-primary hover:underline"
                    >
                      {location.parent.name}
                    </Link>
                  ) : (
                    'مکان ریشه'
                  )
                }
              />
              <DataRow label="نسخه‌های ثبت‌شده" value={formatNumber(location.copyCount)} />
              <DataRow
                label="ظرفیت"
                value={location.capacity !== null ? formatNumber(location.capacity) : 'تعریف نشده'}
              />
              <DataRow
                label="جای خالی"
                value={location.available !== null ? formatNumber(location.available) : '—'}
              />
              <DataRow label="وضعیت" value={location.isActive ? 'فعال' : 'غیرفعال'} />
            </dl>

            {utilization !== null ? (
              <div className="border-t border-border p-4">
                <div className="mb-1.5 flex items-baseline justify-between text-xs">
                  <span className="text-content-muted">میزان پرشدگی</span>
                  <span
                    className={cn(
                      'font-medium',
                      utilization >= 90
                        ? 'text-danger'
                        : utilization >= 70
                          ? 'text-warning'
                          : 'text-success',
                    )}
                  >
                    {formatPercent(utilization)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      utilization >= 90
                        ? 'bg-danger'
                        : utilization >= 70
                          ? 'bg-warning'
                          : 'bg-success',
                    )}
                    style={{ width: `${Math.min(100, utilization)}%` }}
                  />
                </div>
              </div>
            ) : null}
          </Card>

          {location.note ? (
            <Card>
              <CardHeader title="یادداشت" />
              <p className="whitespace-pre-line p-4 text-xs leading-relaxed text-content-muted">
                {location.note}
              </p>
            </Card>
          ) : null}
        </div>
      </div>

      <ShelfLabelModal
        open={labelOpen}
        onClose={() => setLabelOpen(false)}
        locationId={location.id}
      />
    </>
  );
}
