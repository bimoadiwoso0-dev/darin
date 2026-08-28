import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, ClipboardList, Play, Plus } from 'lucide-react';
import { INVENTORY_SESSION_STATUS } from '@darin/shared';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import {
  Badge, Button, Card, EmptyState, Field, Input, Modal, Select, TableSkeleton,
  TableWrapper, Td, Textarea, Th, cn,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { Pagination } from '@/components/shared/Pagination';
import { LocationSelect } from '@/components/shared/LocationSelect';
import { useUrlFilters } from '@/hooks/useUrlFilters';
import { formatDate, formatNumber, formatPercent, toPersianDigits } from '@/lib/format';

interface SessionRow {
  id: string; name: string; status: string; note: string | null;
  expectedCount: number; scannedCount: number; foundCount: number;
  missingCount: number; unexpectedCount: number;
  startedAt: string | null; completedAt: string | null; createdAt: string;
  scopeLocation: { name: string; fullCode: string } | null;
}

const DEFAULTS = { page: 1, pageSize: 20, status: '' };

/**
 * شمارش موجودی (قوانین ۵۰، ۵۱، ۵۲).
 *
 * ── چرا «جلسه» و نه یک عملیات یک‌باره ───────────────────────────────────
 * شمارش یک کتابخانه ۱۰٬۰۰۰ جلدی چند روز طول می‌کشد و بین چند نفر تقسیم
 * می‌شود. جلسه یعنی می‌توان کار را نیمه‌کاره رها کرد، فردا ادامه داد، و
 * در پایان گزارش مغایرت گرفت.
 *
 * ── چرا محدوده مکانی ────────────────────────────────────────────────────
 * معمولاً کل کتابخانه یکجا شمرده نمی‌شود؛ «بخش کودک» یا «قفسه ۷» شمرده
 * می‌شود. محدوده یعنی کتاب‌های بیرون آن محدوده «مفقود» علامت نمی‌خورند.
 */
export function InventoryPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();
  const { values, setFilters } = useUrlFilters(DEFAULTS);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [scopeLocationId, setScopeLocationId] = React.useState<string | null>(null);
  const [note, setNote] = React.useState('');

  const query = {
    page: values.page,
    pageSize: values.pageSize,
    status: values.status || undefined,
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['inventory', query],
    queryFn: () => api.get<Paginated<SessionRow>>('/inventory', query),
    placeholderData: (previous) => previous,
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/inventory', {
        name: name.trim(),
        scopeLocationId,
        note: note.trim() || undefined,
      }),
    onSuccess: (session) => {
      toast.success('جلسه شمارش ساخته شد', 'برای شروع اسکن، جلسه را باز کنید.');
      setCreateOpen(false);
      setName(''); setScopeLocationId(null); setNote('');
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      navigate(`/inventory/${session.id}`);
    },
    onError: (error) => toast.apiError(error, 'ساخت جلسه شمارش انجام نشد'),
  });

  return (
    <>
      <PageHeader
        title="شمارش موجودی"
        description={data ? `${formatNumber(data.meta.total)} جلسه` : 'در حال بارگذاری…'}
        actions={
          can('inventory.manage') ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)} icon={<Plus className="size-4" />}>
              جلسه شمارش جدید
            </Button>
          ) : null
        }
      />

      <Card>
        <div className="flex items-center justify-between gap-3 border-b border-border p-3">
          <p className="text-xs text-content-muted">
            هر جلسه یک بار شمارش است؛ در پایان، گزارش مغایرت کتاب‌های مفقود و
            جابه‌جاشده تولید می‌شود.
          </p>
          <Select
            value={values.status}
            onChange={(e) => setFilters({ status: e.target.value })}
            aria-label="فیلتر وضعیت جلسه"
            className="w-44 shrink-0"
          >
            <option value="">همه جلسات</option>
            {Object.entries(INVENTORY_SESSION_STATUS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </Select>
        </div>

        {isLoading ? (
          <TableSkeleton columns={5} />
        ) : data && data.data.length > 0 ? (
          <>
            <TableWrapper className={isFetching ? 'opacity-60 transition-opacity' : undefined}>
              <thead>
                <tr>
                  <Th>نام جلسه</Th>
                  <Th>محدوده</Th>
                  <Th>تاریخ</Th>
                  <Th className="w-48">پیشرفت</Th>
                  <Th className="w-28">وضعیت</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((session) => {
                  const rate =
                    session.expectedCount > 0
                      ? Math.round((session.foundCount / session.expectedCount) * 100)
                      : 0;
                  return (
                    <tr
                      key={session.id}
                      onClick={() => navigate(`/inventory/${session.id}`)}
                      className="cursor-pointer transition hover:bg-surface-sunken"
                    >
                      <Td>
                        <Link
                          to={`/inventory/${session.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="text-sm font-medium text-content hover:text-primary hover:underline"
                        >
                          {session.name}
                        </Link>
                        {session.note ? (
                          <p className="mt-0.5 truncate text-xs text-content-muted">{session.note}</p>
                        ) : null}
                      </Td>
                      <Td className="text-xs text-content-muted">
                        {session.scopeLocation ? (
                          <>
                            {session.scopeLocation.name}
                            <span className="block font-mono text-2xs text-content-subtle" dir="ltr">
                              {session.scopeLocation.fullCode}
                            </span>
                          </>
                        ) : (
                          'کل کتابخانه'
                        )}
                      </Td>
                      <Td className="text-xs text-content-muted">
                        {formatDate(session.startedAt ?? session.createdAt)}
                        {session.completedAt ? (
                          <span className="block text-2xs text-content-subtle">
                            پایان: {formatDate(session.completedAt)}
                          </span>
                        ) : null}
                      </Td>
                      <Td>
                        <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                          <div
                            className={cn(
                              'h-full rounded-full',
                              rate >= 95 ? 'bg-success' : rate >= 60 ? 'bg-info' : 'bg-warning',
                            )}
                            style={{ width: `${Math.min(100, rate)}%` }}
                          />
                        </div>
                        <p className="mt-1 text-2xs text-content-muted">
                          {toPersianDigits(session.foundCount)} از{' '}
                          {toPersianDigits(session.expectedCount)} ({formatPercent(rate)})
                        </p>
                      </Td>
                      <Td>
                        <Badge tone={sessionTone(session.status)}>
                          {INVENTORY_SESSION_STATUS[
                            session.status as keyof typeof INVENTORY_SESSION_STATUS
                          ] ?? session.status}
                        </Badge>
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
            icon={<ClipboardList className="size-6" />}
            title="هنوز شمارشی انجام نشده"
            description="یک جلسه شمارش بسازید و با بارکدخوان، قفسه‌ها را یکی‌یکی اسکن کنید."
            action={
              can('inventory.manage') ? (
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  ساخت اولین جلسه شمارش
                </Button>
              ) : null
            }
          />
        )}
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="جلسه شمارش جدید"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>انصراف</Button>
            <Button
              variant="primary"
              onClick={() => create.mutate()}
              loading={create.isPending}
              disabled={!name.trim()}
              icon={<Play className="size-4" />}
            >
              ساخت جلسه
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="نام جلسه" required hint="مثلاً: شمارش بخش کودک — پاییز ۱۴۰۵">
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>

          <Field
            label="محدوده شمارش"
            hint="خالی بگذارید تا کل کتابخانه شمرده شود. با انتخاب یک مکان، فقط نسخه‌های آن و زیرمجموعه‌هایش انتظار می‌روند."
          >
            <LocationSelect
              value={scopeLocationId}
              onChange={(id) => setScopeLocationId(id)}
              placeholder="کل کتابخانه"
            />
          </Field>

          <Field label="یادداشت">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </Field>

          <div className="flex items-start gap-2 rounded border border-info/30 bg-info-soft p-3 text-xs text-info-content">
            <ClipboardCheck className="mt-0.5 size-4 shrink-0" />
            <p>
              پس از ساخت جلسه، فهرست نسخه‌های مورد انتظار از دیتابیس گرفته می‌شود.
              کتاب‌هایی که در همان لحظه در امانت‌اند، «مفقود» شمرده نمی‌شوند.
            </p>
          </div>
        </div>
      </Modal>
    </>
  );
}

function sessionTone(status: string): 'success' | 'info' | 'warning' | 'neutral' {
  switch (status) {
    case 'COMPLETED': return 'success';
    case 'IN_PROGRESS': return 'info';
    case 'DRAFT': return 'warning';
    default: return 'neutral';
  }
}
