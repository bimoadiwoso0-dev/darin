import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { Button, Field, Modal, Select, Spinner, cn } from '@/components/ui';
import { toPersianDigits } from '@/lib/format';
import { usePrintArea } from '@/hooks/usePrintArea';

interface LabelTemplate {
  key: string; name: string; width: number; height: number;
  fields: string[]; fontSize: number; description: string;
}

interface LabelData {
  copyId: string; accessionNumber: string; barcode: string; libraryCode: string | null;
  title: string; authors: string; shelfCode: string | null;
  barcodeImage: string; qrImage: string | null; libraryName: string;
}

/**
 * چاپ برچسب (قوانین ۱۱، ۱۲).
 *
 * ── چرا پیش‌نمایش واقعی ──────────────────────────────────────────────────
 * برچسب روی کاغذ چسبی چاپ می‌شود و اشتباه، کاغذ را هدر می‌دهد. کتابدار
 * قبل از فشردن دکمه چاپ، دقیقاً همان چیزی را می‌بیند که چاپ خواهد شد —
 * با ابعاد میلی‌متری واقعی.
 *
 * ── تصاویر از سرور می‌آیند ───────────────────────────────────────────────
 * بارکد و QR سمت سرور با `bwip-js` و `qrcode` تولید می‌شوند تا در همه
 * چاپگرها یکسان باشند (قانون ۱۳۴: دکمه چاپ واقعاً برچسب می‌سازد).
 */
export function LabelPrintModal({
  open, onClose, copyIds,
}: {
  open: boolean;
  onClose: () => void;
  copyIds: string[];
}) {
  const toast = useToast();
  const print = usePrintArea();
  const [template, setTemplate] = React.useState('standard-50x30');
  const [labels, setLabels] = React.useState<LabelData[] | null>(null);
  const [activeTemplate, setActiveTemplate] = React.useState<LabelTemplate | null>(null);

  const { data: templates } = useQuery({
    queryKey: ['labels', 'templates'],
    queryFn: () => api.get<LabelTemplate[]>('/labels/templates'),
    enabled: open,
    staleTime: Infinity,
  });

  const generate = useMutation({
    mutationFn: () => api.post<{ template: LabelTemplate; labels: LabelData[] }>('/labels/books', {
      copyIds, template,
    }),
    onSuccess: (result) => {
      setLabels(result.labels);
      setActiveTemplate(result.template);
    },
    onError: (error) => toast.apiError(error, 'تولید برچسب انجام نشد'),
  });

  // با باز شدن پنجره یا تغییر قالب، برچسب‌ها دوباره تولید می‌شوند
  React.useEffect(() => {
    if (!open) { setLabels(null); return; }
    if (copyIds.length === 0) return;
    generate.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template, copyIds.length]);

  const selected = templates?.find((t) => t.key === template);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="چاپ برچسب"
      description={`${toPersianDigits(copyIds.length)} برچسب برای چاپ آماده می‌شود`}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>بستن</Button>
          <Button
            variant="primary"
            onClick={print}
            disabled={!labels || labels.length === 0}
            icon={<Printer className="size-4" />}
          >
            چاپ
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="no-print">
          <Field label="قالب برچسب" hint={selected?.description}>
            <Select value={template} onChange={(e) => setTemplate(e.target.value)}>
              {templates?.map((t) => (
                <option key={t.key} value={t.key}>{t.name}</option>
              ))}
            </Select>
          </Field>
        </div>

        {generate.isPending ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-content-muted">
            <Spinner /> در حال تولید بارکدها…
          </div>
        ) : labels && activeTemplate ? (
          <>
            <p className="no-print text-xs text-content-muted">
              پیش‌نمایش با ابعاد واقعی ({toPersianDigits(activeTemplate.width)}×
              {toPersianDigits(activeTemplate.height)} میلی‌متر). پیش از چاپ انبوه، یک
              برگه آزمایشی بگیرید و اندازه را با برچسب‌های خود بسنجید.
            </p>
            <div className="print-area label-sheet flex flex-wrap gap-2">
              {labels.map((label) => (
                <LabelPreview key={label.copyId} label={label} template={activeTemplate} />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}

/** یک برچسب با ابعاد میلی‌متری واقعی — همان چیزی که چاپ می‌شود. */
function LabelPreview({ label, template }: { label: LabelData; template: LabelTemplate }) {
  const has = (field: string) => template.fields.includes(field);

  return (
    <div
      className={cn(
        'label-item flex flex-col items-center justify-between overflow-hidden',
        'border border-dashed border-border bg-white p-1 text-center text-black',
      )}
      style={{
        width: `${template.width}mm`,
        height: `${template.height}mm`,
        fontSize: `${template.fontSize}pt`,
      }}
    >
      {has('libraryName') ? (
        <p className="w-full truncate text-[0.7em] leading-tight">{label.libraryName}</p>
      ) : null}

      {has('title') ? (
        <p className="line-clamp-2 w-full leading-tight">{label.title}</p>
      ) : null}

      {has('author') && label.authors ? (
        <p className="w-full truncate text-[0.8em] leading-tight opacity-80">{label.authors}</p>
      ) : null}

      {has('shelfCode') && label.shelfCode ? (
        <p className="w-full truncate font-mono text-[1.1em] font-bold leading-tight" dir="ltr">
          {label.shelfCode}
        </p>
      ) : null}

      {has('qr') && label.qrImage ? (
        <img src={label.qrImage} alt="" className="h-[45%] w-auto object-contain" />
      ) : null}

      {has('barcode') ? (
        <img src={label.barcodeImage} alt="" className="h-[35%] w-full object-contain" />
      ) : null}

      {has('accession') ? (
        <p className="w-full truncate font-mono text-[0.85em] leading-tight" dir="ltr">
          {label.accessionNumber}
        </p>
      ) : null}
    </div>
  );
}
