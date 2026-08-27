import * as React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { ApiError } from './lib/api';
import { AuthProvider } from './lib/auth';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './lib/toast';
import './styles/globals.css';

/**
 * پیکربندی لایه داده.
 *
 * ── چرا تلاش مجدد شرطی است ───────────────────────────────────────────────
 * تکرار خودکار درخواستی که با ۴۰۳ (نبود مجوز) یا ۴۰۴ رد شده، فقط سرور را
 * درگیر می‌کند و پاسخ عوض نمی‌شود. فقط خطای شبکه و خطای سرور ارزش تکرار
 * دارند.
 *
 * ── چرا `refetchOnWindowFocus` روشن است ─────────────────────────────────
 * میز امانت معمولاً چند ساعت باز می‌ماند. وقتی کتابدار برمی‌گردد، باید
 * وضعیت واقعی نسخه‌ها را ببیند نه عکس چند ساعت پیش را.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => {
        if (error instanceof ApiError) {
          if (error.status === 0) return count < 2; // قطع شبکه
          if (error.status >= 400 && error.status < 500) return false;
        }
        return count < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
    mutations: {
      // نوشتن هرگز خودکار تکرار نمی‌شود: تکرار یک «ثبت امانت» می‌تواند
      // دو رکورد بسازد.
      retry: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <BrowserRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
