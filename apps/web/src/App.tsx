import * as React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Spinner } from '@/components/ui';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { SetupPage } from '@/pages/SetupPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

/** بارگذاری اولیه — تا وقتی نمی‌دانیم کاربر وارد شده یا نه، چیزی تصمیم نمی‌گیریم. */
function FullPageSpinner({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <Spinner className="size-6" />
      <p className="text-sm text-content-muted">{label}</p>
    </div>
  );
}

/**
 * دروازه ورود.
 *
 * کاربر وارد نشده به `/login` هدایت می‌شود، اما مسیر مقصد در `state`
 * نگه داشته می‌شود تا پس از ورود، دقیقاً به همان صفحه برگردد — نه به
 * داشبورد. کتابداری که روی لینک یک کتاب کلیک کرده، انتظار دارد همان
 * کتاب را ببیند.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageSpinner label="در حال بررسی نشست…" />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

interface SetupStatus {
  setupCompleted: boolean;
  hasAdminUser: boolean;
  databaseReady: boolean;
  permissionsSeeded: boolean;
  libraryName: string;
}

export function App() {
  /**
   * وضعیت راه‌اندازی اولیه (قانون ۱۱۰).
   *
   * تا وقتی هیچ مدیری ساخته نشده، تنها مسیر مجاز صفحه راه‌اندازی است؛
   * صفحه ورود بی‌معناست چون هنوز حسابی وجود ندارد. رمز مدیر در همان
   * صفحه توسط کاربر تعیین می‌شود و هیچ‌جا در کد نیست.
   */
  const { data: setup, isLoading } = useQuery({
    queryKey: ['setup', 'status'],
    queryFn: () => api.get<SetupStatus>('/setup/status'),
    staleTime: Infinity,
    retry: 1,
  });

  if (isLoading) return <FullPageSpinner label="در حال بارگذاری سامانه…" />;

  // اگر وضعیت خوانده نشد (سرور در دسترس نیست) فرض «راه‌اندازی‌شده» می‌گیریم
  // تا کاربر به‌اشتباه به صفحه ساخت مدیر نرود؛ خطای اتصال در صفحه ورود
  // نمایش داده می‌شود.
  const needsSetup = setup ? !setup.setupCompleted && !setup.hasAdminUser : false;

  return (
    <Routes>
      <Route
        path="/setup"
        element={needsSetup ? <SetupPage /> : <Navigate to="/" replace />}
      />
      <Route
        path="/login"
        element={needsSetup ? <Navigate to="/setup" replace /> : <LoginPage />}
      />

      <Route
        element={
          needsSetup ? (
            <Navigate to="/setup" replace />
          ) : (
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          )
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
