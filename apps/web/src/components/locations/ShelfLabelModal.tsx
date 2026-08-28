import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { LOCATION_KIND } from '@darin/shared';
import { api } from '@/lib/api';
import { Button, Modal, Spinner } from '@/components/ui';
import { usePrintArea } from '@/hooks/usePrintArea';
import { toPersianDigits } from '@/lib/format';

interface ShelfLabel {
  id: string; name: string; fullCode: string; kind: string;
  capacity: number | null; copyCount: number;
  qrImage: string; libraryName: string;
}

/**
 * برچسب QR قفسه (قانون ۸۳).
 *
 * ── چرا QR روی قفسه ─────────────────────────────────────────────────────
 * کتابدار هنگام شمارش موجودی یا قفسه‌چینی، با موبایل QR قفسه را اسکن
 * می‌کند و بی‌درنگ فهرست کتاب‌های همان قفسه را می‌بیند — بدون تایپ کردن
 * کد قفسه.
 *
 * QR حاوی `qrToken` است نه شناسه رکورد، تا کسی نتواند از روی یک برچسب،
 * شناسه‌های دیگر را حدس بزند (قانون ۸۴).
 */
export function ShelfLabelModal({
  open, onClose, locationId,
}: {
  open: boolean;
  onClose: () => void;
  locationId: string | null;
}) {
  const print = usePrintArea();

  const { data: label, isLoading } = useQuery({
    queryKey: ['labels', 'shelf', locationId],
    queryFn: () => api.get<ShelfLabel>(`/labels/shelf/${locationId}`),
    enabled: open && !!locationId,
    staleTime: 60_000,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="برچسب قفسه"
      description="روی لبه قفسه نصب کنید تا با موبایل قابل اسکن باشد."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>بستن</Button>
          <Button variant="primary" onClick={print} disabled={!label} icon={<Printer className="size-4" />}>
            چاپ
          </Button>
        </>
      }
    >
      {isLoading || !label ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-content-muted">
          <Spinner /> در حال آماده‌سازی برچسب…
        </div>
      ) : (
        <div className="print-area flex justify-center">
          <div
            className="flex flex-col items-center justify-between rounded border border-border bg-white p-3 text-center text-black"
            style={{ width: '80mm', height: '50mm' }}
          >
            <p className="w-full truncate text-[7pt] opacity-70">{label.libraryName}</p>

            <p className="w-full truncate text-[13pt] font-bold leading-tight">{label.name}</p>

            <p className="font-mono text-[16pt] font-bold leading-none" dir="ltr">
              {label.fullCode}
            </p>

            <div className="flex w-full items-end justify-between gap-2">
              <div className="text-start text-[6.5pt] leading-tight opacity-70">
                <p>{LOCATION_KIND[label.kind as keyof typeof LOCATION_KIND] ?? label.kind}</p>
                <p>
                  {toPersianDigits(label.copyCount)} نسخه
                  {label.capacity !== null
                    ? ` از ظرفیت ${toPersianDigits(label.capacity)}`
                    : ''}
                </p>
              </div>
              <img src={label.qrImage} alt="" className="size-[20mm] object-contain" />
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
