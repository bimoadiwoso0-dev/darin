import * as React from 'react';
import { Check, Mic, Square, Trash2, TriangleAlert } from 'lucide-react';
import {
  CONTRIBUTOR_ROLE, LANGUAGES, parseBookDictation, type DictatedBook,
} from '@darin/shared';
import { Button, cn } from '@/components/ui';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { toPersianDigits } from '@/lib/format';

const FIELD_LABELS: Record<string, string> = {
  title: 'عنوان',
  subtitle: 'عنوان فرعی',
  titleEn: 'عنوان لاتین',
  originalTitle: 'عنوان اصلی',
  publisherName: 'ناشر',
  publicationPlace: 'محل انتشار',
  summary: 'چکیده',
  keywords: 'کلیدواژه‌ها',
  internalNote: 'یادداشت',
  volumeTitle: 'عنوان جلد',
  deweyCode: 'رده دیویی',
  publicationYear: 'سال انتشار',
  pageCount: 'تعداد صفحه',
  edition: 'نوبت چاپ',
  volumeNumber: 'شماره جلد',
  totalVolumes: 'تعداد جلد',
};

const EXAMPLE =
  'عنوان قلعه حیوانات، نویسنده جورج اورول، مترجم امیر امیرشاهی، ' +
  'ناشر امیرکبیر، سال هزار و سیصد و نود و نه، تعداد صفحه صد و بیست';

interface VoiceEntryPanelProps {
  onApply: (parsed: DictatedBook) => void;
}

/**
 * ثبت کتاب با گفتن، به‌جای تایپ.
 *
 * ── چرا نتیجه پیش از اعمال نشان داده می‌شود ─────────────────────────────
 * تشخیص گفتار همیشه درست نمی‌شنود. اگر نتیجه مستقیم داخل فرم بنشیند،
 * کتابدار باید ۱۵ فیلد را وارسی کند تا بفهمد کدام غلط است — کاری کندتر از
 * تایپ کردن از اول. پس اول **دقیقاً همان چیزی که فهمیده شد** نشان داده
 * می‌شود و اعمال، یک کلیک آگاهانه است.
 *
 * ── چرا بخش «شناخته نشد» جداگانه نمایش داده می‌شود ──────────────────────
 * سکوتِ ابزار درباره چیزی که کاربر گفته ولی جایی ننشسته، بدترین حالت است:
 * کتابدار فکر می‌کند ثبت شده. هرچه به هیچ فیلدی نخورده، صریح گفته می‌شود.
 */
export function VoiceEntryPanel({ onApply }: VoiceEntryPanelProps) {
  const speech = useSpeechRecognition({ continuous: true });
  const [applied, setApplied] = React.useState(false);

  const spoken = [speech.transcript, speech.interim].filter(Boolean).join(' ').trim();
  const parsed = React.useMemo(
    () => (speech.transcript ? parseBookDictation(speech.transcript) : null),
    [speech.transcript],
  );

  // در مرورگری که پشتیبانی ندارد، هیچ چیزی نشان داده نمی‌شود (قانون ۱۳۵)
  if (!speech.isSupported) return null;

  const chips: Array<{ label: string; value: string }> = [];
  if (parsed) {
    for (const [field, value] of Object.entries(parsed.text)) {
      if (value) chips.push({ label: FIELD_LABELS[field] ?? field, value });
    }
    for (const [field, value] of Object.entries(parsed.numbers)) {
      chips.push({ label: FIELD_LABELS[field] ?? field, value: toPersianDigits(value) });
    }
    if (parsed.isbn) chips.push({ label: 'شابک', value: toPersianDigits(parsed.isbn) });
    if (parsed.language) {
      chips.push({
        label: 'زبان',
        value: LANGUAGES[parsed.language as keyof typeof LANGUAGES] ?? parsed.language,
      });
    }
    for (const contributor of parsed.contributors) {
      chips.push({ label: CONTRIBUTOR_ROLE[contributor.role], value: contributor.fullName });
    }
  }

  const handleApply = () => {
    if (!parsed) return;
    onApply(parsed);
    setApplied(true);
    speech.reset();
    window.setTimeout(() => setApplied(false), 2500);
  };

  const handleReset = () => {
    speech.stop();
    speech.reset();
  };

  return (
    <div className="mb-4 rounded border border-border bg-surface-sunken p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Mic className="size-4 text-primary" aria-hidden />
          <h2 className="text-sm font-medium text-content">ثبت با گفتار</h2>
          {applied ? (
            <span className="flex items-center gap-1 text-xs text-success-content">
              <Check className="size-3.5" aria-hidden />
              در فرم اعمال شد
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {speech.transcript ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={handleReset}
              icon={<Trash2 className="size-4" />}
            >
              پاک کردن
            </Button>
          ) : null}

          <Button
            size="sm"
            variant={speech.isListening ? 'danger' : 'primary'}
            onClick={() => (speech.isListening ? speech.stop() : speech.start())}
            icon={
              speech.isListening ? (
                <Square className="size-4" />
              ) : (
                <Mic className="size-4" />
              )
            }
          >
            {speech.isListening ? 'پایان گفتن' : 'شروع گفتن'}
          </Button>
        </div>
      </div>

      {speech.error ? (
        <p className="mt-3 flex items-start gap-2 rounded border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger-content">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {speech.error}
        </p>
      ) : null}

      {/* راهنما فقط تا وقتی چیزی گفته نشده — بعد از آن جای مفیدتری دارد */}
      {!spoken && !speech.error ? (
        <p className="mt-3 text-xs leading-6 text-content-muted">
          میکروفون را روشن کنید و اطلاعات کتاب را با نام فیلد بگویید. مثال:
          <span className="mt-1 block rounded bg-surface px-2 py-1 text-content">
            «{EXAMPLE}»
          </span>
          نتیجه پیش از اعمال نشان داده می‌شود و تا تأیید نکنید، فرم تغییر نمی‌کند.
        </p>
      ) : null}

      {spoken ? (
        <p
          className={cn(
            'mt-3 rounded border border-border bg-surface px-3 py-2 text-sm leading-6 text-content',
            speech.isListening && 'border-primary/40',
          )}
          // متن زنده باید به صفحه‌خوان هم برسد، ولی نه با هر حرف
          aria-live="polite"
        >
          {speech.transcript}
          {speech.interim ? (
            <span className="text-content-subtle"> {speech.interim}</span>
          ) : null}
        </p>
      ) : null}

      {chips.length > 0 ? (
        <div className="mt-3">
          <p className="mb-2 text-xs text-content-muted">آنچه فهمیده شد:</p>
          <ul className="flex flex-wrap gap-1.5">
            {chips.map((chip, index) => (
              <li
                key={`${chip.label}-${index}`}
                className="rounded border border-border bg-surface px-2 py-1 text-xs"
              >
                <span className="text-content-muted">{chip.label}:</span>{' '}
                <span className="text-content">{chip.value}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {parsed?.unrecognized ? (
        <p className="mt-3 flex items-start gap-2 rounded border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-content">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            این بخش به هیچ فیلدی نخورد و اعمال نمی‌شود: «{parsed.unrecognized}».
            نام فیلد را پیش از مقدار بگویید — مثلاً «ناشر ققنوس».
          </span>
        </p>
      ) : null}

      {chips.length > 0 ? (
        <div className="mt-3 flex justify-end">
          <Button
            size="sm"
            variant="success"
            onClick={handleApply}
            icon={<Check className="size-4" />}
          >
            پر کردن فرم با این اطلاعات
          </Button>
        </div>
      ) : null}
    </div>
  );
}
