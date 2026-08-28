import { Mic, MicOff } from 'lucide-react';
import { cn } from '@/components/ui';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';

interface MicButtonProps {
  /** با هر تکه متن نهایی صدا زده می‌شود. */
  onTranscript: (text: string) => void;
  /** برچسب فیلد — در `aria-label` می‌آید تا صفحه‌خوان بگوید کدام فیلد. */
  fieldLabel: string;
  /** ورودی گفته‌شده پیش از تحویل، از این تابع رد می‌شود (مثلاً تبدیل عدد). */
  transform?: (text: string) => string;
  disabled?: boolean;
  className?: string;
}

/**
 * دکمه میکروفون کنار یک فیلد.
 *
 * ── چرا وقتی پشتیبانی نیست، اصلاً رندر نمی‌شود ──────────────────────────
 * دکمه‌ای که کلیک شود و کاری نکند، بدتر از نبودنش است (قانون ۱۳۵). در
 * فایرفاکس یا روی اتصال ناامن، این دکمه به‌سادگی وجود ندارد و فیلد مثل
 * همیشه تایپ می‌شود.
 *
 * ── چرا متن جایگزین نمی‌شود، افزوده می‌شود ──────────────────────────────
 * کتابدار ممکن است بخشی را تایپ کرده و بقیه را بگوید. پاک کردن آنچه
 * نوشته، کار را دوباره می‌کند.
 */
export function MicButton({
  onTranscript, fieldLabel, transform, disabled, className,
}: MicButtonProps) {
  const speech = useSpeechRecognition({
    onResult: (text) => {
      const value = transform ? transform(text) : text;
      if (value) onTranscript(value);
    },
  });

  if (!speech.isSupported) return null;

  const label = speech.isListening
    ? `توقف گفتن ${fieldLabel}`
    : `گفتن ${fieldLabel} با میکروفون`;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => (speech.isListening ? speech.stop() : speech.start())}
      aria-label={label}
      title={speech.error ?? label}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
        'disabled:cursor-not-allowed disabled:opacity-50',
        speech.isListening
          ? 'bg-danger text-white'
          : speech.error
            ? 'text-danger hover:bg-danger-soft'
            : 'text-content-subtle hover:bg-surface-sunken hover:text-primary',
        className,
      )}
    >
      {speech.isListening ? (
        <>
          <Mic className="size-4 animate-pulse" aria-hidden />
          {/* اعلام وضعیت برای صفحه‌خوان — نشانه بصری به‌تنهایی کافی نیست */}
          <span className="sr-only" role="status">در حال شنیدن</span>
        </>
      ) : speech.error ? (
        <MicOff className="size-4" aria-hidden />
      ) : (
        <Mic className="size-4" aria-hidden />
      )}
    </button>
  );
}
