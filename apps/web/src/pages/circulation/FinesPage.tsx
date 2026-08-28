import * as React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, HandCoins, Plus, Wallet } from 'lucide-react';
import { FINE_STATUS, FINE_TYPE, PAYMENT_METHOD } from '@darin/shared';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import {
  Badge, Button, Card, EmptyState, Field, Input, Modal, Select, TableSkeleton,
  TableWrapper, Td, Textarea, Th, cn,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { FilterBar } from '@/components/shared/FilterBar';
import { Pagination } from '@/components/shared/Pagination';
import { MemberQuickSearch } from '@/components/circulation/MemberQuickSearch';
import { useUrlFilters } from '@/hooks/useUrlFilters';
import { formatDate, formatMoney, formatNumber, toPersianDigits } from '@/lib/format';

interface FineRow {
  id: string; type: string; status: string; currency: string;
  amount: number; paidAmount: number; remaining: number;
  reason: string | null; overdueDays: number | null;
  issuedAt: string; settledAt: string | null; waiveReason: string | null;
  memberName: string;
  member: {
    id: string; memberCode: string; firstName: string; lastName: string; mobile: string | null;
  };
  loan: {
    id: string; loanNumber: string; dueAt: string; returnedAt: string | null;
    copy: { barcode: string; book: { id: string; title: string } };
  } | null;
}

interface FineMeta {
  page: number; pageSize: number; total: number; totalPages: number;
  totalAmount: number; totalPaid: number; totalOutstanding: number;
}

const DEFAULTS = {
  page: 1,
  pageSize: 20,
  type: '',
  unpaidOnly: 'true',
};

/**
 * جریمه‌ها و پرداخت‌ها (قوانین ۳۰، ۳۱، ۳۲).
 *
 * ── پیش‌فرض: بدهی‌های پرداخت‌نشده ────────────────────────────────────────
 * جریمه‌های تسویه‌شده تاریخ‌اند؛ آنچه کتابدار باید ببیند، بدهی جاری است.
 *
 * ── بخشش نیازمند دلیل است (قانون ۳۱) ────────────────────────────────────
 * صرف‌نظر کردن از جریمه یک تصمیم مالی است. سرور بدون دلیل آن را نمی‌پذیرد
 * و دلیل به همراه نام کاربر در گزارش فعالیت‌ها می‌ماند.
 */
export function FinesPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();
  const { values, setFilters } = useUrlFilters(DEFAULTS);

  const [payTarget, setPayTarget] = React.useState<FineRow | null>(null);
  const [payAmount, setPayAmount] = React.useState('');
  const [payMethod, setPayMethod] = React.useState('CASH');
  const [payReference, setPayReference] = React.useState('');

  const [waiveTarget, setWaiveTarget] = React.useState<FineRow | null>(null);
  const [waiveReason, setWaiveReason] = React.useState('');

  const [createOpen, setCreateOpen] = React.useState(false);
  const [newMemberId, setNewMemberId] = React.useState<string | null>(null);
  const [newMemberLabel, setNewMemberLabel] = React.useState<string | null>(null);
  const [newType, setNewType] = React.useState('OTHER');
  const [newAmount, setNewAmount] = React.useState('');
  const [newReason, setNewReason] = React.useState('');

  const query = {
    page: values.page,
    pageSize: values.pageSize,
    type: values.type || undefined,
    unpaidOnly: values.unpaidOnly || undefined,
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['fines', query],
    queryFn: () => api.get<Paginated<FineRow> & { meta: FineMeta }>('/fines', query),
    placeholderData: (previous) => previous,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['fines'] });
    void queryClient.invalidateQueries({ queryKey: ['members'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const pay = useMutation({
    mutationFn: () =>
      api.post(`/fines/${payTarget?.id}/pay`, {
        amount: Number(payAmount),
        method: payMethod,
        reference: payReference.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('پرداخت ثبت شد');
      setPayTarget(null);
      setPayAmount('');
      setPayReference('');
      invalidate();
    },
    onError: (error) => toast.apiError(error, 'ثبت پرداخت انجام نشد'),
  });

  const waive = useMutation({
    mutationFn: () =>
      api.post(`/fines/${waiveTarget?.id}/waive`, { reason: waiveReason.trim() }),
    onSuccess: () => {
      toast.success('جریمه بخشیده شد', 'دلیل بخشش در گزارش فعالیت‌ها ثبت شد.');
      setWaiveTarget(null);
      setWaiveReason('');
      invalidate();
    },
    onError: (error) => toast.apiError(error, 'بخشش جریمه انجام نشد'),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/fines', {
        memberId: newMemberId,
        type: newType,
        amount: Number(newAmount),
        reason: newReason.trim(),
      }),
    onSuccess: () => {
      toast.success('جریمه ثبت شد');
      setCreateOpen(false);
      setNewMemberId(null); setNewMemberLabel(null);
      setNewAmount(''); setNewReason('');
      invalidate();
    },
    onError: (error) => toast.apiError(error, 'ثبت جریمه انجام نشد'),
  });

  const meta = data?.meta;

  return (
    <>
      <PageHeader
        title="جریمه‌ها"
        description={data ? `${formatNumber(data.meta.total)} رکورد` : 'در حال بارگذاری…'}
        actions={
          can('fines.create') ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)} icon={<Plus className="size-4" />}>
              ثبت جریمه دستی
            </Button>
          ) : null
        }
      />

      {/* ── خلاصه مالی — از جمع سرور، نه محاسبه در مرورگر ─────────────── */}
      {meta ? (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryTile label="مجموع جریمه‌ها" value={formatMoney(meta.totalAmount)} tone="neutral" />
          <SummaryTile label="پرداخت‌شده" value={formatMoney(meta.totalPaid)} tone="success" />
          <SummaryTile
            label="مانده بدهی"
            value={formatMoney(meta.totalOutstanding)}
            tone={meta.totalOutstanding > 0 ? 'danger' : 'success'}
          />
        </div>
      ) : null}

      <Card>
        <FilterBar
          search=""
          onSearchChange={() => undefined}
          placeholder="جستجو در جریمه‌ها"
          actions={
            <div className="flex gap-2">
              <Select
                value={values.unpaidOnly}
                onChange={(e) => setFilters({ unpaidOnly: e.target.value })}
                aria-label="فیلتر وضعیت پرداخت"
                className="w-44"
              >
                <option value="true">فقط پرداخت‌نشده‌ها</option>
                <option value="">همه جریمه‌ها</option>
              </Select>
              <Select
                value={values.type}
                onChange={(e) => setFilters({ type: e.target.value })}
                aria-label="فیلتر نوع جریمه"
                className="w-44"
              >
                <option value="">همه انواع</option>
                {Object.entries(FINE_TYPE).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </Select>
            </div>
          }
        />

        {isLoading ? (
          <TableSkeleton columns={7} />
        ) : data && data.data.length > 0 ? (
          <>
            <TableWrapper className={isFetching ? 'opacity-60 transition-opacity' : undefined}>
              <thead>
                <tr>
                  <Th>عضو</Th>
                  <Th>نوع و شرح</Th>
                  <Th>تاریخ</Th>
                  <Th amount>مبلغ</Th>
                  <Th amount>مانده</Th>
                  <Th className="w-28">وضعیت</Th>
                  <Th className="w-36">عملیات</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((fine) => (
                  <tr key={fine.id} className="transition hover:bg-surface-sunken">
                    <Td>
                      <Link
                        to={`/members/${fine.member.id}`}
                        className="text-sm text-content hover:text-primary hover:underline"
                      >
                        {fine.memberName}
                      </Link>
                      <p className="field-ltr mt-0.5 text-xs text-content-muted">
                        {fine.member.memberCode}
                      </p>
                    </Td>
                    <Td>
                      <p className="text-xs text-content">
                        {FINE_TYPE[fine.type as keyof typeof FINE_TYPE] ?? fine.type}
                      </p>
                      <p className="mt-0.5 text-xs text-content-muted">
                        {fine.reason ??
                          (fine.overdueDays
                            ? `${toPersianDigits(fine.overdueDays)} روز دیرکرد`
                            : '—')}
                      </p>
                      {fine.loan ? (
                        <Link
                          to={`/books/${fine.loan.copy.book.id}`}
                          className="mt-0.5 block truncate text-2xs text-content-subtle hover:text-primary hover:underline"
                        >
                          {fine.loan.copy.book.title}
                        </Link>
                      ) : null}
                    </Td>
                    <Td className="text-xs text-content-muted">{formatDate(fine.issuedAt)}</Td>
                    <Td amount className="text-xs">{formatMoney(fine.amount)}</Td>
                    <Td amount className="text-xs">
                      {fine.remaining > 0 ? (
                        <span className="text-danger">{formatMoney(fine.remaining)}</span>
                      ) : (
                        <span className="text-content-subtle">—</span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={fineTone(fine.status)}>
                        {FINE_STATUS[fine.status as keyof typeof FINE_STATUS] ?? fine.status}
                      </Badge>
                    </Td>
                    <Td>
                      {fine.remaining > 0 ? (
                        <div className="flex gap-1">
                          {can('fines.collect') ? (
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => {
                                setPayTarget(fine);
                                setPayAmount(String(fine.remaining));
                              }}
                              icon={<HandCoins className="size-3.5" />}
                            >
                              پرداخت
                            </Button>
                          ) : null}
                          {can('fines.waive') ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setWaiveTarget(fine)}
                              icon={<BadgeCheck className="size-3.5" />}
                            >
                              بخشش
                            </Button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-xs text-content-subtle">
                          {fine.settledAt ? formatDate(fine.settledAt) : '—'}
                        </span>
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
            icon={<Wallet className="size-6" />}
            title={values.unpaidOnly ? 'بدهی پرداخت‌نشده‌ای نیست' : 'جریمه‌ای ثبت نشده'}
            description={
              values.unpaidOnly
                ? 'برای دیدن جریمه‌های تسویه‌شده، فیلتر را به «همه جریمه‌ها» تغییر دهید.'
                : undefined
            }
          />
        )}
      </Card>

      {/* ── ثبت پرداخت ─────────────────────────────────────────────── */}
      <Modal
        open={!!payTarget}
        onClose={() => setPayTarget(null)}
        title="ثبت پرداخت جریمه"
        description={payTarget ? `${payTarget.memberName} — مانده ${formatMoney(payTarget.remaining)}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPayTarget(null)}>انصراف</Button>
            <Button
              variant="primary"
              onClick={() => pay.mutate()}
              loading={pay.isPending}
              disabled={!payAmount || Number(payAmount) <= 0}
            >
              ثبت پرداخت
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field
            label="مبلغ پرداختی (تومان)"
            required
            hint={
              payTarget && Number(payAmount) > payTarget.remaining
                ? 'مبلغ بیشتر از مانده بدهی است و پذیرفته نمی‌شود.'
                : 'پرداخت جزئی مجاز است؛ وضعیت به «پرداخت جزئی» تغییر می‌کند.'
            }
          >
            <Input
              type="number" min={0} ltr value={payAmount} autoFocus
              onChange={(e) => setPayAmount(e.target.value)}
              invalid={!!payTarget && Number(payAmount) > payTarget.remaining}
            />
          </Field>

          <Field label="روش پرداخت" required>
            <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
              {Object.entries(PAYMENT_METHOD).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Select>
          </Field>

          <Field label="شماره پیگیری" hint="برای پرداخت کارتی یا انتقال بانکی">
            <Input ltr value={payReference} onChange={(e) => setPayReference(e.target.value)} />
          </Field>
        </div>
      </Modal>

      {/* ── بخشش جریمه ─────────────────────────────────────────────── */}
      <Modal
        open={!!waiveTarget}
        onClose={() => setWaiveTarget(null)}
        title="بخشش جریمه"
        description={waiveTarget ? `${waiveTarget.memberName} — ${formatMoney(waiveTarget.remaining)}` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setWaiveTarget(null)}>انصراف</Button>
            <Button
              variant="danger"
              onClick={() => waive.mutate()}
              loading={waive.isPending}
              disabled={waiveReason.trim().length < 3}
            >
              بخشش جریمه
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-content-muted">
            مانده این جریمه صفر می‌شود. این تصمیم مالی با نام شما و دلیلی که می‌نویسید
            در گزارش فعالیت‌ها ثبت می‌ماند.
          </p>
          <Field label="دلیل بخشش" required hint="حداقل ۳ نویسه — بدون دلیل ثبت نمی‌شود.">
            <Textarea
              value={waiveReason}
              onChange={(e) => setWaiveReason(e.target.value)}
              rows={3}
              autoFocus
            />
          </Field>
        </div>
      </Modal>

      {/* ── ثبت جریمه دستی ─────────────────────────────────────────── */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="ثبت جریمه دستی"
        description="برای مواردی مثل آسیب به کتاب یا تخلف از مقررات"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>انصراف</Button>
            <Button
              variant="primary"
              onClick={() => create.mutate()}
              loading={create.isPending}
              disabled={!newMemberId || !newAmount || !newReason.trim()}
            >
              ثبت جریمه
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="عضو" required>
            {newMemberId ? (
              <div className="flex items-center gap-2 rounded border border-border bg-surface-sunken px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-content">{newMemberLabel}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setNewMemberId(null); setNewMemberLabel(null); }}
                >
                  تغییر
                </Button>
              </div>
            ) : (
              <MemberQuickSearch
                onSelect={(memberId, member) => {
                  setNewMemberId(memberId);
                  setNewMemberLabel(`${member.fullName} — ${member.memberCode}`);
                }}
              />
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="نوع جریمه" required>
              <Select value={newType} onChange={(e) => setNewType(e.target.value)}>
                {Object.entries(FINE_TYPE).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </Select>
            </Field>

            <Field label="مبلغ (تومان)" required>
              <Input
                type="number" min={0} ltr value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
              />
            </Field>
          </div>

          <Field label="علت جریمه" required hint="برای عضو و برای سابقه، شفاف بنویسید.">
            <Textarea value={newReason} onChange={(e) => setNewReason(e.target.value)} rows={3} />
          </Field>
        </div>
      </Modal>
    </>
  );
}

const TILE_TONES = {
  neutral: 'border-border',
  success: 'border-success/30 bg-success-soft',
  danger: 'border-danger/30 bg-danger-soft',
} as const;

function SummaryTile({
  label, value, tone,
}: {
  label: string;
  value: string;
  tone: keyof typeof TILE_TONES;
}) {
  return (
    <div className={cn('rounded-lg border bg-surface px-4 py-3', TILE_TONES[tone])}>
      <p className="text-xs text-content-muted">{label}</p>
      <p className="mt-1 text-xl font-bold text-content">{value}</p>
    </div>
  );
}

function fineTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'PAID': return 'success';
    case 'PARTIALLY_PAID': return 'warning';
    case 'UNPAID': return 'danger';
    default: return 'neutral';
  }
}
