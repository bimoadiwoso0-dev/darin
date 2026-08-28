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
const CopiesListPage = React.lazy(() =>
  import('@/pages/books/CopiesListPage').then((m) => ({ default: m.CopiesListPage })),
);
const CopyDetailPage = React.lazy(() =>
  import('@/pages/books/CopyDetailPage').then((m) => ({ default: m.CopyDetailPage })),
);
const MembersListPage = React.lazy(() =>
  import('@/pages/members/MembersListPage').then((m) => ({ default: m.MembersListPage })),
);
const MemberDetailPage = React.lazy(() =>
  import('@/pages/members/MemberDetailPage').then((m) => ({ default: m.MemberDetailPage })),
);
const MemberFormPage = React.lazy(() =>
  import('@/pages/members/MemberFormPage').then((m) => ({ default: m.MemberFormPage })),
);
const CirculationDeskPage = React.lazy(() =>
  import('@/pages/circulation/CirculationDeskPage').then((m) => ({ default: m.CirculationDeskPage })),
);
const ReturnsPage = React.lazy(() =>
  import('@/pages/circulation/ReturnsPage').then((m) => ({ default: m.ReturnsPage })),
);
const LoansListPage = React.lazy(() =>
  import('@/pages/circulation/LoansListPage').then((m) => ({ default: m.LoansListPage })),
);
const ReservationsPage = React.lazy(() =>
  import('@/pages/circulation/ReservationsPage').then((m) => ({ default: m.ReservationsPage })),
);
const FinesPage = React.lazy(() =>
  import('@/pages/circulation/FinesPage').then((m) => ({ default: m.FinesPage })),
);
const LocationsPage = React.lazy(() =>
  import('@/pages/locations/LocationsPage').then((m) => ({ default: m.LocationsPage })),
);
const LocationDetailPage = React.lazy(() =>
  import('@/pages/locations/LocationDetailPage').then((m) => ({ default: m.LocationDetailPage })),
);
const InventoryPage = React.lazy(() =>
  import('@/pages/locations/InventoryPage').then((m) => ({ default: m.InventoryPage })),
);
const InventorySessionPage = React.lazy(() =>
  import('@/pages/locations/InventorySessionPage').then((m) => ({ default: m.InventorySessionPage })),
);
const ReportsPage = React.lazy(() =>
  import('@/pages/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
const ImportsPage = React.lazy(() =>
  import('@/pages/reports/ImportsPage').then((m) => ({ default: m.ImportsPage })),
);
const SettingsPage = React.lazy(() =>
  import('@/pages/admin/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const AuditLogPage = React.lazy(() =>
  import('@/pages/admin/AuditLogPage').then((m) => ({ default: m.AuditLogPage })),
);
const BackupsPage = React.lazy(() =>
  import('@/pages/admin/BackupsPage').then((m) => ({ default: m.BackupsPage })),
);
const UsersPage = React.lazy(() =>
  import('@/pages/admin/UsersPage').then((m) => ({ default: m.UsersPage })),
);
const RolesPage = React.lazy(() =>
  import('@/pages/admin/RolesPage').then((m) => ({ default: m.RolesPage })),
);
const PersonsPage = React.lazy(() =>
  import('@/pages/catalog/ReferenceDataPage').then((m) => ({ default: m.PersonsPage })),
);
const PublishersPage = React.lazy(() =>
  import('@/pages/catalog/ReferenceDataPage').then((m) => ({ default: m.PublishersPage })),
);
const SeriesPage = React.lazy(() =>
  import('@/pages/catalog/ReferenceDataPage').then((m) => ({ default: m.SeriesPage })),
);
const CategoriesPage = React.lazy(() =>
  import('@/pages/catalog/CategoriesPage').then((m) => ({ default: m.CategoriesPage })),
);
const MembershipCardsPage = React.lazy(() =>
  import('@/pages/members/MembershipCardsPage').then((m) => ({ default: m.MembershipCardsPage })),
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

          {/* ── نسخه‌های فیزیکی ────────────────────────────────────── */}
          <Route
            path="copies"
            element={
              <RequirePermission permission="copies.view">
                <React.Suspense fallback={<RouteFallback />}>
                  <CopiesListPage />
                </React.Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="copies/:id"
            element={
              <RequirePermission permission="copies.view">
                <React.Suspense fallback={<RouteFallback />}>
                  <CopyDetailPage />
                </React.Suspense>
              </RequirePermission>
            }
          />

          {/* ── اعضا ───────────────────────────────────────────────── */}
          <Route
            path="members"
            element={
              <RequirePermission permission="members.view">
                <React.Suspense fallback={<RouteFallback />}>
                  <MembersListPage />
                </React.Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="members/new"
            element={
              <RequirePermission permission="members.create">
                <React.Suspense fallback={<RouteFallback />}>
                  <MemberFormPage />
                </React.Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="members/:id"
            element={
              <RequirePermission permission="members.view">
                <React.Suspense fallback={<RouteFallback />}>
                  <MemberDetailPage />
                </React.Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="members/:id/edit"
            element={
              <RequirePermission permission="members.edit">
                <React.Suspense fallback={<RouteFallback />}>
                  <MemberFormPage />
                </React.Suspense>
              </RequirePermission>
            }
          />

          {/* ── امانت ──────────────────────────────────────────────── */}
          <Route
            path="circulation"
            element={
              <RequirePermission permission="loans.create">
                <React.Suspense fallback={<RouteFallback />}>
                  <CirculationDeskPage />
                </React.Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="returns"
            element={
              <RequirePermission permission="loans.return">
                <React.Suspense fallback={<RouteFallback />}>
                  <ReturnsPage />
                </React.Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="loans"
            element={
              <RequirePermission permission="loans.view">
                <React.Suspense fallback={<RouteFallback />}>
                  <LoansListPage />
                </React.Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="reservations"
            element={
              <RequirePermission permission="reservations.view">
                <React.Suspense fallback={<RouteFallback />}>
                  <ReservationsPage />
                </React.Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="fines"
            element={
              <RequirePermission permission="fines.view">
                <React.Suspense fallback={<RouteFallback />}>
                  <FinesPage />
                </React.Suspense>
              </RequirePermission>
            }
          />

          {/* ── مکان ───────────────────────────────────────────────── */}
          <Route
            path="locations"
            element={
              <RequirePermission permission="locations.view">
                <React.Suspense fallback={<RouteFallback />}>
                  <LocationsPage />
                </React.Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="locations/:id"
            element={
              <RequirePermission permission="locations.view">
                <React.Suspense fallback={<RouteFallback />}>
                  <LocationDetailPage />
                </React.Suspense>
              </RequirePermission>
            }
          />

          {/* ── شمارش موجودی ───────────────────────────────────────── */}
          <Route
            path="inventory"
            element={
              <RequirePermission anyOf={['inventory.view', 'inventory.manage']}>
                <React.Suspense fallback={<RouteFallback />}>
                  <InventoryPage />
                </React.Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="inventory/:id"
            element={
              <RequirePermission anyOf={['inventory.view', 'inventory.manage']}>
                <React.Suspense fallback={<RouteFallback />}>
                  <InventorySessionPage />
                </React.Suspense>
              </RequirePermission>
            }
          />

          {/* ── گزارش و ورود اطلاعات ───────────────────────────────── */}
          <Route
            path="reports"
            element={
              <RequirePermission permission="reports.view">
                <React.Suspense fallback={<RouteFallback />}>
                  <ReportsPage />
                </React.Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="imports"
            element={
              <RequirePermission permission="imports.run">
                <React.Suspense fallback={<RouteFallback />}>
                  <ImportsPage />
                </React.Suspense>
              </RequirePermission>
            }
          />

          {/* ── مدیریت ─────────────────────────────────────────────── */}
          <Route
            path="settings"
            element={
              <RequirePermission anyOf={['settings.view', 'settings.manage']}>
                <React.Suspense fallback={<RouteFallback />}>
                  <SettingsPage />
                </React.Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="audit-logs"
            element={
              <RequirePermission permission="audit.view">
                <React.Suspense fallback={<RouteFallback />}>
                  <AuditLogPage />
                </React.Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="backups"
            element={
              <RequirePermission permission="backup.manage">
                <React.Suspense fallback={<RouteFallback />}>
                  <BackupsPage />
                </React.Suspense>
              </RequirePermission>
            }
          />

          <Route
            path="users"
            element={
              <RequirePermission permission="users.view">
                <React.Suspense fallback={<RouteFallback />}>
                  <UsersPage />
                </React.Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="roles"
            element={
              <RequirePermission permission="roles.manage">
                <React.Suspense fallback={<RouteFallback />}>
                  <RolesPage />
                </React.Suspense>
              </RequirePermission>
            }
          />

          {/* ── داده مرجع کاتالوگ ──────────────────────────────────── */}
          <Route
            path="authors"
            element={
              <RequirePermission permission="authors.view">
                <React.Suspense fallback={<RouteFallback />}>
                  <PersonsPage />
                </React.Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="publishers"
            element={
              <RequirePermission permission="publishers.view">
                <React.Suspense fallback={<RouteFallback />}>
                  <PublishersPage />
                </React.Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="categories"
            element={
              <RequirePermission permission="categories.view">
                <React.Suspense fallback={<RouteFallback />}>
                  <CategoriesPage />
                </React.Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="series"
            element={
              <RequirePermission permission="books.view">
                <React.Suspense fallback={<RouteFallback />}>
                  <SeriesPage />
                </React.Suspense>
              </RequirePermission>
            }
          />
          <Route
            path="membership-cards"
            element={
              <RequirePermission permission="members.card">
                <React.Suspense fallback={<RouteFallback />}>
                  <MembershipCardsPage />
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
