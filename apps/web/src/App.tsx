import * as React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { PermissionKey } from '@darin/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, EmptyState, Spinner } from '@/components/ui';
import { AppShell } from '@/components/layout/AppShell';
import { LoginPage } from '@/pages/LoginPage';
import { SetupPage } from '@/pages/SetupPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

/*
 * ── چرا صفحه‌ها تنبل (lazy) بارگذاری می‌شوند ──────────────────────────────
 * کتابخانه ممکن است پشت یک اینترنت کند باشد. کتابداری که فقط میز امانت را
 * باز می‌کند، نباید کد نمودارهای گزارش و جادوگر ورود اطلاعات را هم دانلود
 * کند. با تقسیم بر اساس مسیر، هر صفحه فقط کد خودش را می‌آورد.
 */
const DashboardPage = React.lazy(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const BooksListPage = React.lazy(() =>
  import('@/pages/books/BooksListPage').then((m) => ({ default: m.BooksListPage })),
);
const BookDetailPage = React.lazy(() =>
  import('@/pages/books/BookDetailPage').then((m) => ({ default: m.BookDetailPage })),
);
const BookFormPage = React.lazy(() =>
  import('@/pages/books/BookFormPage').then((m) => ({ default: m.BookFormPage })),
);

function FullPageSpinner({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background">
      <Spinner className="size-6" />
      <p className="text-sm text-content-muted">{label}</p>
    </div>
  );
}

/** جای‌نگه‌دار هنگام بارگذاری کد یک صفحه — بدون پرش چیدمان. */
function RouteFallback() {
  return (
    <div className="flex items-center justify-center gap-2 py-20 text-sm text-content-muted">
      <Spinner /> در حال بارگذاری صفحه…
    </div>
  );
}

/**
 * دروازه ورود.
 *
 * کاربر وارد نشده به `/login` هدایت می‌شود، اما مسیر مقصد در `state` نگه
 * داشته می‌شود تا پس از ورود دقیقاً به همان صفحه برگردد — نه به داشبورد.
 * کتابداری که روی لینک یک کتاب کلیک کرده، انتظار دارد همان کتاب را ببیند.
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageSpinner label="در حال بررسی نشست…" />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

/**
 * محافظ مجوز مسیر.
 *
 * منوی کناری آیتم‌های بدون مجوز را پنهان می‌کند، اما کاربر می‌تواند نشانی
 * را مستقیم تایپ کند یا لینک قدیمی را باز کند. اینجا پیام روشن فارسی
 * می‌بیند، نه صفحه خالی یا خطای فنی.
 *
 * این فقط لایه تجربه کاربری است؛ کنترل واقعی دسترسی در Backend انجام
 * می‌شود و هر درخواست بدون مجوز آنجا رد می‌شود.
 */
function RequirePermission({
  permission, anyOf, children,
}: {
  permission?: PermissionKey;
  anyOf?: PermissionKey[];
  children: React.ReactNode;
}) {
  const { can, canAny } = useAuth();
  const allowed = permission ? can(permission) : anyOf ? canAny(...anyOf) : true;

  if (allowed) return <>{children}</>;

  return (
    <Card className="mx-auto max-w-lg">
      <EmptyState
        title="دسترسی به این بخش ندارید"
        description="این صفحه نیازمند مجوزی است که به نقش شما داده نشده است. اگر فکر می‌کنید اشتباهی رخ داده، با مدیر سامانه تماس بگیرید."
        action={
          <Button variant="primary" onClick={() => { window.location.href = '/'; }}>
            بازگشت به داشبورد
          </Button>
        }
      />
    </Card>
  );
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
   * صفحه ورود بی‌معناست چون هنوز حسابی وجود ندارد. رمز مدیر در همان صفحه
   * توسط کاربر تعیین می‌شود و هیچ‌جا در کد نیست.
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
    <React.Suspense fallback={<FullPageSpinner label="در حال بارگذاری…" />}>
      <Routes>
        <Route path="/setup" element={needsSetup ? <SetupPage /> : <Navigate to="/" replace />} />
        <Route path="/login" element={needsSetup ? <Navigate to="/setup" replace /> : <LoginPage />} />

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
          <Route
            index
            element={
              <RequirePermission permission="dashboard.view">
                <React.Suspense fallback={<RouteFallback />}>
                  <DashboardPage />
                </React.Suspense>
              </RequirePermission>
            }
          />

          {/* ── کتاب‌ها ────────────────────────────────────────────── */}
          <Route
            path="books"
            element={
              <RequirePermission permission="books.view">
                <React.Suspense fallback={<RouteFallback />}>
                  <BooksListPage />
                </React.Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="books/new"
            element={
              <RequirePermission permission="books.create">
                <React.Suspense fallback={<RouteFallback />}>
                  <BookFormPage />
                </React.Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="books/:id"
            element={
              <RequirePermission permission="books.view">
                <React.Suspense fallback={<RouteFallback />}>
                  <BookDetailPage />
                </React.Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="books/:id/edit"
            element={
              <RequirePermission permission="books.edit">
                <React.Suspense fallback={<RouteFallback />}>
                  <BookFormPage />
                </React.Suspense>
              </RequirePermission>
            }
          />

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
    </React.Suspense>
  );
}
