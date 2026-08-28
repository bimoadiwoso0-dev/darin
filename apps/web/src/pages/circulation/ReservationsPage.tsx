import * as React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, BookmarkPlus, MapPin, X } from 'lucide-react';
import { RESERVATION_STATUS } from '@darin/shared';
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
import { EntityPicker } from '@/components/shared/EntityPicker';
import { MemberQuickSearch } from '@/components/circulation/MemberQuickSearch';
import { useUrlFilters } from '@/hooks/useUrlFilters';
import { formatDate, formatNumber, formatRelative, toPersianDigits } from '@/lib/format';

interface ReservationRow {
  id: string; status: string; queuePosition: number; reservedAt: string;
  readyAt: string | null; expiresAt: string | null; note: string | null;
  memberName: string;
  availableCopies: number;
  book: { id: string; title: string };
  member: {
    id: string; memberCode: string; firstName: string; lastName: string; mobile: string | null;
  };
  holdCopy: { id: string; barcode: string; location: { fullCode: string } | null } | null;
}

const DEFAULTS = {
  page: 1,
  pageSize: 20,
  status: 'PENDING,READY',
};

/**
 * رزروها (قوانین ۲۶، ۲۷، ۲۸).
 *
 * ── چرا «آماده تحویل» بالاتر است ────────────────────────────────────────
 * رزروی که کتابش رسیده، مهلت محدودی دارد. اگر عضو در مهلت نیاید، نوبت به
 * نفر بعدی می‌رسد. کتابدار باید این‌ها را ببیند و تماس بگیرد؛ رزروهای در
 * صف انتظار کار فوری ندارند.
 *
 * ── چرا شماره نوبت نمایش داده می‌شود ────────────────────────────────────
 * وقتی عضوی می‌پرسد «کی نوبت من می‌شود؟» کتابدار باید بتواند بدون
 * محاسبه ذهنی جواب بدهد.
 */
