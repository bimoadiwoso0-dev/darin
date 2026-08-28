import * as React from 'react';

/**
 * تشخیص گفتار فارسی با Web Speech API.
 *
 * ── چرا این API و نه سرویس سمت سرور ─────────────────────────────────────
 * سرویس سمت سرور یعنی ضبط صدا، آپلود، کلید API و هزینه به‌ازای هر دقیقه.
 * برای کاری که مرورگر رایگان و بدون هیچ زیرساختی انجام می‌دهد، این هزینه
 * توجیه ندارد. اگر روزی نیاز به کار آفلاین جدی شد، همین قلاب می‌تواند به
 * موتور دیگری وصل شود بدون آنکه هیچ صفحه‌ای تغییر کند.
 *
 * ── محدودیت‌هایی که باید بدانید ─────────────────────────────────────────
 * ۱. فقط در مرورگرهای مبتنی بر Chromium کار می‌کند. فایرفاکس پشتیبانی
 *    ندارد. به همین دلیل `isSupported` وجود دارد و رابط کاربری وقتی
 *    پشتیبانی نیست، **دکمه‌ای نشان نمی‌دهد** — دکمه‌ای که کار نکند بدتر از
 *    نبودن آن است.
 * ۲. کروم صدا را برای تبدیل به سرورهای گوگل می‌فرستد. یعنی بدون اینترنت
 *    کار نمی‌کند و متن گفته‌شده از کتابخانه خارج می‌شود. برای عنوان کتاب
 *    بی‌اهمیت است، ولی باید گفته شود و در `docs/SECURITY.md` آمده است.
 * ۳. نیازمند بستر امن است: `https` یا `localhost`. روی `http` ساده،
 *    مرورگر اجازه دسترسی به میکروفون نمی‌دهد.
 */

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResult {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getConstructor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** پیام فارسی برای هر خطای موتور تشخیص گفتار (قانون ۷۵). */
const ERROR_MESSAGES: Record<string, string> = {
  'not-allowed':
    'اجازه دسترسی به میکروفون داده نشده است. از نوار نشانی مرورگر، دسترسی میکروفون را برای این سایت مجاز کنید.',
  'service-not-allowed':
    'مرورگر اجازه استفاده از سرویس تشخیص گفتار را نداد. اتصال باید امن (HTTPS) باشد.',
  'audio-capture': 'میکروفونی پیدا نشد. اتصال میکروفون را بررسی کنید.',
  network: 'تشخیص گفتار به اینترنت نیاز دارد و ارتباط برقرار نشد.',
  'no-speech': 'صدایی شنیده نشد. دوباره تلاش کنید.',
  aborted: '',
};

export interface UseSpeechRecognitionOptions {
  /** ادامه دادن پس از هر مکث — برای دیکته یک رکورد کامل. */
  continuous?: boolean;
  lang?: string;
  /** با هر نتیجه نهایی صدا زده می‌شود. */
  onResult?: (transcript: string) => void;
}

export interface SpeechRecognitionState {
  isSupported: boolean;
  isListening: boolean;
  /** متن نهاییِ تاکنون شنیده‌شده. */
  transcript: string;
  /** متن در حال شنیدن — هنوز قطعی نیست و فقط برای بازخورد زنده است. */
  interim: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions = {},
): SpeechRecognitionState {
  const { continuous = false, lang = 'fa-IR', onResult } = options;

  const [isListening, setListening] = React.useState(false);
  const [transcript, setTranscript] = React.useState('');
  const [interim, setInterim] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const recognitionRef = React.useRef<SpeechRecognitionLike | null>(null);

  /*
   * تازه‌ترین `onResult` در یک ref نگه داشته می‌شود تا تغییر آن، موتور
   * تشخیص را دوباره نسازد — وسط شنیدن، ساختن دوباره یعنی قطع شدن صدا.
   * انتساب داخل افکت انجام می‌شود، نه در بدنه رندر: نوشتن روی ref هنگام
   * رندر با رندر همزمان React ناسازگار است.
   */
  const onResultRef = React.useRef(onResult);
  React.useEffect(() => {
    onResultRef.current = onResult;
  });

  /*
   * پشتیبانی یک بار سنجیده می‌شود و دیگر تغییر نمی‌کند. `useState` با
   * مقداردهی تنبل استفاده شده تا در رندر سمت سرور هم امن باشد.
   */
  const [isSupported] = React.useState(() => getConstructor() !== null);

  const stop = React.useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const reset = React.useCallback(() => {
    setTranscript('');
    setInterim('');
    setError(null);
  }, []);

  const start = React.useCallback(() => {
    const Ctor = getConstructor();
    if (!Ctor) return;

    // شروع دوباره روی نمونه در حال اجرا، خطای مرورگر می‌دهد
    recognitionRef.current?.abort();

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = continuous;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setError(null);
      setListening(true);
    };

    recognition.onresult = (event) => {
      let finalChunk = '';
      let interimChunk = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) finalChunk += text;
        else interimChunk += text;
      }

      setInterim(interimChunk);

      if (finalChunk) {
        setTranscript((previous) => (previous ? `${previous} ${finalChunk}` : finalChunk).trim());
        onResultRef.current?.(finalChunk.trim());
      }
    };

    recognition.onerror = (event) => {
      // «aborted» یعنی خود ما متوقفش کردیم؛ خطا نیست و نباید نمایش داده شود
      const message = ERROR_MESSAGES[event.error] ?? 'تشخیص گفتار با خطا مواجه شد.';
      if (message) setError(message);
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
      setInterim('');
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setError('شروع تشخیص گفتار ممکن نشد.');
      setListening(false);
    }
  }, [continuous, lang]);

  // رها کردن میکروفون هنگام خروج از صفحه — وگرنه نشانه ضبط روشن می‌ماند
  React.useEffect(() => () => recognitionRef.current?.abort(), []);

  return { isSupported, isListening, transcript, interim, error, start, stop, reset };
}
