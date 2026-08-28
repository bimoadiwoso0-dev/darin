import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Boxes, History, MoveRight, Printer, RefreshCcw } from 'lucide-react';
import { ACQUISITION_SOURCE, COPY_CONDITION, COPY_STATUS } from '@darin/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, DataRow, EmptyState, Field,
  Modal, Select, Skeleton, TableWrapper, Td, Textarea, Th,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { LabelPrintModal } from '@/components/books/LabelPrintModal';
import { LocationSelect } from '@/components/shared/LocationSelect';
import { copyStatusTone } from './CopiesListPage';
import { formatDate, formatMoney, formatRelative, toPersianDigits } from '@/lib/format';

interface CopyDetail {
  id: string; copyNumber: number; accessionNumber: string; barcode: string;
  libraryCode: string | null; assetNumber: string | null; status: string; condition: string;
  isLoanable: boolean; isReference: boolean; positionCode: string | null;
  acquisitionSource: string; acquiredAt: string | null; supplier: string | null;
  purchasePrice: string | null; currentValue: string | null; internalNote: string | null;
  createdAt: string; deletedAt: string | null;
  book: {
    id: string; title: string; volumeNumber: number | null; volumeTitle: string | null;
    isbn13: string | null;
    publisher: { id: string; name: string } | null;
    contributors: Array<{ role: string; person: { id: string; fullName: string } }>;
  };
  location: { id: string; name: string; fullCode: string; kind: string } | null;
  donor: { id: string; fullName: string } | null;
  loans: Array<{
    id: string; loanNumber: string; status: string; loanedAt: string; dueAt: string;
    returnedAt: string | null; renewalCount: number;
    member: { id: string; firstName: string; lastName: string; memberCode: string };
  }>;
  movements: Array<{
    id: string; movedAt: string; reason: string | null; movedByLabel: string | null;
    fromLocation: { name: string; fullCode: string } | null;
    toLocation: { name: string; fullCode: string } | null;
  }>;
}

/**
 * جزئیات یک نسخه فیزیکی (قوانین ۶، ۳۶).
 *
 * ── چرا تاریخچه کامل ─────────────────────────────────────────────────────
 * وقتی کتابی گم می‌شود یا آسیب می‌بیند، اولین سؤال این است: «آخرین بار
 * دست چه کسی بود و کجا نگهداری می‌شد؟» تاریخچه امانت و جابه‌جایی این
 * پاسخ را در یک صفحه می‌دهد.
 */
