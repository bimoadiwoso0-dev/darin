import * as React from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * فیلترهای فهرست در نشانی صفحه (Query String).
 *
 * ── چرا در URL و نه در State ─────────────────────────────────────────────
 * کتابدار فهرست «کتاب‌های ناموجود بخش کودک» را می‌سازد و می‌خواهد لینکش را
 * برای همکارش بفرستد، یا در نوار نشانک ذخیره کند، یا با دکمه بازگشت مرورگر
 * به همان فهرست برگردد. اگر فیلتر در State باشد، هیچ‌کدام کار نمی‌کند.
 *
 * مقادیر برابر با پیش‌فرض از URL حذف می‌شوند تا نشانی تمیز بماند.
 */
export function useUrlFilters<T extends Record<string, string | number | boolean | undefined>>(
  defaults: T,
) {
  const [searchParams, setSearchParams] = useSearchParams();

  const values = React.useMemo(() => {
    const result = { ...defaults };
    for (const key of Object.keys(defaults) as Array<keyof T & string>) {
      const raw = searchParams.get(key);
      if (raw === null) continue;
      const fallback = defaults[key];
      if (typeof fallback === 'number') {
        const parsed = Number(raw);
        result[key] = (Number.isFinite(parsed) ? parsed : fallback) as T[keyof T & string];
      } else if (typeof fallback === 'boolean') {
        result[key] = (raw === 'true') as T[keyof T & string];
      } else {
        result[key] = raw as T[keyof T & string];
      }
    }
    return result;
    // `defaults` معمولاً یک شیء ثابت ماژول است؛ وابستگی به `searchParams` کافی است.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const setFilters = React.useCallback(
    (patch: Partial<T>, options: { resetPage?: boolean } = {}) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            const fallback = defaults[key as keyof T];
            if (value === undefined || value === '' || value === fallback) next.delete(key);
            else next.set(key, String(value));
          }
          // تغییر هر فیلتری یعنی فهرست عوض شده؛ ماندن در صفحه ۷ بی‌معناست
          if (options.resetPage !== false && !('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams, defaults],
  );

  const reset = React.useCallback(() => setSearchParams({}, { replace: true }), [setSearchParams]);

  /** آیا فیلتری غیر از صفحه‌بندی فعال است؟ — برای نمایش دکمه «پاک کردن فیلترها» */
  const hasActiveFilters = React.useMemo(
    () =>
      Array.from(searchParams.keys()).some(
        (key) => key !== 'page' && key !== 'pageSize' && key !== 'sort' && key !== 'order',
      ),
    [searchParams],
  );

  return { values, setFilters, reset, hasActiveFilters };
}

/** تأخیر در اعمال مقدار — برای کادر جستجو تا هر ضربه کلید یک درخواست نفرستد. */
export function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
