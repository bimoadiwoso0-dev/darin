import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive, BookOpen, Bookmark, CalendarPlus, CreditCard, History,
  Pencil, ShieldAlert, User, Wallet,
} from 'lucide-react';
import { FINE_STATUS, FINE_TYPE, MEMBER_STATUS, RESERVATION_STATUS } from '@darin/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, DataRow, EmptyState, Field,
  Modal, Select, Skeleton, TableWrapper, Td, Th, cn,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { MemberCardModal } from '@/components/members/MemberCardModal';
import { memberStatusTone } from './MembersListPage';
import {
  formatDate, formatMoney, formatNumber, formatRelative, toPersianDigits,
} from '@/lib/format';

interface MemberDetail {
  id: string; memberCode: string; firstName: string; lastName: string; fullName: string;
  nationalId: string | null; phone: string | null; mobile: string | null; email: string | null;
  address: string | null; postalCode: string | null; birthDate: string | null;
  gender: string; status: string; joinedAt: string; expiresAt: string | null;
  referrerName: string | null; emergencyContactName: string | null;
  emergencyContactPhone: string | null; note: string | null; deletedAt: string | null;
  membershipType: {
    id: string; name: string; maxLoans: number | null; loanDays: number | null;
    durationMonths: number | null;
  } | null;
  branch: { id: string; name: string } | null;
  currentLoans: Array<{
    id: string; loanNumber: string; loanedAt: string; dueAt: string;
    status: string; renewalCount: number;
    copy: {
      id: string; barcode: string; accessionNumber: string;
      book: { id: string; title: string; volumeTitle: string | null };
      location: { fullCode: string } | null;
    };
  }>;
  loanHistory: Array<{
    id: string; loanNumber: string; loanedAt: string; dueAt: string; returnedAt: string | null;
    copy: { book: { id: string; title: string } };
  }>;
  reservations: Array<{
    id: string; status: string; queuePosition: number; reservedAt: string;
    expiresAt: string | null; book: { id: string; title: string };
  }>;
  fines: Array<{
    id: string; type: string; status: string; amount: string; paidAmount: string;
    reason: string | null; issuedAt: string; overdueDays: number | null;
  }>;
  outstandingDebt: number;
  stats: {
    totalLoans: number; returnedCount: number; totalFinesAmount: number;
    favoriteCategories: Array<{ name: string; count: number }>;
  };
  effectivePolicy: {
    maxLoans: number; loanDays: number; maxRenewals: number;
    maxReservations: number; dailyFineAmount: number; canReserve: boolean;
  };
}

type Tab = 'loans' | 'history' | 'reservations' | 'fines';

/**
 * پروفایل عضو (قوانین ۱۵، ۱۶، ۱۴۹).
 *
 * ── چرا زبانه‌بندی ───────────────────────────────────────────────────────
 * یک عضو قدیمی می‌تواند صدها امانت در تاریخچه داشته باشد. نمایش همه در یک
 * صفحه، اطلاعات مهم (امانت‌های جاری و بدهی) را زیر انبوه داده دفن می‌کند.
 *
 * ── قانون ۱۴۹: اطلاعات شخصی ─────────────────────────────────────────────
 * کد ملی، نشانی و تماس اضطراری فقط اینجا و فقط برای کاربر دارای مجوز
 * نمایش داده می‌شوند؛ در هیچ فهرست یا صفحه دیگری تکرار نمی‌شوند.
 */