export function ReservationsPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();
  const { values, setFilters } = useUrlFilters(DEFAULTS);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [cancelTarget, setCancelTarget] = React.useState<ReservationRow | null>(null);
  const [cancelReason, setCancelReason] = React.useState('');

  const [newBookId, setNewBookId] = React.useState<string | null>(null);
  const [newBookLabel, setNewBookLabel] = React.useState<string | null>(null);
  const [newMemberId, setNewMemberId] = React.useState<string | null>(null);
  const [newMemberLabel, setNewMemberLabel] = React.useState<string | null>(null);
  const [newNote, setNewNote] = React.useState('');

  const query = {
    page: values.page,
    pageSize: values.pageSize,
    status: values.status || undefined,
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['reservations', query],
    queryFn: () => api.get<Paginated<ReservationRow>>('/reservations', query),
    placeholderData: (previous) => previous,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['reservations'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['members'] });
  };

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string; queuePosition: number; status: string }>('/reservations', {
        bookId: newBookId,
        memberId: newMemberId,
        note: newNote.trim() || undefined,
      }),
    onSuccess: (reservation) => {
      toast.success(
        'رزرو ثبت شد',
        reservation.status === 'READY'
          ? 'نسخه‌ای موجود بود و بی‌درنگ کنار گذاشته شد.'
          : `نوبت ${toPersianDigits(reservation.queuePosition)} در صف انتظار`,
      );
      setCreateOpen(false);
      setNewBookId(null); setNewBookLabel(null);
      setNewMemberId(null); setNewMemberLabel(null);
      setNewNote('');
      invalidate();
    },
    onError: (error) => toast.apiError(error, 'ثبت رزرو انجام نشد'),
  });

  const cancel = useMutation({
    mutationFn: () =>
      api.post(`/reservations/${cancelTarget?.id}/cancel`, {
        reason: cancelReason.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('رزرو لغو شد', 'در صورت وجود، نوبت به عضو بعدی صف منتقل شد.');
      setCancelTarget(null);
      setCancelReason('');
      invalidate();
    },
    onError: (error) => toast.apiError(error, 'لغو رزرو انجام نشد'),
  });

  const readyCount = data?.data.filter((r) => r.status === 'READY').length ?? 0;

  return (
    <>
      <PageHeader
        title="رزروها"
        description={data ? `${formatNumber(data.meta.total)} رزرو` : 'در حال بارگذاری…'}
        actions={
          can('reservations.manage') ? (
            <Button
              variant="primary"
              onClick={() => setCreateOpen(true)}
              icon={<BookmarkPlus className="size-4" />}
            >
              ثبت رزرو جدید
            </Button>
          ) : null
        }
      />

      {readyCount > 0 ? (
        <div className="mb-4 rounded border border-success/30 bg-success-soft px-3 py-2 text-sm text-success-content">
          {toPersianDigits(readyCount)} رزرو آماده تحویل است. با اعضا تماس بگیرید تا پیش از
          پایان مهلت مراجعه کنند.
        </div>
      ) : null}

      <Card>
        <FilterBar
          search=""
          onSearchChange={() => undefined}
          placeholder="جستجو در رزروها"
          actions={
            <Field label="" className="w-56">
              <Select
                value={values.status}
                onChange={(e) => setFilters({ status: e.target.value })}
                aria-label="فیلتر وضعیت رزرو"
              >
                <option value="PENDING,READY">رزروهای فعال</option>
                <option value="READY">فقط آماده تحویل</option>
                <option value="PENDING">فقط در صف انتظار</option>
                <option value="">همه رزروها</option>
                {Object.entries(RESERVATION_STATUS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </Select>
            </Field>
          }
        />

        {isLoading ? (
          <TableSkeleton columns={6} />
        ) : data && data.data.length > 0 ? (
          <>
            <TableWrapper className={isFetching ? 'opacity-60 transition-opacity' : undefined}>
              <thead>
                <tr>
                  <Th>کتاب</Th>
                  <Th>عضو</Th>
                  <Th numeric>نوبت</Th>
                  <Th>تاریخ رزرو</Th>
                  <Th>مهلت تحویل</Th>
                  <Th className="w-28">وضعیت</Th>
                  <Th className="w-20">عملیات</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((reservation) => (
                  <tr key={reservation.id} className="transition hover:bg-surface-sunken">
                    <Td>
                      <Link
                        to={`/books/${reservation.book.id}`}
                        className="text-sm text-content hover:text-primary hover:underline"
                      >
                        {reservation.book.title}
                      </Link>
                      {reservation.holdCopy ? (
                        <p className="mt-0.5 flex items-center gap-1 text-xs text-success-content">
                          <MapPin className="size-3" />
                          کنارگذاشته‌شده
                          <span className="field-ltr">{reservation.holdCopy.barcode}</span>
                          {reservation.holdCopy.location
                            ? ` · ${reservation.holdCopy.location.fullCode}`
                            : ''}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-xs text-content-muted">
                          {toPersianDigits(reservation.availableCopies)} نسخه موجود
                        </p>
                      )}
                    </Td>
                    <Td>
                      <Link
                        to={`/members/${reservation.member.id}`}
                        className="text-sm text-content hover:text-primary hover:underline"
                      >
                        {reservation.memberName}
                      </Link>
                      <p className="field-ltr mt-0.5 text-xs text-content-muted">
                        {reservation.member.memberCode}
                        {reservation.member.mobile ? ` · ${reservation.member.mobile}` : ''}
                      </p>
                    </Td>
                    <Td numeric className="text-xs">
                      {reservation.status === 'READY'
                        ? '—'
                        : toPersianDigits(reservation.queuePosition)}
                    </Td>
                    <Td className="text-xs text-content-muted">
                      {formatDate(reservation.reservedAt)}
                    </Td>
                    <Td className="text-xs">
                      {reservation.expiresAt ? (
                        <>
                          {formatDate(reservation.expiresAt)}
                          <span
                            className={
                              new Date(reservation.expiresAt) < new Date()
                                ? 'block text-2xs text-danger'
                                : 'block text-2xs text-content-subtle'
                            }
                          >
                            {formatRelative(reservation.expiresAt)}
                          </span>
                        </>
                      ) : (
                        <span className="text-content-subtle">—</span>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={reservationTone(reservation.status)}>
                        {RESERVATION_STATUS[
                          reservation.status as keyof typeof RESERVATION_STATUS
                        ] ?? reservation.status}
                      </Badge>
                    </Td>
                    <Td>
                      {can('reservations.manage') &&
                      (reservation.status === 'PENDING' || reservation.status === 'READY') ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setCancelTarget(reservation)}
                          icon={<X className="size-3.5" />}
                          className="text-content-subtle hover:text-danger"
                        >
                          لغو
                        </Button>
                      ) : (
                        <span className="text-xs text-content-subtle">—</span>
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
            icon={<Bookmark className="size-6" />}
            title="رزروی وجود ندارد"
            description="وقتی همه نسخه‌های کتابی در امانت باشد، اعضا می‌توانند آن را رزرو کنند."
            action={
              can('reservations.manage') ? (
                <Button variant="primary" onClick={() => setCreateOpen(true)}>
                  ثبت رزرو جدید
                </Button>
              ) : null
            }
          />
        )}
      </Card>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="ثبت رزرو جدید"
        description="اگر نسخه‌ای موجود باشد، بی‌درنگ برای عضو کنار گذاشته می‌شود."
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>انصراف</Button>
            <Button
              variant="primary"
              onClick={() => create.mutate()}
              loading={create.isPending}
              disabled={!newBookId || !newMemberId}
            >
              ثبت رزرو
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="کتاب" required>
            <EntityPicker
              endpoint="/books"
              value={newBookId}
              valueLabel={newBookLabel}
              onChange={(bookId, label) => { setNewBookId(bookId); setNewBookLabel(label); }}
              mapItem={(item: { id: string; title: string; availableCount: number }) => ({
                id: item.id,
                label: item.title,
                hint:
                  item.availableCount > 0
                    ? `${toPersianDigits(item.availableCount)} موجود`
                    : 'ناموجود',
              })}
              placeholder="جستجوی کتاب…"
            />
          </Field>

          <Field label="عضو" required>
            {newMemberId ? (
              <div className="flex items-center gap-2 rounded border border-border bg-surface-sunken px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm text-content">
                  {newMemberLabel}
                </span>
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

          <Field label="یادداشت">
            <Textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} rows={2} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        title="لغو رزرو"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCancelTarget(null)}>انصراف</Button>
            <Button variant="danger" onClick={() => cancel.mutate()} loading={cancel.isPending}>
              لغو رزرو
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-content-muted">
            رزرو «{cancelTarget?.book.title}» برای {cancelTarget?.memberName} لغو می‌شود.
            {cancelTarget?.status === 'READY'
              ? ' نسخه کنارگذاشته‌شده به نفر بعدی صف یا به قفسه بازمی‌گردد.'
              : ' نوبت بقیه صف یک واحد جلو می‌آید.'}
          </p>
          <Field label="دلیل لغو" hint="در گزارش فعالیت‌ها ثبت می‌شود.">
            <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} rows={2} />
          </Field>
        </div>
      </Modal>
    </>
  );
}

function reservationTone(status: string): 'success' | 'info' | 'warning' | 'neutral' {
  switch (status) {
    case 'READY': return 'success';
    case 'PENDING': return 'info';
    case 'EXPIRED': return 'warning';
    default: return 'neutral';
  }
}
