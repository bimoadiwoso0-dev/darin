import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, UserPlus, Users } from 'lucide-react';
import { MEMBER_STATUS } from '@darin/shared';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import {
  Badge, Button, Card, EmptyState, Field, Select, TableSkeleton, TableWrapper, Td, Th,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { FilterBar } from '@/components/shared/FilterBar';
import { Pagination } from '@/components/shared/Pagination';
import { SortableHeader } from '@/components/shared/SortableHeader';
import { useDebounced, useUrlFilters } from '@/hooks/useUrlFilters';
import { formatDate, formatMoney, formatNumber, formatRelative, toPersianDigits } from '@/lib/format';

interface MemberRow {
  id: string;
  memberCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  mobile: string | null;
  email: string | null;
  status: string;
  joinedAt: string;
  expiresAt: string | null;
  membershipType: { id: string; name: string } | null;
  activeLoans: number;
  overdueLoans: number;
  outstandingDebt: number;
}

interface MembershipType {
  id: string; name: string; maxLoans: number | null; loanDays: number | null;
}

const DEFAULTS = {
  q: '',
  page: 1,
  pageSize: 20,
  sort: 'name',
  order: 'asc',
  status: '',
  membershipTypeId: '',
  hasOverdue: '',
  hasUnpaidFines: '',
  expiringWithinDays: '',
  includeDeleted: '',
};

/**
 * فهرست اعضا (قوانین ۱۳، ۱۴، ۱۴۹).
 *
 * ── حریم خصوصی (قانون ۱۴۹) ──────────────────────────────────────────────
 * این صفحه پشت احراز هویت و مجوز `members.view` است. کد ملی و نشانی
 * حتی اینجا هم نمایش داده نمی‌شوند — فقط در پروفایل عضو و برای کاربری
 * که واقعاً به آن نیاز دارد.
 *
 * ── چرا ستون بدهی و دیرکرد ──────────────────────────────────────────────
 * کتابدار پیش از امانت دادن باید در یک نگاه بفهمد این عضو مشکلی دارد یا
 * نه. گشتن در پروفایل هر عضو، میز امانت را کند می‌کند.
 */
export function MembersListPage() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const toast = useToast();
  const { values, setFilters, reset, hasActiveFilters } = useUrlFilters(DEFAULTS);

  const [searchInput, setSearchInput] = React.useState(values.q);
  const debouncedSearch = useDebounced(searchInput, 300);
  const [exporting, setExporting] = React.useState(false);

  React.useEffect(() => {
    if (debouncedSearch !== values.q) setFilters({ q: debouncedSearch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const { data: types } = useQuery({
    queryKey: ['members', 'membership-types'],
    queryFn: () => api.get<MembershipType[]>('/members/membership-types'),
    staleTime: 5 * 60_000,
  });

  const query = {
    q: values.q || undefined,
    page: values.page,
    pageSize: values.pageSize,
    sort: values.sort,
    order: values.order,
    status: values.status || undefined,
    membershipTypeId: values.membershipTypeId || undefined,
    hasOverdue: values.hasOverdue || undefined,
    hasUnpaidFines: values.hasUnpaidFines || undefined,
    expiringWithinDays: values.expiringWithinDays || undefined,
    includeDeleted: values.includeDeleted || undefined,
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['members', query],
    queryFn: () => api.get<Paginated<MemberRow>>('/members', query),
    placeholderData: (previous) => previous,
  });

  const activeFilterCount = [
    values.status, values.membershipTypeId, values.hasOverdue,
    values.hasUnpaidFines, values.expiringWithinDays, values.includeDeleted,
  ].filter(Boolean).length;

  const onExport = async () => {
    setExporting(true);
    try {
      await api.download('/reports/member-activity/export', { format: 'xlsx' });
      toast.success('فایل خروجی ساخته شد', 'دانلود در مرورگر آغاز شد.');
    } catch (error) {
      toast.apiError(error, 'خروجی گرفتن انجام نشد');
    } finally {
      setExporting(false);
    }
  };

  const clearAll = () => { reset(); setSearchInput(''); };

  return (
    <>
      <PageHeader
        title="اعضا"
        description={data ? `${formatNumber(data.meta.total)} عضو` : 'در حال بارگذاری…'}
        actions={
          <>
            {can('reports.export') ? (
              <Button onClick={() => void onExport()} loading={exporting} icon={<Download className="size-4" />}>
                خروجی Excel
              </Button>
            ) : null}
            {can('members.create') ? (
              <Button
                variant="primary"
                onClick={() => navigate('/members/new')}
                icon={<UserPlus className="size-4" />}
              >
                ثبت عضو جدید
              </Button>
            ) : null}
          </>
        }
      />

      <Card>
        <FilterBar
          search={searchInput}
          onSearchChange={setSearchInput}
          placeholder="نام، کد عضویت، موبایل یا کد ملی…"
          activeCount={activeFilterCount}
          onReset={hasActiveFilters ? clearAll : undefined}
        >
          <Field label="وضعیت عضویت">
            <Select
              value={values.status}
              onChange={(e) => setFilters({ status: e.target.value })}
              aria-label="فیلتر وضعیت"
            >
              <option value="">همه وضعیت‌ها</option>
              {Object.entries(MEMBER_STATUS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Select>
          </Field>

          <Field label="نوع عضویت">
            <Select
              value={values.membershipTypeId}
              onChange={(e) => setFilters({ membershipTypeId: e.target.value })}
              aria-label="فیلتر نوع عضویت"
            >
              <option value="">همه انواع</option>
              {types?.map((type) => (
                <option key={type.id} value={type.id}>{type.name}</option>
              ))}
            </Select>
          </Field>

          <Field label="وضعیت بدهی و دیرکرد">
            <Select
              value={values.hasOverdue ? 'overdue' : values.hasUnpaidFines ? 'debt' : ''}
              onChange={(e) => {
                const v = e.target.value;
                setFilters({
                  hasOverdue: v === 'overdue' ? 'true' : '',
                  hasUnpaidFines: v === 'debt' ? 'true' : '',
                });
              }}
              aria-label="فیلتر بدهی"
            >
              <option value="">همه اعضا</option>
              <option value="overdue">دارای کتاب دیرکرددار</option>
              <option value="debt">دارای جریمه پرداخت‌نشده</option>
            </Select>
          </Field>

          <Field label="انقضای عضویت">
            <Select
              value={values.expiringWithinDays}
              onChange={(e) => setFilters({ expiringWithinDays: e.target.value })}
              aria-label="فیلتر انقضا"
            >
              <option value="">بدون فیلتر</option>
              <option value="0">منقضی‌شده</option>
              <option value="30">انقضا در ۳۰ روز آینده</option>
              <option value="90">انقضا در ۹۰ روز آینده</option>
            </Select>
          </Field>
        </FilterBar>

        {isLoading ? (
          <TableSkeleton columns={6} />
        ) : data && data.data.length > 0 ? (
          <>
            <TableWrapper className={isFetching ? 'opacity-60 transition-opacity' : undefined}>
              <thead>
                <tr>
                  <SortableHeader
                    column="memberCode" label="کد عضویت"
                    sort={values.sort} order={values.order as 'asc' | 'desc'}
                    onSort={(sort, order) => setFilters({ sort, order })}
                  />
                  <SortableHeader
                    column="name" label="نام و نام خانوادگی"
                    sort={values.sort} order={values.order as 'asc' | 'desc'}
                    onSort={(sort, order) => setFilters({ sort, order })}
                  />
                  <Th>نوع عضویت</Th>
                  <Th amount>امانت جاری</Th>
                  <Th amount>بدهی</Th>
                  <SortableHeader
                    column="expiresAt" label="انقضا"
                    sort={values.sort} order={values.order as 'asc' | 'desc'}
                    onSort={(sort, order) => setFilters({ sort, order })}
                  />
                  <Th className="w-24">وضعیت</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((member) => (
                  <tr
                    key={member.id}
                    onClick={() => navigate(`/members/${member.id}`)}
                    className="cursor-pointer transition hover:bg-surface-sunken"
                  >
                    <Td className="field-ltr text-xs font-medium">{member.memberCode}</Td>
                    <Td>
                      <Link
                        to={`/members/${member.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-medium text-content hover:text-primary hover:underline"
                      >
                        {member.fullName}
                      </Link>
                      {member.mobile ? (
                        <p className="field-ltr mt-0.5 text-xs text-content-muted">{member.mobile}</p>
                      ) : null}
                    </Td>
                    <Td className="text-xs text-content-muted">
                      {member.membershipType?.name ?? '—'}
                    </Td>
                    <Td amount className="text-xs">
                      {toPersianDigits(member.activeLoans)}
                      {member.overdueLoans > 0 ? (
                        <Badge tone="danger" className="ms-1.5">
                          {toPersianDigits(member.overdueLoans)} دیرکرد
                        </Badge>
                      ) : null}
                    </Td>
                    <Td amount className="text-xs">
                      {member.outstandingDebt > 0 ? (
                        <span className="text-danger">{formatMoney(member.outstandingDebt)}</span>
                      ) : (
                        <span className="text-content-subtle">—</span>
                      )}
                    </Td>
                    <Td className="text-xs text-content-muted">
                      {member.expiresAt ? (
                        <>
                          {formatDate(member.expiresAt)}
                          <span className="block text-2xs text-content-subtle">
                            {formatRelative(member.expiresAt)}
                          </span>
                        </>
                      ) : (
                        'بدون انقضا'
                      )}
                    </Td>
                    <Td>
                      <Badge tone={memberStatusTone(member.status)}>
                        {MEMBER_STATUS[member.status as keyof typeof MEMBER_STATUS] ?? member.status}
                      </Badge>
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
            icon={<Users className="size-6" />}
            title={hasActiveFilters ? 'عضوی با این فیلترها یافت نشد' : 'هنوز عضوی ثبت نشده'}
            description={
              hasActiveFilters
                ? 'فیلترها را تغییر دهید یا پاک کنید.'
                : 'اولین عضو کتابخانه را ثبت کنید.'
            }
            action={
              hasActiveFilters ? (
                <Button onClick={clearAll}>پاک کردن فیلترها</Button>
              ) : can('members.create') ? (
                <Button variant="primary" onClick={() => navigate('/members/new')}>
                  ثبت عضو جدید
                </Button>
              ) : null
            }
          />
        )}
      </Card>
    </>
  );
}

export function memberStatusTone(
  status: string,
): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'ACTIVE': return 'success';
    case 'EXPIRED':
    case 'INACTIVE': return 'warning';
    case 'SUSPENDED':
    case 'BLOCKED': return 'danger';
    default: return 'neutral';
  }
}
