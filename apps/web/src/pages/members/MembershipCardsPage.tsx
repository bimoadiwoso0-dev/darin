import * as React from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { CreditCard, Printer, Users, X } from 'lucide-react';
import { MEMBER_STATUS } from '@darin/shared';
import { api, type Paginated } from '@/lib/api';
import {
  Badge, Button, Card, CardHeader, EmptyState, Field, Select, Skeleton, cn,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { FilterBar } from '@/components/shared/FilterBar';
import { usePrintArea } from '@/hooks/usePrintArea';
import { useDebounced } from '@/hooks/useUrlFilters';
import { formatDate, toPersianDigits } from '@/lib/format';

interface MemberRow {
  id: string; memberCode: string; fullName: string; status: string;
  expiresAt: string | null;
  membershipType: { id: string; name: string } | null;
}

interface MemberCard {
  id: string; memberCode: string; fullName: string;
  joinedAt: string; expiresAt: string | null; expiresAtFa: string | null;
  status: string; membershipType: { name: string } | null;
  barcodeImage: string; qrImage: string; libraryName: string;
}

/**
 * چاپ گروهی کارت عضویت (قانون ۱۷).
 *
 * ── چرا صفحه جدا از پروفایل عضو ─────────────────────────────────────────
 * وقتی ۴۰ عضو جدید در یک هفته ثبت شده‌اند، باز کردن ۴۰ پروفایل و ۴۰ بار
 * چاپ گرفتن یعنی ۴۰ برگه نیمه‌خالی. اینجا کارت‌ها کنار هم روی برگه چیده
 * می‌شوند و یک بار چاپ می‌شوند.
 *
 * ── چرا تصاویر یکی‌یکی گرفته می‌شوند ────────────────────────────────────
 * هر کارت بارکد و QR اختصاصی دارد که در سرور رندر می‌شود. `useQueries`
 * آنها را موازی می‌گیرد و هر کدام جداگانه Cache می‌شود، پس چاپ دوباره
 * همان دسته، درخواست جدیدی نمی‌فرستد.
 */
export function MembershipCardsPage() {
  const print = usePrintArea();

  const [search, setSearch] = React.useState('');
  const debounced = useDebounced(search, 300);
  const [status, setStatus] = React.useState('ACTIVE');
  const [selected, setSelected] = React.useState<MemberRow[]>([]);

  const { data: members, isLoading } = useQuery({
    queryKey: ['members', 'card-picker', debounced, status],
    queryFn: () =>
      api.get<Paginated<MemberRow>>('/members', {
        q: debounced || undefined,
        status: status || undefined,
        pageSize: 50,
        sort: 'joinedAt',
        order: 'desc',
      }),
  });

  // کارت هر عضو انتخاب‌شده — موازی و جداگانه Cache می‌شود
  const cardQueries = useQueries({
    queries: selected.map((member) => ({
      queryKey: ['members', member.id, 'card'],
      queryFn: () => api.get<MemberCard>(`/labels/member-card/${member.id}`),
      staleTime: 5 * 60_000,
    })),
  });

  const cards = cardQueries
    .map((q) => q.data)
    .filter((card): card is MemberCard => !!card);
  const loadingCards = cardQueries.some((q) => q.isLoading);

  const toggle = (member: MemberRow) => {
    setSelected((current) =>
      current.some((m) => m.id === member.id)
        ? current.filter((m) => m.id !== member.id)
        : [...current, member],
    );
  };

  return (
    <>
      <PageHeader
        title="کارت عضویت"
        description="اعضا را انتخاب کنید و کارت‌ها را یکجا چاپ کنید."
        actions={
          <>
            {selected.length > 0 ? (
              <>
                <Badge tone="primary">{toPersianDigits(selected.length)} کارت</Badge>
                <Button variant="ghost" onClick={() => setSelected([])} icon={<X className="size-4" />}>
                  پاک کردن انتخاب
                </Button>
              </>
            ) : null}
            <Button
              variant="primary"
              onClick={print}
              disabled={cards.length === 0 || loadingCards}
              loading={loadingCards && selected.length > 0}
              icon={<Printer className="size-4" />}
            >
              چاپ {selected.length > 0 ? toPersianDigits(selected.length) : ''} کارت
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ── انتخاب اعضا ────────────────────────────────────────────── */}
        <Card className="no-print lg:col-span-1">
          <CardHeader title="انتخاب اعضا" description="۵۰ عضو اخیر" />
          <FilterBar
            search={search}
            onSearchChange={setSearch}
            placeholder="نام یا کد عضویت…"
          />
          <div className="border-b border-border p-3">
            <Field label="وضعیت عضویت">
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                aria-label="فیلتر وضعیت"
              >
                <option value="">همه اعضا</option>
                {Object.entries(MEMBER_STATUS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </Select>
            </Field>
          </div>

          {isLoading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-10" />)}
            </div>
          ) : members && members.data.length > 0 ? (
            <>
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <label className="flex cursor-pointer items-center gap-2 text-xs text-content-muted">
                  <input
                    type="checkbox"
                    checked={
                      members.data.length > 0 && selected.length === members.data.length
                    }
                    onChange={(e) => setSelected(e.target.checked ? members.data : [])}
                    className="size-4 rounded border-border-strong text-primary focus:ring-primary/30"
                  />
                  انتخاب همه ({toPersianDigits(members.data.length)})
                </label>
              </div>

              <ul className="max-h-[32rem] divide-y divide-border overflow-y-auto">
                {members.data.map((member) => (
                  <li key={member.id}>
                    <label
                      className={cn(
                        'flex cursor-pointer items-center gap-2.5 px-3 py-2.5 transition',
                        selected.some((m) => m.id === member.id)
                          ? 'bg-primary-soft'
                          : 'hover:bg-surface-sunken',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selected.some((m) => m.id === member.id)}
                        onChange={() => toggle(member)}
                        className="size-4 shrink-0 rounded border-border-strong text-primary focus:ring-primary/30"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-content">
                          {member.fullName}
                        </span>
                        <span className="field-ltr block truncate text-xs text-content-muted">
                          {member.memberCode}
                        </span>
                      </span>
                      {member.status !== 'ACTIVE' ? (
                        <Badge tone="warning">
                          {MEMBER_STATUS[member.status as keyof typeof MEMBER_STATUS] ??
                            member.status}
                        </Badge>
                      ) : null}
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState icon={<Users className="size-6" />} title="عضوی یافت نشد" />
          )}
        </Card>

        {/* ── پیش‌نمایش چاپ ──────────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="پیش‌نمایش چاپ"
              description="ابعاد واقعی — ۸۵٫۶×۵۴ میلی‌متر (اندازه استاندارد کارت)"
              className="no-print"
            />

            {selected.length === 0 ? (
              <EmptyState
                icon={<CreditCard className="size-6" />}
                title="عضوی انتخاب نشده"
                description="از فهرست کنار، اعضایی که کارتشان را می‌خواهید انتخاب کنید."
              />
            ) : loadingCards ? (
              <div className="grid gap-3 p-4 sm:grid-cols-2">
                {selected.map((m) => <Skeleton key={m.id} className="h-40" />)}
              </div>
            ) : (
              <div className="print-area flex flex-wrap gap-3 p-4">
                {cards.map((card) => (
                  <CardPreview key={card.id} card={card} />
                ))}
              </div>
            )}
          </Card>

          <p className="no-print mt-3 text-xs leading-relaxed text-content-muted">
            پیش از چاپ انبوه، یک برگه آزمایشی بگیرید و اندازه را بسنجید. برای دوام
            بیشتر، کارت‌ها را پس از برش لمینت کنید.
          </p>
        </div>
      </div>
    </>
  );
}

function CardPreview({ card }: { card: MemberCard }) {
  return (
    <div
      className="label-item flex flex-col justify-between rounded-lg border border-border bg-white p-3 text-black"
      style={{ width: '85.6mm', height: '54mm' }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[9pt] font-bold">{card.libraryName}</p>
          <p className="text-[6.5pt] opacity-70">کارت عضویت کتابخانه</p>
        </div>
        <img src={card.qrImage} alt="" className="size-[16mm] shrink-0 object-contain" />
      </div>

      <div className="min-w-0">
        <p className="truncate text-[11pt] font-bold leading-tight">{card.fullName}</p>
        <p className="text-[7pt] opacity-75">
          {card.membershipType?.name ?? 'عضو کتابخانه'}
          {card.expiresAtFa ? ` — اعتبار تا ${card.expiresAtFa}` : ''}
        </p>
      </div>

      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[8pt] font-bold" dir="ltr">{card.memberCode}</p>
          <p className="text-[6pt] opacity-60">عضویت از {formatDate(card.joinedAt)}</p>
        </div>
        <img src={card.barcodeImage} alt="" className="h-[10mm] w-[38mm] object-contain" />
      </div>
    </div>
  );
}
