import * as React from 'react';
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/components/ui';
import { ApiError } from './api';

/**
 * اعلان نتیجه عملیات (قانون ۹۲).
 *
 * هر عملیات کتابدار باید بازخورد صریح بدهد: امانت ثبت شد، جریمه محاسبه
 * شد، بارکد تکراری بود. سکوت پس از کلیک، کاربر را مجبور می‌کند صفحه را
 * تازه کند تا مطمئن شود کاری انجام شده.
 */

type ToastTone = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  /** شناسه درخواست — برای پیگیری خطا در گزارش سرور */
  requestId?: string;
  duration: number;
}

interface ToastContextValue {
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
  /** نمایش خطای API با پیام فارسی آماده سرور. */
  apiError: (error: unknown, fallbackTitle?: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const TONE_CONFIG: Record<ToastTone, { icon: React.ReactNode; className: string }> = {
  success: {
    icon: <CheckCircle2 className="size-5 shrink-0 text-success" />,
    className: 'border-success/30 bg-success-soft',
  },
  error: {
    icon: <AlertCircle className="size-5 shrink-0 text-danger" />,
    className: 'border-danger/30 bg-danger-soft',
  },
  warning: {
    icon: <TriangleAlert className="size-5 shrink-0 text-warning" />,
    className: 'border-warning/30 bg-warning-soft',
  },
  info: {
    icon: <Info className="size-5 shrink-0 text-info" />,
    className: 'border-info/30 bg-info-soft',
  },
};

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const push = React.useCallback(
    (tone: ToastTone, title: string, description?: string, requestId?: string) => {
      const id = nextId++;
      // خطاها بیشتر می‌مانند: کاربر باید فرصت خواندن پیام را داشته باشد
      const duration = tone === 'error' ? 8000 : tone === 'warning' ? 6000 : 4000;
      setToasts((current) => [...current.slice(-4), { id, tone, title, description, requestId, duration }]);
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const value = React.useMemo<ToastContextValue>(
    () => ({
      success: (title, description) => push('success', title, description),
      error: (title, description) => push('error', title, description),
      warning: (title, description) => push('warning', title, description),
      info: (title, description) => push('info', title, description),

      apiError: (error, fallbackTitle = 'عملیات انجام نشد') => {
        if (error instanceof ApiError) {
          // خطای اعتبارسنجی معمولاً زیر خود فیلد نمایش داده می‌شود؛
          // اینجا فقط خلاصه‌ای نشان می‌دهیم.
          const fields = error.fieldErrors;
          const description = fields
            ? Object.values(fields).flat().slice(0, 3).join(' ')
            : undefined;
          push('error', error.message, description, error.requestId);
        } else if (error instanceof Error) {
          push('error', fallbackTitle, error.message);
        } else {
          push('error', fallbackTitle);
        }
      },
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/*
        `aria-live="polite"` تا صفحه‌خوان پیام را پس از اتمام خواندن فعلی
        اعلام کند و کاربر را وسط کار قطع نکند.
      */}
      <div
        className="toast-viewport pointer-events-none fixed bottom-4 start-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
        role="region"
        aria-live="polite"
        aria-label="اعلان‌ها"
      >
        {toasts.map((toast) => {
          const config = TONE_CONFIG[toast.tone];
          return (
            <div
              key={toast.id}
              className={cn(
                'pointer-events-auto flex items-start gap-3 rounded-lg border p-3 shadow-raised animate-slide-up',
                config.className,
              )}
            >
              {config.icon}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-content">{toast.title}</p>
                {toast.description ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-content-muted">
                    {toast.description}
                  </p>
                ) : null}
                {toast.requestId ? (
                  <p className="mt-1 text-2xs text-content-subtle field-ltr">
                    شناسه پیگیری: {toast.requestId.slice(0, 8)}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="بستن اعلان"
                className="shrink-0 rounded p-0.5 text-content-subtle transition hover:text-content"
              >
                <X className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) throw new Error('useToast باید داخل ToastProvider استفاده شود.');
  return context;
}
