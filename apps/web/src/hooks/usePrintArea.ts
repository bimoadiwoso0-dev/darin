import * as React from 'react';

/**
 * چاپ فقط یک ناحیه از صفحه.
 *
 * پنجره برچسب یا کارت عضویت داخل یک دیالوگ باز است و کل صفحه پشت آن هم
 * وجود دارد. با افزودن کلاس `print-area-only` به `body`، قاعده‌های چاپ در
 * `globals.css` همه‌چیز جز `.print-area` را پنهان می‌کنند.
 *
 * کلاس بلافاصله پس از بسته شدن پنجره چاپ برداشته می‌شود؛ رویداد
 * `afterprint` در همه مرورگرهای مدرن پشتیبانی می‌شود و در غیر این صورت
 * یک زمان‌سنج پشتیبان آن را پاک می‌کند.
 */
export function usePrintArea(): () => void {
  React.useEffect(() => {
    const cleanup = () => document.body.classList.remove('print-area-only');
    window.addEventListener('afterprint', cleanup);
    return () => {
      window.removeEventListener('afterprint', cleanup);
      cleanup();
    };
  }, []);

  return React.useCallback(() => {
    document.body.classList.add('print-area-only');
    // یک فریم صبر می‌کنیم تا مرورگر کلاس را اعمال کند و بعد چاپ شروع شود
    requestAnimationFrame(() => {
      window.print();
      // پشتیبان برای مرورگرهایی که `afterprint` نمی‌فرستند
      window.setTimeout(() => document.body.classList.remove('print-area-only'), 1500);
    });
  }, []);
}
