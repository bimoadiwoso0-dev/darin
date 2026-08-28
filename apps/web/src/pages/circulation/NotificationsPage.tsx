import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, CheckCheck, Phone, X } from 'lucide-react';
import { NOTIFICATION_TYPE } from '@darin/shared';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import {
  Badge, Button, Card, EmptyState, Field, Select, TableSkeleton,
  TableWrapper, Td, Th,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { Pagination } from '@/components/shared/Pagination';
import { useUrlFilters } from '@/hooks/useUrlFilters';
import { formatDate, formatNumber, formatRelative, toPersianDigits } from '@/lib/format';

interface NotificationRow {
  id: string;
  type: keyof typeof NOTIFICATION_TYPE;
  status: 'PENDING' | 'SENT' | 'FAILED' | 'READ' | 'CANCELLED';
  channel: string;
  title: string;
  body: string;
  payload: { loanId?: string } | null;
  createdAt: string;
  sentAt: string | null;
  member: {
    id: string; memberCode: string; fullName: string;
    mobile: string | null; status: string;
  } | null;
}

const DEFAULTS = { page: 1, pageSize: 20, status: 'PENDING', type: '' };

/**
 * صندوق یادآوری‌ها — فهرست کار پیگیری کتابدار.
 *
 * ── چرا این صفحه وجود دارد ──────────────────────────────────────────────
 * کار شبانه نگهداری برای هر امانتِ نزدیک به موعد یک یادآوری می‌سازد.
 * گیرنده این یادآوری‌ها «عضو» است، ولی در این نسخه عضو حساب کاربری ندارد
 * و کانال پیامک هم هنوز وصل نشده. بدون این صفحه، آن ردیف‌ها ساخته می‌شدند
 * و هیچ‌کس هرگز نمی‌دیدشان.
 *
 * پس تا وصل شدن پیامک، این فهرستِ «امروز با چه کسانی تماس بگیرم» است. به
 * همین دلیل شماره تماس کنار هر ردیف است و دکمه شماره‌گیری مستقیم دارد —
 * کتابدار نباید برای پیدا کردن شماره، به پروفایل عضو برود و برگردد.
 */
export function NotificationsPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();
  const { values, setFilters } = useUrlFilters(DEFAULTS);

  const query = {
    page: values.page,
    pageSize: values.pageSize,
    status: values.status || undefined,
    type: values.type || undefined,
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['notifications', query],
    queryFn: () => api.get<Paginated<NotificationRow>>('/notifications', query),
    placeholderData: (previous) => previous,
  });

  const { data: summary } = useQuery({
    queryKey: ['notifications', 'summary'],
    queryFn: () => api.get<{ pending: number; byType: Record<string, number> }>(
      '/notifications/summary',
    ),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };

  const handled = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/handled`, {}),
    onSuccess: () => {
      toast.success('انجام شد', 'این یادآوری از فهرست کار خارج شد.');
      invalidate();
    },
    onError: (error) => toast.apiError(error, 'ثبت انجام یادآوری ممکن نشد'),
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/dismiss`, {}),
    onSuccess: () => {
      toast.success('یادآوری لغو شد');
      invalidate();
    },
    onError: (error) => toast.apiError(error, 'لغو یادآوری ممکن نشد'),
  });

  const handleAll = useMutation({
    mutationFn: () => api.post<{ updated: number }>('/notifications/handle-all', {
      type: values.type || undefined,
    }),
    onSuccess: (result) => {
      toast.success(
        'انجام شد',
        `${toPersianDigits(result.updated)} یادآوری علامت خورد.`,
      );
      invalidate();
    },
    onError: (error) => toast.apiError(error, 'علامت زدن گروهی ممکن نشد'),
  });

  const canAct = can('notifications.manage');
  const pending = summary?.pending ?? 0;

  return (
    <>
      <PageHeader
        title="یادآوری‌ها"
        description={
          data
            ? `${formatNumber(data.meta.total)} یادآوری در این نما`
            : 'در حال بارگذاری…'
        }
        actions={
          canAct && values.status === 'PENDING' && (data?.data.length ?? 0) > 0 ? (
            <Button
              variant="secondary"
              onClick={() => handleAll.mutate()}
              disabled={handleAll.isPending}
              icon={<CheckCheck className="size-4" />}
            >
              علامت زدن همه
            </Button>
          ) : null
        }
      />

      {pending > 0 ? (
        <div className="mb-4 flex items-start gap-2 rounded border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning-content">
          <BellRing className="mt-0.5 size-4 shrink-0" />
          <span>
            {toPersianDigits(pending)} یادآوری پیگیری‌نشده دارید. تا وصل شدن سامانه پیامک،
            تماس با اعضا دستی انجام می‌شود.
          </span>
        </div>
      ) : null}

      <Card>
        <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
          <Field label="وضعیت" className="w-48">
            <Select
              value={values.status}
              onChange={(e) => setFilters({ status: e.target.value, page: 1 })}
              aria-label="فیلتر وضعیت یادآوری"
            >
              <option value="PENDING">پیگیری‌نشده</option>
              <option value="SENT">پیگیری‌شده</option>
              <option value="CANCELLED">لغوشده</option>
              <option value="">همه</option>
            </Select>
          </Field>
          <Field label="نوع" className="w-64">
            <Select
              value={values.type}
              onChange={(e) => setFilters({ type: e.target.value, page: 1 })}
              aria-label="فیلتر نوع یادآوری"
            >
              <option value="">همه انواع</option>
              {Object.entries(NOTIFICATION_TYPE).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                  {summary?.byType[key] ? ` (${toPersianDigits(summary.byType[key])})` : ''}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {isLoading ? (
          <TableSkeleton columns={5} />
        ) : data && data.data.length > 0 ? (
          <>
            <TableWrapper className={isFetching ? 'opacity-60 transition-opacity' : undefined}>
              <thead>
                <tr>
                  <Th>یادآوری</Th>
                  <Th>عضو</Th>
                  <Th className="w-36">نوع</Th>
                  <Th className="w-32">تاریخ</Th>
                  <Th className="w-40">عملیات</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((row) => (
                  <tr key={row.id} className="transition hover:bg-surface-sunken">
                    <Td>
                      <p className="text-sm text-content">{row.title}</p>
                      <p className="mt-0.5 text-xs text-content-muted">{row.body}</p>
                    </Td>
                    <Td>
                      {row.member ? (
                        <>
                          <Link
                            to={`/members/${row.member.id}`}
                            className="text-sm text-content hover:text-primary hover:underline"
                          >
                            {row.member.fullName}
                          </Link>
                          <p className="field-ltr mt-0.5 text-xs text-content-muted">
                            {row.member.memberCode}
                          </p>
                          {row.member.mobile ? (
                            <a
                              href={`tel:${row.member.mobile}`}
                              className="field-ltr mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                            >
                              <Phone className="size-3" />
                              {toPersianDigits(row.member.mobile)}
                            </a>
                          ) : (
                            <p className="mt-1 text-xs text-danger-content">شماره تماس ندارد</p>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-content-muted">—</span>
                      )}
                    </Td>
                    <Td className="text-xs">
                      <Badge tone={row.type === 'OVERDUE' ? 'danger' : 'neutral'}>
                        {NOTIFICATION_TYPE[row.type] ?? row.type}
                      </Badge>
                    </Td>
                    <Td className="text-xs text-content-muted">
                      {formatDate(row.createdAt)}
                      <p className="mt-0.5">{formatRelative(row.createdAt)}</p>
                    </Td>
                    <Td>
                      {row.status === 'PENDING' ? (
                        canAct ? (
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="secondary"
                              className="whitespace-nowrap"
                              onClick={() => handled.mutate(row.id)}
                              disabled={handled.isPending}
                            >
                              پیگیری شد
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="لغو یادآوری"
                              onClick={() => dismiss.mutate(row.id)}
                              disabled={dismiss.isPending}
                              icon={<X className="size-4" />}
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-content-muted">پیگیری‌نشده</span>
                        )
                      ) : (
                        <Badge tone={row.status === 'CANCELLED' ? 'neutral' : 'success'}>
                          {row.status === 'CANCELLED' ? 'لغوشده' : 'پیگیری‌شده'}
                          {row.sentAt ? ` · ${formatDate(row.sentAt)}` : ''}
                        </Badge>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrapper>

            <Pagination
              meta={data.meta}
              onPageChange={(page) => setFilters({ page })}
              onPageSizeChange={(pageSize) => setFilters({ pageSize, page: 1 })}
            />
          </>
        ) : (
          <EmptyState
            icon={<BellRing className="size-8" />}
            title={
              values.status === 'PENDING'
                ? 'یادآوری پیگیری‌نشده‌ای نیست'
                : 'یادآوری‌ای با این فیلتر یافت نشد'
            }
            description={
              values.status === 'PENDING'
                ? 'یادآوری‌ها هر شب بر اساس موعد بازگشت امانت‌ها ساخته می‌شوند.'
                : 'فیلتر را تغییر دهید.'
            }
          />
        )}
      </Card>
    </>
  );
}