export function CopyDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();

  const [labelOpen, setLabelOpen] = React.useState(false);
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [newStatus, setNewStatus] = React.useState('AVAILABLE');
  const [statusReason, setStatusReason] = React.useState('');
  const [moveOpen, setMoveOpen] = React.useState(false);
  const [moveTarget, setMoveTarget] = React.useState<string | null>(null);
  const [moveReason, setMoveReason] = React.useState('');
  const [archiveOpen, setArchiveOpen] = React.useState(false);

  const { data: copy, isLoading, isError } = useQuery({
    queryKey: ['copies', id],
    queryFn: () => api.get<CopyDetail>(`/copies/${id}`),
    enabled: !!id,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['copies'] });
    void queryClient.invalidateQueries({ queryKey: ['books'] });
  };

  const changeStatus = useMutation({
    mutationFn: () =>
      api.post(`/copies/${id}/status`, {
        status: newStatus,
        reason: statusReason.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('وضعیت نسخه تغییر کرد');
      setStatusOpen(false);
      setStatusReason('');
      invalidate();
    },
    onError: (error) => toast.apiError(error, 'تغییر وضعیت انجام نشد'),
  });

  const move = useMutation({
    mutationFn: () =>
      api.post('/copies/move', {
        copyIds: [id],
        toLocationId: moveTarget,
        reason: moveReason.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('نسخه جابه‌جا شد');
      setMoveOpen(false);
      setMoveTarget(null);
      setMoveReason('');
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
    },
    onError: (error) => toast.apiError(error, 'جابه‌جایی انجام نشد'),
  });

  const archive = useMutation({
    mutationFn: () => api.delete(`/copies/${id}`),
    onSuccess: () => {
      toast.success('نسخه بایگانی شد', 'تاریخچه امانت‌های آن حفظ شده است.');
      setArchiveOpen(false);
      invalidate();
    },
    onError: (error) => toast.apiError(error, 'بایگانی انجام نشد'),
  });

  if (isError) {
    return (
      <Card className="mx-auto max-w-lg">
        <EmptyState
          icon={<Boxes className="size-6" />}
          title="نسخه یافت نشد"
          action={<Button onClick={() => navigate('/copies')}>بازگشت به فهرست نسخه‌ها</Button>}
        />
      </Card>
    );
  }

  if (isLoading || !copy) {
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

  const currentLoan = copy.loans.find((l) => l.status === 'ACTIVE' || l.status === 'OVERDUE');

  return (
    <>
      <PageHeader
        breadcrumb={
          <nav className="flex items-center gap-1 text-xs text-content-muted" aria-label="مسیر">
            <Link to="/copies" className="hover:text-primary hover:underline">نسخه‌ها</Link>
            <span aria-hidden>/</span>
            <Link to={`/books/${copy.book.id}`} className="truncate hover:text-primary hover:underline">
              {copy.book.title}
            </Link>
          </nav>
        }
        title={`نسخه ${toPersianDigits(copy.copyNumber)} — ${copy.book.title}`}
        description={`شماره ثبت ${copy.accessionNumber} · بارکد ${copy.barcode}`}
        actions={
          <>
            {can('labels.print') ? (
              <Button onClick={() => setLabelOpen(true)} icon={<Printer className="size-4" />}>
                چاپ برچسب
              </Button>
            ) : null}
            {can('copies.move') ? (
              <Button onClick={() => setMoveOpen(true)} icon={<MoveRight className="size-4" />}>
                جابه‌جایی
              </Button>
            ) : null}
            {can('copies.change_status') ? (
              <Button
                variant="primary"
                onClick={() => { setNewStatus(copy.status); setStatusOpen(true); }}
                icon={<RefreshCcw className="size-4" />}
              >
                تغییر وضعیت
              </Button>
            ) : null}
            {can('copies.delete') && !copy.deletedAt ? (
              <Button
                variant="ghost"
                onClick={() => setArchiveOpen(true)}
                icon={<Archive className="size-4" />}
                aria-label="بایگانی نسخه"
              />
            ) : null}
          </>
        }
      />

      {copy.deletedAt ? (
        <div className="mb-4 rounded border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning-content">
          این نسخه در {formatDate(copy.deletedAt)} بایگانی شده است.
        </div>
      ) : null}

      {currentLoan ? (
        <div
          className={
            currentLoan.status === 'OVERDUE'
              ? 'mb-4 rounded border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-content'
              : 'mb-4 rounded border border-info/30 bg-info-soft px-3 py-2 text-sm text-info-content'
          }
        >
          هم‌اکنون نزد{' '}
          <Link to={`/members/${currentLoan.member.id}`} className="font-medium underline">
            {currentLoan.member.firstName} {currentLoan.member.lastName}
          </Link>{' '}
          است — موعد بازگشت {formatDate(currentLoan.dueAt)} ({formatRelative(currentLoan.dueAt)})
          {currentLoan.status === 'OVERDUE' ? ' — دیرکرد دارد.' : '.'}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="تاریخچه امانت" description="۲۵ رکورد اخیر" />
            {copy.loans.length > 0 ? (
              <TableWrapper>
                <thead>
                  <tr>
                    <Th>عضو</Th>
                    <Th>تاریخ امانت</Th>
                    <Th>موعد</Th>
                    <Th>تاریخ بازگشت</Th>
                    <Th className="w-24">وضعیت</Th>
                  </tr>
                </thead>
                <tbody>
                  {copy.loans.map((loan) => {
                    const late = loan.returnedAt && new Date(loan.returnedAt) > new Date(loan.dueAt);
                    return (
                      <tr key={loan.id} className="transition hover:bg-surface-sunken">
                        <Td>
                          <Link
                            to={`/members/${loan.member.id}`}
                            className="text-sm text-content hover:text-primary hover:underline"
                          >
                            {loan.member.firstName} {loan.member.lastName}
                          </Link>
                          <span className="field-ltr block text-2xs text-content-subtle">
                            {loan.member.memberCode}
                          </span>
                        </Td>
                        <Td className="text-xs text-content-muted">{formatDate(loan.loanedAt)}</Td>
                        <Td className="text-xs text-content-muted">{formatDate(loan.dueAt)}</Td>
                        <Td className="text-xs text-content-muted">{formatDate(loan.returnedAt)}</Td>
                        <Td>
                          {!loan.returnedAt ? (
                            <Badge tone={loan.status === 'OVERDUE' ? 'danger' : 'warning'}>
                              {loan.status === 'OVERDUE' ? 'دیرکرد' : 'در امانت'}
                            </Badge>
                          ) : (
                            <Badge tone={late ? 'warning' : 'success'}>
                              {late ? 'با تأخیر' : 'به‌موقع'}
                            </Badge>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrapper>
            ) : (
              <EmptyState title="این نسخه هنوز امانت داده نشده است" />
            )}
          </Card>

          <Card>
            <CardHeader title="تاریخچه جابه‌جایی" description="۲۵ رکورد اخیر" />
            {copy.movements.length > 0 ? (
              <ul className="divide-y divide-border">
                {copy.movements.map((movement) => (
                  <li key={movement.id} className="flex items-start gap-3 px-4 py-2.5">
                    <History className="mt-0.5 size-4 shrink-0 text-content-subtle" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-content">
                        {movement.fromLocation?.name ?? 'بدون مکان'}
                        {' ← '}
                        {movement.toLocation?.name ?? 'بدون مکان'}
                      </p>
                      {movement.reason ? (
                        <p className="mt-0.5 text-xs text-content-muted">{movement.reason}</p>
                      ) : null}
                      <p className="mt-0.5 text-2xs text-content-subtle">
                        {movement.movedByLabel ?? 'سیستم'} · {formatDate(movement.movedAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="جابه‌جایی ثبت نشده است" />
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader
              title="مشخصات نسخه"
              action={
                <Badge tone={copyStatusTone(copy.status)}>
                  {COPY_STATUS[copy.status as keyof typeof COPY_STATUS] ?? copy.status}
                </Badge>
              }
            />
            <dl className="px-4 py-3">
              <DataRow label="شماره ثبت" value={copy.accessionNumber} ltr />
              <DataRow label="بارکد" value={copy.barcode} ltr />
              <DataRow label="کد کتابخانه" value={copy.libraryCode} ltr />
              <DataRow label="شماره اموال" value={copy.assetNumber} ltr />
              <DataRow label="شماره نسخه" value={toPersianDigits(copy.copyNumber)} />
              <DataRow
                label="وضعیت فیزیکی"
                value={COPY_CONDITION[copy.condition as keyof typeof COPY_CONDITION] ?? copy.condition}
              />
              <DataRow
                label="قابل امانت"
                value={
                  copy.isReference
                    ? 'خیر — نسخه مرجع'
                    : copy.isLoanable
                      ? 'بله'
                      : 'خیر'
                }
              />
              <DataRow
                label="مکان"
                value={
                  copy.location ? (
                    <Link
                      to={`/locations/${copy.location.id}`}
                      className="hover:text-primary hover:underline"
                    >
                      {copy.location.name}
                      <span className="ms-1.5 font-mono text-2xs text-content-subtle" dir="ltr">
                        {copy.location.fullCode}
                      </span>
                    </Link>
                  ) : null
                }
              />
              <DataRow label="جایگاه در قفسه" value={copy.positionCode} />
              <DataRow label="تاریخ ثبت" value={formatDate(copy.createdAt)} />
            </dl>
          </Card>

          <Card>
            <CardHeader title="تأمین و ارزش" />
            <dl className="px-4 py-3">
              <DataRow
                label="نحوه تأمین"
                value={
                  ACQUISITION_SOURCE[copy.acquisitionSource as keyof typeof ACQUISITION_SOURCE] ??
                  copy.acquisitionSource
                }
              />
              <DataRow
                label="تاریخ تأمین"
                value={copy.acquiredAt ? formatDate(copy.acquiredAt) : null}
              />
              <DataRow
                label="اهداکننده"
                value={
                  copy.donor ? (
                    <Link
                      to={`/copies?donorId=${copy.donor.id}`}
                      className="hover:text-primary hover:underline"
                    >
                      {copy.donor.fullName}
                    </Link>
                  ) : null
                }
              />
              <DataRow label="تأمین‌کننده" value={copy.supplier} />
              <DataRow
                label="قیمت خرید"
                value={copy.purchasePrice ? formatMoney(copy.purchasePrice) : null}
              />
              <DataRow
                label="ارزش فعلی"
                value={copy.currentValue ? formatMoney(copy.currentValue) : null}
              />
            </dl>
          </Card>

          <Card>
            <CardHeader title="کتاب" />
            <dl className="px-4 py-3">
              <DataRow
                label="عنوان"
                value={
                  <Link to={`/books/${copy.book.id}`} className="hover:text-primary hover:underline">
                    {copy.book.title}
                  </Link>
                }
              />
              <DataRow
                label="پدیدآورندگان"
                value={copy.book.contributors.map((c) => c.person.fullName).join('، ') || null}
              />
              <DataRow label="ناشر" value={copy.book.publisher?.name} />
              <DataRow label="شابک" value={copy.book.isbn13} ltr />
            </dl>
          </Card>

          {copy.internalNote ? (
            <Card>
              <CardHeader title="یادداشت داخلی" />
              <p className="whitespace-pre-line p-4 text-xs leading-relaxed text-content-muted">
                {copy.internalNote}
              </p>
            </Card>
          ) : null}
        </div>
      </div>

      <LabelPrintModal open={labelOpen} onClose={() => setLabelOpen(false)} copyIds={[copy.id]} />

      <Modal
        open={statusOpen}
        onClose={() => setStatusOpen(false)}
        title="تغییر وضعیت نسخه"
        description={`شماره ثبت ${copy.accessionNumber}`}
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
        <div className="space-y-4">
          <Field
            label="وضعیت جدید"
            hint="وضعیت «در امانت» با ثبت امانت تغییر می‌کند و اینجا قابل تعیین دستی نیست."
          >
            <Select value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
              {Object.entries(COPY_STATUS)
                .filter(([key]) => key !== 'ON_LOAN' && key !== 'RESERVED_HOLD')
                .map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
            </Select>
          </Field>

          <Field label="دلیل" hint="در گزارش فعالیت‌ها ثبت می‌شود.">
            <Textarea value={statusReason} onChange={(e) => setStatusReason(e.target.value)} rows={2} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        title="جابه‌جایی نسخه"
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
          <Field label="دلیل جابه‌جایی">
            <Textarea value={moveReason} onChange={(e) => setMoveReason(e.target.value)} rows={2} />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onConfirm={() => archive.mutate()}
        loading={archive.isPending}
        title="بایگانی نسخه"
        confirmLabel="بایگانی کن"
        message={
          <>
            <p>
              این نسخه بایگانی می‌شود. رکورد از دیتابیس پاک نمی‌شود و تاریخچه امانت‌های آن
              دست‌نخورده می‌ماند.
            </p>
            {currentLoan ? (
              <p className="mt-2 rounded border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-danger-content">
                این نسخه هم‌اکنون در امانت است. ابتدا آن را دریافت کنید.
              </p>
            ) : null}
          </>
        }
      />
    </>
  );
}
