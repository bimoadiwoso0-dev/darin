import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Modal, Spinner } from '@/components/ui';
import { usePrintArea } from '@/hooks/usePrintArea';
import { formatDate } from '@/lib/format';

interface MemberCard {
  id: string;
  memberCode: string;
  fullName: string;
  joinedAt: string;
  expiresAt: string | null;
  expiresAtFa: string | null;
  status: string;
  membershipType: { name: string } | null;
  barcodeImage: string;
  qrImage: string;
  libraryName: string;
}

/**
 * کارت عضویت (قانون ۱۷).
 *
 * ── ابعاد کارت ───────────────────────────────────────────────────────────
 * ۸۵٫۶×۵۴ میلی‌متر — همان اندازه استاندارد کارت بانکی (ISO/IEC 7810 ID-1)
 * تا در جاکارتی و کیف پول جا شود و با دستگاه‌های لمینت متعارف کار کند.
 *
 * ── بارکد و QR واقعی‌اند ─────────────────────────────────────────────────
 * تصاویر در سرور تولید می‌شوند و با بارکدخوان میز امانت قابل خواندن‌اند.
 * QR حاوی توکن امن است، نه شناسه داخلی رکورد (قانون ۸۴).
 */
export function MemberCardModal({
  open, onClose, memberId,
}: {
  open: boolean;
  onClose: () => void;
  memberId: string;
}) {
  const print = usePrintArea();

  const { data: card, isLoading } = useQuery({
    queryKey: ['members', memberId, 'card'],
    queryFn: () => api.get<MemberCard>(`/labels/member-card/${memberId}`),
    enabled: open,
    staleTime: 60_000,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="کارت عضویت"
      description="پس از چاپ، کارت را در ابعاد استاندارد برش دهید."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>بستن</Button>
          <Button variant="primary" onClick={print} disabled={!card} icon={<Printer className="size-4" />}>
            چاپ کارت
          </Button>
        </>
      }
    >
      {isLoading || !card ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-content-muted">
          <Spinner /> در حال آماده‌سازی کارت…
        </div>
      ) : (
        <div className="print-area flex justify-center">
          <div
            className="flex flex-col justify-between rounded-lg border border-border bg-white p-3 text-black shadow-card"
            // ابعاد استاندارد کارت شناسایی
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
                <p className="text-[6pt] opacity-60">
                  عضویت از {formatDate(card.joinedAt)}
                </p>
              </div>
              <img src={card.barcodeImage} alt="" className="h-[10mm] w-[38mm] object-contain" />
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