export function MemberDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();

  const [tab, setTab] = React.useState<Tab>('loans');
  const [cardOpen, setCardOpen] = React.useState(false);
  const [renewOpen, setRenewOpen] = React.useState(false);
  const [renewMonths, setRenewMonths] = React.useState('12');
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [newStatus, setNewStatus] = React.useState('ACTIVE');
  const [archiveOpen, setArchiveOpen] = React.useState(false);

  const { data: member, isLoading, isError } = useQuery({
    queryKey: ['members', id],
    queryFn: () => api.get<MemberDetail>(`/members/${id}`),
    enabled: !!id,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['members'] });
  };

  const renew = useMutation({
    mutationFn: () => api.post(`/members/${id}/renew`, { months: Number(renewMonths) }),
    onSuccess: () => {
      toast.success('عضویت تمدید شد');
      setRenewOpen(false);
      invalidate();
    },
    onError: (error) => toast.apiError(error, 'تمدید عضویت انجام نشد'),
  });

  const changeStatus = useMutation({
    mutationFn: () => api.post(`/members/${id}/status`, { status: newStatus }),
    onSuccess: () => {
      toast.success('وضعیت عضویت تغییر کرد');
      setStatusOpen(false);
      invalidate();
    },
    onError: (error) => toast.apiError(error, 'تغییر وضعیت انجام نشد'),
  });

  const archive = useMutation({
    mutationFn: () => api.delete(`/members/${id}`),
    onSuccess: () => {
      toast.success('عضو بایگانی شد', 'تاریخچه امانت‌های او حفظ شده است.');
      setArchiveOpen(false);
      invalidate();
      navigate('/members');
    },
    onError: (error) => toast.apiError(error, 'بایگانی انجام نشد'),
  });

  if (isError) {
    return (
      <Card className="mx-auto max-w-lg">
        <EmptyState
          icon={<User className="size-6" />}
          title="عضو یافت نشد"
          action={<Button onClick={() => navigate('/members')}>بازگشت به فهرست اعضا</Button>}
        />
      </Card>
    );
  }

  if (isLoading || !member) {
    return (
      <>
        <Skeleton className="mb-4 h-8 w-64" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </>
    );
  }

  const overdueCount = member.currentLoans.filter((l) => l.status === 'OVERDUE').length;
  const readyReservations = member.reservations.filter((r) => r.status === 'READY').length;

  const TABS: Array<{ key: Tab; label: string; count: number; icon: React.ComponentType<{ className?: string }> }> = [
    { key: 'loans', label: 'امانت‌های جاری', count: member.currentLoans.length, icon: BookOpen },
    { key: 'reservations', label: 'رزروها', count: member.reservations.length, icon: Bookmark },
    { key: 'fines', label: 'جریمه‌ها', count: member.fines.length, icon: Wallet },
    { key: 'history', label: 'تاریخچه', count: member.loanHistory.length, icon: History },
  ];

  return (
    <>
      <PageHeader
        breadcrumb={
          <nav className="flex items-center gap-1 text-xs text-content-muted" aria-label="مسیر">
            <Link to="/members" className="hover:text-primary hover:underline">اعضا</Link>
            <span aria-hidden>/</span>
            <span className="truncate">{member.fullName}</span>
          </nav>
        }
        title={member.fullName}
        description={`کد عضویت ${member.memberCode}${member.membershipType ? ` · ${member.membershipType.name}` : ''}`}
        actions={
          <>
            {can('members.card') ? (
              <Button onClick={() => setCardOpen(true)} icon={<CreditCard className="size-4" />}>
                کارت عضویت
              </Button>
            ) : null}
            {can('members.edit') ? (
              <>
                <Button onClick={() => setRenewOpen(true)} icon={<CalendarPlus className="size-4" />}>
                  تمدید عضویت
                </Button>
                <Button
                  onClick={() => { setNewStatus(member.status); setStatusOpen(true); }}
                  icon={<ShieldAlert className="size-4" />}
                >
                  تغییر وضعیت
                </Button>
                <Button
                  variant="primary"
                  onClick={() => navigate(`/members/${id}/edit`)}
                  icon={<Pencil className="size-4" />}
                >
                  ویرایش
                </Button>
              </>
            ) : null}
            {can('members.delete') && !member.deletedAt ? (
              <Button
                variant="ghost"
                onClick={() => setArchiveOpen(true)}
                icon={<Archive className="size-4" />}
                aria-label="بایگانی عضو"
              />
            ) : null}
          </>
        }
      />

      {/* ── هشدارهای وضعیت ───────────────────────────────────────────── */}
      <div className="mb-4 space-y-2">
        {member.status !== 'ACTIVE' ? (
          <Alert tone="danger">
            وضعیت این عضو «{MEMBER_STATUS[member.status as keyof typeof MEMBER_STATUS] ?? member.status}»
            است و تا اصلاح آن نمی‌تواند کتاب امانت بگیرد.
          </Alert>
        ) : null}
        {member.expiresAt && new Date(member.expiresAt) < new Date() ? (
          <Alert tone="warning">
            عضویت در {formatDate(member.expiresAt)} منقضی شده است ({formatRelative(member.expiresAt)}).
          </Alert>
        ) : null}
        {overdueCount > 0 ? (
          <Alert tone="danger">
            {toPersianDigits(overdueCount)} کتاب دیرکرد دارد.
          </Alert>
        ) : null}
        {member.outstandingDebt > 0 ? (
          <Alert tone="warning">
            بدهی پرداخت‌نشده: {formatMoney(member.outstandingDebt)}
          </Alert>
        ) : null}
        {readyReservations > 0 ? (
          <Alert tone="info">
            {toPersianDigits(readyReservations)} رزرو آماده تحویل دارد.
          </Alert>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            {/* زبانه‌ها */}
            <div className="flex gap-1 overflow-x-auto border-b border-border px-2 pt-2" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-t border-b-2 px-3 py-2 text-sm transition',
                    tab === t.key
                      ? 'border-primary font-medium text-primary'
                      : 'border-transparent text-content-muted hover:text-content',
                  )}
                >
                  <t.icon className="size-4" />
                  {t.label}
                  <Badge tone={tab === t.key ? 'primary' : 'neutral'}>
                    {toPersianDigits(t.count)}
                  </Badge>
                </button>
              ))}
            </div>

            {tab === 'loans' ? (
              member.currentLoans.length > 0 ? (
                <TableWrapper>
                  <thead>
                    <tr>
                      <Th>کتاب</Th>
                      <Th>بارکد</Th>
                      <Th>تاریخ امانت</Th>
                      <Th>موعد بازگشت</Th>
                      <Th className="w-24">وضعیت</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {member.currentLoans.map((loan) => (
                      <tr key={loan.id} className="transition hover:bg-surface-sunken">
                        <Td>
                          <Link
                            to={`/books/${loan.copy.book.id}`}
                            className="text-content hover:text-primary hover:underline"
                          >
                            {loan.copy.book.title}
                            {loan.copy.book.volumeTitle ? ` — ${loan.copy.book.volumeTitle}` : ''}
                          </Link>
                          {loan.renewalCount > 0 ? (
                            <span className="ms-1.5 text-2xs text-content-subtle">
                              ({toPersianDigits(loan.renewalCount)} بار تمدید شده)
                            </span>
                          ) : null}
                        </Td>
                        <Td className="field-ltr text-xs text-content-muted">{loan.copy.barcode}</Td>
                        <Td className="text-xs text-content-muted">{formatDate(loan.loanedAt)}</Td>
                        <Td className="text-xs">
                          {formatDate(loan.dueAt)}
                          <span
                            className={cn(
                              'block text-2xs',
                              loan.status === 'OVERDUE' ? 'text-danger' : 'text-content-subtle',
                            )}
                          >
                            {formatRelative(loan.dueAt)}
                          </span>
                        </Td>
                        <Td>
                          <Badge tone={loan.status === 'OVERDUE' ? 'danger' : 'success'}>
                            {loan.status === 'OVERDUE' ? 'دیرکرد' : 'جاری'}
                          </Badge>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrapper>
              ) : (
                <EmptyState
                  icon={<BookOpen className="size-6" />}
                  title="کتابی در امانت ندارد"
                  action={
                    can('loans.create') ? (
                      <Button
                        variant="primary"
                        onClick={() => navigate(`/circulation?memberId=${member.id}`)}
                      >
                        ثبت امانت جدید
                      </Button>
                    ) : null
                  }
                />
              )
            ) : null}

            {tab === 'reservations' ? (
              member.reservations.length > 0 ? (
                <TableWrapper>
                  <thead>
                    <tr>
                      <Th>کتاب</Th>
                      <Th numeric>نوبت در صف</Th>
                      <Th>تاریخ رزرو</Th>
                      <Th>مهلت تحویل</Th>
                      <Th className="w-28">وضعیت</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {member.reservations.map((reservation) => (
                      <tr key={reservation.id} className="transition hover:bg-surface-sunken">
                        <Td>
                          <Link
                            to={`/books/${reservation.book.id}`}
                            className="text-content hover:text-primary hover:underline"
                          >
                            {reservation.book.title}
                          </Link>
                        </Td>
                        <Td numeric className="text-xs">
                          {reservation.status === 'READY'
                            ? '—'
                            : toPersianDigits(reservation.queuePosition)}
                        </Td>
                        <Td className="text-xs text-content-muted">
                          {formatDate(reservation.reservedAt)}
                        </Td>
                        <Td className="text-xs text-content-muted">
                          {reservation.expiresAt ? (
                            <>
                              {formatDate(reservation.expiresAt)}
                              <span className="block text-2xs">
                                {formatRelative(reservation.expiresAt)}
                              </span>
                            </>
                          ) : (
                            '—'
                          )}
                        </Td>
                        <Td>
                          <Badge tone={reservation.status === 'READY' ? 'success' : 'info'}>
                            {RESERVATION_STATUS[reservation.status as keyof typeof RESERVATION_STATUS] ??
                              reservation.status}
                          </Badge>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrapper>
              ) : (
                <EmptyState icon={<Bookmark className="size-6" />} title="رزرو فعالی ندارد" />
              )
            ) : null}

            {tab === 'fines' ? (
              member.fines.length > 0 ? (
                <TableWrapper>
                  <thead>
                    <tr>
                      <Th>نوع</Th>
                      <Th>شرح</Th>
                      <Th>تاریخ</Th>
                      <Th amount>مبلغ</Th>
                      <Th amount>پرداخت‌شده</Th>
                      <Th className="w-28">وضعیت</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {member.fines.map((fine) => (
                      <tr key={fine.id} className="transition hover:bg-surface-sunken">
                        <Td className="text-xs">
                          {FINE_TYPE[fine.type as keyof typeof FINE_TYPE] ?? fine.type}
                        </Td>
                        <Td className="text-xs text-content-muted">
                          {fine.reason ??
                            (fine.overdueDays
                              ? `${toPersianDigits(fine.overdueDays)} روز دیرکرد`
                              : '—')}
                        </Td>
                        <Td className="text-xs text-content-muted">{formatDate(fine.issuedAt)}</Td>
                        <Td amount className="text-xs">{formatMoney(fine.amount)}</Td>
                        <Td amount className="text-xs text-content-muted">
                          {formatMoney(fine.paidAmount)}
                        </Td>
                        <Td>
                          <Badge tone={fineStatusTone(fine.status)}>
                            {FINE_STATUS[fine.status as keyof typeof FINE_STATUS] ?? fine.status}
                          </Badge>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrapper>
              ) : (
                <EmptyState icon={<Wallet className="size-6" />} title="جریمه‌ای ثبت نشده" />
              )
            ) : null}

            {tab === 'history' ? (
              member.loanHistory.length > 0 ? (
                <TableWrapper>
                  <thead>
                    <tr>
                      <Th>کتاب</Th>
                      <Th>تاریخ امانت</Th>
                      <Th>موعد</Th>
                      <Th>تاریخ بازگشت</Th>
                      <Th className="w-24">نتیجه</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {member.loanHistory.map((loan) => {
                      const late =
                        loan.returnedAt && new Date(loan.returnedAt) > new Date(loan.dueAt);
                      return (
                        <tr key={loan.id} className="transition hover:bg-surface-sunken">
                          <Td>
                            <Link
                              to={`/books/${loan.copy.book.id}`}
                              className="text-content hover:text-primary hover:underline"
                            >
                              {loan.copy.book.title}
                            </Link>
                          </Td>
                          <Td className="text-xs text-content-muted">{formatDate(loan.loanedAt)}</Td>
                          <Td className="text-xs text-content-muted">{formatDate(loan.dueAt)}</Td>
                          <Td className="text-xs text-content-muted">{formatDate(loan.returnedAt)}</Td>
                          <Td>
                            <Badge tone={late ? 'warning' : 'success'}>
                              {late ? 'با تأخیر' : 'به‌موقع'}
                            </Badge>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </TableWrapper>
              ) : (
                <EmptyState icon={<History className="size-6" />} title="تاریخچه امانتی ندارد" />
              )
            ) : null}
          </Card>
        </div>

        {/* ── ستون کناری ─────────────────────────────────────────────── */}
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="مشخصات عضو"
              action={
                <Badge tone={memberStatusTone(member.status)}>
                  {MEMBER_STATUS[member.status as keyof typeof MEMBER_STATUS] ?? member.status}
                </Badge>
              }
            />
            <dl className="px-4 py-3">
              <DataRow label="کد عضویت" value={member.memberCode} ltr />
              <DataRow label="نوع عضویت" value={member.membershipType?.name} />
              <DataRow label="تاریخ عضویت" value={formatDate(member.joinedAt)} />
              <DataRow
                label="انقضای عضویت"
                value={member.expiresAt ? formatDate(member.expiresAt) : 'بدون انقضا'}
              />
              <DataRow label="موبایل" value={member.mobile} ltr />
              <DataRow label="تلفن" value={member.phone} ltr />
              <DataRow label="ایمیل" value={member.email} ltr />
              <DataRow label="کد ملی" value={member.nationalId} ltr />
              <DataRow
                label="تاریخ تولد"
                value={member.birthDate ? formatDate(member.birthDate) : null}
              />
              <DataRow label="نشانی" value={member.address} />
              {member.emergencyContactName ? (
                <DataRow
                  label="تماس اضطراری"
                  value={`${member.emergencyContactName}${member.emergencyContactPhone ? ` — ${member.emergencyContactPhone}` : ''}`}
                />
              ) : null}
              {member.referrerName ? <DataRow label="معرف" value={member.referrerName} /> : null}
            </dl>
            <p className="border-t border-border px-4 py-2 text-2xs text-content-subtle">
              اطلاعات شخصی عضو محرمانه است و فقط برای کارکنان دارای مجوز نمایش داده می‌شود.
            </p>
          </Card>

          <Card>
            <CardHeader title="قوانین مؤثر این عضو" description="نوع عضویت بر تنظیمات عمومی اولویت دارد" />
            <dl className="px-4 py-3">
              <DataRow
                label="حداکثر امانت"
                value={`${toPersianDigits(member.effectivePolicy.maxLoans)} جلد`}
              />
              <DataRow
                label="مدت امانت"
                value={`${toPersianDigits(member.effectivePolicy.loanDays)} روز`}
              />
              <DataRow
                label="دفعات تمدید"
                value={toPersianDigits(member.effectivePolicy.maxRenewals)}
              />
              <DataRow
                label="حداکثر رزرو"
                value={
                  member.effectivePolicy.canReserve
                    ? toPersianDigits(member.effectivePolicy.maxReservations)
                    : 'اجازه رزرو ندارد'
                }
              />
              <DataRow
                label="جریمه روزانه"
                value={formatMoney(member.effectivePolicy.dailyFineAmount)}
              />
            </dl>
          </Card>

          <Card>
            <CardHeader title="آمار عضو" />
            <dl className="px-4 py-3">
              <DataRow label="کل امانت‌ها" value={formatNumber(member.stats.totalLoans)} />
              <DataRow label="بازگشت‌داده‌شده" value={formatNumber(member.stats.returnedCount)} />
              <DataRow
                label="مجموع جریمه‌ها"
                value={formatMoney(member.stats.totalFinesAmount)}
              />
            </dl>
            {member.stats.favoriteCategories.length > 0 ? (
              <div className="border-t border-border px-4 py-3">
                <p className="mb-2 text-xs text-content-muted">موضوعات مورد علاقه</p>
                <div className="flex flex-wrap gap-1.5">
                  {member.stats.favoriteCategories.map((category) => (
                    <Badge key={category.name} tone="info">
                      {category.name} ({toPersianDigits(category.count)})
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>

          {member.note ? (
            <Card>
              <CardHeader title="یادداشت" />
              <p className="whitespace-pre-line p-4 text-xs leading-relaxed text-content-muted">
                {member.note}
              </p>
            </Card>
          ) : null}
        </div>
      </div>

      <MemberCardModal open={cardOpen} onClose={() => setCardOpen(false)} memberId={member.id} />

      <Modal
        open={renewOpen}
        onClose={() => setRenewOpen(false)}
        title="تمدید عضویت"
        description={member.fullName}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenewOpen(false)}>انصراف</Button>
            <Button variant="primary" onClick={() => renew.mutate()} loading={renew.isPending}>
              تمدید
            </Button>
          </>
        }
      >
        <Field
          label="مدت تمدید"
          hint={
            member.expiresAt
              ? `تاریخ انقضای فعلی: ${formatDate(member.expiresAt)}`
              : 'این عضو تاریخ انقضا ندارد.'
          }
        >
          <Select value={renewMonths} onChange={(e) => setRenewMonths(e.target.value)}>
            <option value="3">۳ ماه</option>
            <option value="6">۶ ماه</option>
            <option value="12">یک سال</option>
            <option value="24">دو سال</option>
          </Select>
        </Field>
      </Modal>

      <Modal
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        title="تغییر وضعیت عضویت"
        description={member.fullName}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setStatusOpen(false)}>انصراف</Button>
            <Button
              variant="primary"
              onClick={() => changeStatus.mutate()}
              loading={changeStatus.isPending}
            >
              ثبت تغییر
            </Button>
          </>
        }
      >
        <Field
          label="وضعیت جدید"
          hint="عضو غیرفعال، منقضی، تعلیق‌شده یا مسدود نمی‌تواند کتاب امانت بگیرد."
        >
          <Select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
            {Object.entries(MEMBER_STATUS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </Select>
        </Field>
      </Modal>

      <ConfirmDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onConfirm={() => archive.mutate()}
        loading={archive.isPending}
        title="بایگانی عضو"
        confirmLabel="بایگانی کن"
        message={
          <>
            <p>
              «{member.fullName}» بایگانی می‌شود. رکورد از دیتابیس پاک نمی‌شود و تاریخچه
              امانت‌ها و جریمه‌های او دست‌نخورده می‌ماند.
            </p>
            {member.currentLoans.length > 0 ? (
              <p className="mt-2 rounded border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-danger-content">
                این عضو {toPersianDigits(member.currentLoans.length)} کتاب در امانت دارد.
                بهتر است اول کتاب‌ها را دریافت کنید.
              </p>
            ) : null}
          </>
        }
      />
    </>
  );
}

const ALERT_TONES = {
  danger: 'border-danger/30 bg-danger-soft text-danger-content',
  warning: 'border-warning/30 bg-warning-soft text-warning-content',
  info: 'border-info/30 bg-info-soft text-info-content',
} as const;

function Alert({ tone, children }: { tone: keyof typeof ALERT_TONES; children: React.ReactNode }) {
  return (
    <div role="alert" className={cn('rounded border px-3 py-2 text-sm', ALERT_TONES[tone])}>
      {children}
    </div>
  );
}

export function fineStatusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'PAID': return 'success';
    case 'PARTIALLY_PAID': return 'warning';
    case 'UNPAID': return 'danger';
    default: return 'neutral';
  }
}
