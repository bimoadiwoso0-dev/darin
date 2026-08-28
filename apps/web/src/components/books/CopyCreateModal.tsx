import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Plus } from 'lucide-react';
import { ACQUISITION_SOURCE, COPY_CONDITION } from '@darin/shared';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import { Badge, Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { EntityPicker } from '@/components/shared/EntityPicker';
import { LocationSelect } from '@/components/shared/LocationSelect';
import { toPersianDigits } from '@/lib/format';

interface NextNumbers {
  accession: string | null;
  barcode: string | null;
  libraryCode: string | null;
  asset: string | null;
}

/**
 * افزودن نسخه فیزیکی (قوانین ۶، ۷، ۸، ۹).
 *
 * ── چرا «تعداد» و نه فرم تک‌نسخه‌ای ─────────────────────────────────────
 * کتابخانه معمولاً چند جلد از یک عنوان می‌خرد. ثبت ۵ نسخه با ۵ بار پر کردن
 * فرم، کار تکراری و خطاخیز است. یک عدد وارد می‌شود و سیستم ۵ نسخه با
 * شماره‌های پشت‌سرهم می‌سازد.
 *
 * ── شماره‌ها خودکارند مگر خلافش گفته شود (قانون ۹) ──────────────────────
 * پیش‌نمایش شماره بعدی نمایش داده می‌شود اما شماره مصرف نمی‌شود؛ تخصیص
 * واقعی با قفل ردیف در همان تراکنش ثبت انجام می‌گیرد تا دو کتابدار هم‌زمان
 * شماره تکراری نگیرند.
 */
export function CopyCreateModal({
  open, onClose, bookId, bookTitle,
}: {
  open: boolean;
  onClose: () => void;
  bookId: string;
  bookTitle: string;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [count, setCount] = React.useState(1);
  const [locationId, setLocationId] = React.useState<string | null>(null);
  const [positionCode, setPositionCode] = React.useState('');
  const [condition, setCondition] = React.useState('NEW');
  const [source, setSource] = React.useState('PURCHASE');
  const [donorId, setDonorId] = React.useState<string | null>(null);
  const [donorLabel, setDonorLabel] = React.useState<string | null>(null);
  const [donorName, setDonorName] = React.useState<string | null>(null);
  const [supplier, setSupplier] = React.useState('');
  const [purchasePrice, setPurchasePrice] = React.useState('');
  const [isLoanable, setIsLoanable] = React.useState(true);
  const [isReference, setIsReference] = React.useState(false);
  const [note, setNote] = React.useState('');
  const [manualNumbers, setManualNumbers] = React.useState(false);
  const [accessionNumbers, setAccessionNumbers] = React.useState('');
  const [barcodes, setBarcodes] = React.useState('');
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[]>>({});

  const { data: nextNumbers } = useQuery({
    queryKey: ['copies', 'next-numbers'],
    queryFn: () => api.get<NextNumbers>('/copies/next-numbers'),
    enabled: open,
    // پیش‌نمایش نباید کهنه بماند: ممکن است کتابدار دیگری همین لحظه نسخه ثبت کند
    staleTime: 0,
  });

  const reset = () => {
    setCount(1); setLocationId(null); setPositionCode(''); setCondition('NEW');
    setSource('PURCHASE'); setDonorId(null); setDonorLabel(null); setDonorName(null);
    setSupplier(''); setPurchasePrice(''); setIsLoanable(true); setIsReference(false);
    setNote(''); setManualNumbers(false); setAccessionNumbers(''); setBarcodes('');
    setFieldErrors({});
  };

  const create = useMutation({
    mutationFn: () => {
      const parseLines = (value: string) =>
        value.split(/[\n,،]/).map((s) => s.trim()).filter(Boolean);

      return api.post<{ created: number; copies: Array<{ id: string; accessionNumber: string }> }>(
        '/copies',
        {
          bookId,
          count,
          locationId,
          positionCode: positionCode.trim() || null,
          condition,
          isLoanable: isReference ? false : isLoanable,
          isReference,
          acquisitionSource: source,
          donorId: source === 'DONATION' ? donorId : null,
          donorName: source === 'DONATION' && !donorId ? donorName : null,
          supplier: supplier.trim() || null,
          purchasePrice: purchasePrice ? Number(purchasePrice) : null,
          internalNote: note.trim() || null,
          ...(manualNumbers
            ? {
                accessionNumbers: parseLines(accessionNumbers),
                barcodes: parseLines(barcodes),
              }
            : {}),
        },
      );
    },
    onSuccess: (result) => {
      toast.success(
        `${toPersianDigits(result.created)} نسخه ثبت شد`,
        result.copies[0]
          ? `از شماره ثبت ${result.copies[0].accessionNumber}`
          : undefined,
      );
      void queryClient.invalidateQueries({ queryKey: ['copies'] });
      void queryClient.invalidateQueries({ queryKey: ['books'] });
      reset();
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.fieldErrors) setFieldErrors(error.fieldErrors);
      toast.apiError(error, 'ثبت نسخه انجام نشد');
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="افزودن نسخه فیزیکی"
      description={bookTitle}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={create.isPending}>انصراف</Button>
          <Button
            variant="primary"
            onClick={() => create.mutate()}
            loading={create.isPending}
            icon={<Plus className="size-4" />}
          >
            ثبت {toPersianDigits(count)} نسخه
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="تعداد نسخه" required error={fieldErrors.count} htmlFor="copy-count">
            <Input
              id="copy-count" type="number" min={1} max={500} value={count} ltr autoFocus
              onChange={(e) => setCount(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
            />
          </Field>

          <Field label="مکان (قفسه)" error={fieldErrors.locationId} hint="بعداً هم می‌توان تعیین کرد.">
            <LocationSelect
              value={locationId}
              onChange={(id) => setLocationId(id)}
              kinds={['SHELF', 'SHELF_LEVEL', 'POSITION', 'AISLE', 'SECTION', 'ROOM']}
              placeholder="بدون مکان"
            />
          </Field>
        </div>

        {!manualNumbers && nextNumbers ? (
          <div className="flex items-start gap-2 rounded border border-info/30 bg-info-soft p-3 text-xs text-info-content">
            <Info className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <p className="font-medium">شماره‌ها خودکار تخصیص می‌یابند</p>
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {nextNumbers.accession ? (
                  <span>
                    شماره ثبت از <span className="font-mono" dir="ltr">{nextNumbers.accession}</span>
                  </span>
                ) : null}
                {nextNumbers.barcode ? (
                  <span>
                    بارکد از <span className="font-mono" dir="ltr">{nextNumbers.barcode}</span>
                  </span>
                ) : null}
              </p>
              <p className="mt-1 opacity-80">
                این‌ها پیش‌نمایش‌اند و هنوز مصرف نشده‌اند؛ شماره نهایی هنگام ثبت قطعی می‌شود.
              </p>
            </div>
          </div>
        ) : null}

        <label className="flex cursor-pointer items-center gap-2 text-sm text-content-muted">
          <input
            type="checkbox"
            checked={manualNumbers}
            onChange={(e) => setManualNumbers(e.target.checked)}
            className="size-4 rounded border-border-strong text-primary focus:ring-primary/30"
          />
          شماره ثبت و بارکد را دستی وارد می‌کنم
        </label>

        {manualNumbers ? (
          <div className="grid gap-4 rounded border border-border bg-surface-sunken p-3 sm:grid-cols-2">
            <Field
              label="شماره‌های ثبت"
              error={fieldErrors.accessionNumbers}
              hint={`هر شماره در یک خط — دقیقاً ${toPersianDigits(count)} مورد`}
            >
              <Textarea
                value={accessionNumbers}
                onChange={(e) => setAccessionNumbers(e.target.value)}
                className="field-ltr font-mono text-xs"
                rows={Math.min(count + 1, 8)}
              />
            </Field>
            <Field
              label="بارکدها"
              error={fieldErrors.barcodes}
              hint="خالی بگذارید تا خودکار تولید شود."
            >
              <Textarea
                value={barcodes}
                onChange={(e) => setBarcodes(e.target.value)}
                className="field-ltr font-mono text-xs"
                rows={Math.min(count + 1, 8)}
              />
            </Field>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="وضعیت فیزیکی">
            <Select value={condition} onChange={(e) => setCondition(e.target.value)}>
              {Object.entries(COPY_CONDITION).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Select>
          </Field>

          <Field label="نحوه تأمین">
            <Select value={source} onChange={(e) => setSource(e.target.value)}>
              {Object.entries(ACQUISITION_SOURCE).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </Select>
          </Field>

          {source === 'DONATION' ? (
            <Field label="اهداکننده" className="sm:col-span-2">
              <EntityPicker
                endpoint="/donors"
                value={donorId}
                valueLabel={donorLabel ?? donorName}
                onChange={(id, label, isNew) => {
                  setDonorId(id);
                  setDonorLabel(isNew ? null : label);
                  setDonorName(isNew ? label : null);
                }}
                mapItem={(item: { id: string; fullName: string; donatedCount: number }) => ({
                  id: item.id,
                  label: item.fullName,
                  hint: `${toPersianDigits(item.donatedCount)} نسخه`,
                })}
                allowCreate
                createLabel="ثبت اهداکننده جدید"
                placeholder="جستجوی اهداکننده…"
              />
            </Field>
          ) : (
            <>
              <Field label="تأمین‌کننده / فروشنده">
                <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
              </Field>
              <Field label="قیمت خرید (تومان)">
                <Input
                  type="number" min={0} ltr value={purchasePrice}
                  onChange={(e) => setPurchasePrice(e.target.value)}
                />
              </Field>
            </>
          )}

          <Field label="کد جایگاه در قفسه" hint="مثلاً ردیف ۳، خانه ۷">
            <Input value={positionCode} onChange={(e) => setPositionCode(e.target.value)} />
          </Field>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-content-muted">
            <input
              type="checkbox"
              checked={isReference}
              onChange={(e) => { setIsReference(e.target.checked); if (e.target.checked) setIsLoanable(false); }}
              className="size-4 rounded border-border-strong text-primary focus:ring-primary/30"
            />
            نسخه مرجع (فقط سالن مطالعه)
          </label>
          <label
            className={`flex items-center gap-2 text-sm ${isReference ? 'cursor-not-allowed text-content-subtle' : 'cursor-pointer text-content-muted'}`}
          >
            <input
              type="checkbox"
              checked={isLoanable && !isReference}
              disabled={isReference}
              onChange={(e) => setIsLoanable(e.target.checked)}
              className="size-4 rounded border-border-strong text-primary focus:ring-primary/30"
            />
            قابل امانت
            {isReference ? <Badge tone="neutral">نسخه مرجع امانت داده نمی‌شود</Badge> : null}
          </label>
        </div>

        <Field label="یادداشت داخلی">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
        </Field>
      </form>
    </Modal>
  );
}
