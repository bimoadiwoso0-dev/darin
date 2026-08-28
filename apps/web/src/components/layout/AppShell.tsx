import * as React from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Keyboard, LogOut, Menu, Moon, Monitor, Sun, User } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { Modal, cn } from '@/components/ui';
import { GlobalSearch } from './GlobalSearch';
import { Sidebar } from './Sidebar';

/** میان‌برهای صفحه‌کلید (قانون ۴۶) — همین فهرست در راهنما هم نمایش داده می‌شود. */
export const SHORTCUTS: Array<{ keys: string; label: string; path?: string }> = [
  { keys: 'F2', label: 'پرش به جستجوی سراسری' },
  { keys: 'F3', label: 'ثبت عضو جدید', path: '/members/new' },
  { keys: 'F4', label: 'میز امانت', path: '/circulation' },
  { keys: 'F5', label: 'ثبت بازگشت', path: '/returns' },
  { keys: 'F6', label: 'ثبت کتاب جدید', path: '/books/new' },
  { keys: 'F8', label: 'داشبورد', path: '/' },
  { keys: 'Esc', label: 'بستن پنجره یا لغو عملیات' },
  { keys: '؟ / Shift+/', label: 'نمایش همین راهنما' },
];

export function AppShell() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);

  /** نشانه‌های منو — رزروهای آماده تحویل، دیرکردها و یادآوری‌های پیگیری‌نشده. */
  const { data: badges } = useQuery({
    queryKey: ['dashboard', 'badges'],
    queryFn: async () => {
      // هر دو در یک رفت‌وبرگشت؛ دو درخواست جدا برای دو عدد، هزینه بیهوده است
      const [summary, notices] = await Promise.all([
        api.get<{ circulation: { readyForPickup: number; overdueTotal: number } }>('/dashboard'),
        api
          .get<{ pending: number }>('/notifications/summary')
          // کاربری که مجوز امانت ندارد اینجا ۴۰۳ می‌گیرد؛ نبودِ نشانه
          // نباید کل نوار کناری را خالی کند.
          .catch(() => ({ pending: 0 })),
      ]);
      return {
        readyReservations: summary.circulation.readyForPickup,
        overdue: summary.circulation.overdueTotal,
        pendingNotices: notices.pending,
      };
    },
    // هر ۲ دقیقه — کافی برای اطلاع، بدون فشار بی‌دلیل روی سرور
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  /**
   * میان‌برهای سراسری.
   *
   * نکته مهم: وقتی تمرکز داخل یک فیلد ورودی است، میان‌برهای حرفی نباید
   * فعال شوند — وگرنه کتابدار نمی‌تواند «؟» را داخل یادداشت تایپ کند.
   * کلیدهای F چون روی تایپ اثر ندارند، همیشه فعال‌اند.
   */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      // راهنمای میان‌برها
      if (!typing && (e.key === '?' || (e.shiftKey && e.key === '/'))) {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      const shortcut = SHORTCUTS.find((s) => s.keys === e.key && s.path);
      if (shortcut?.path) {
        e.preventDefault();
        navigate(shortcut.path);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const themeIcons = { light: Sun, dark: Moon, system: Monitor };
  const ThemeIcon = themeIcons[theme];
  /*
   * ترتیب چرخه تم: خودکار ← تیره ← روشن ← خودکار.
   *
   * ترتیب متعارف (روشن ← تیره ← خودکار) یک ایراد دارد: حالت پیش‌فرض
   * «خودکار» است و روی سیستمی که روشن تنظیم شده، اولین کلیک کاربر را به
   * «روشن» می‌برد — یعنی هیچ تغییری نمی‌بیند و فکر می‌کند دکمه خراب است.
   * با این ترتیب، اولین کلیک همیشه ظاهر را عوض می‌کند.
   */
  const nextTheme = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system';
  const themeLabels = { light: 'روشن', dark: 'تیره', system: 'خودکار' };

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} badges={badges} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-header shrink-0 items-center gap-3 border-b border-border bg-surface/90 px-3 backdrop-blur sm:px-4 no-print">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="باز کردن منو"
            className="rounded p-2 text-content-muted transition hover:bg-surface-sunken lg:hidden"
          >
            <Menu className="size-5" />
          </button>

          <GlobalSearch />

          <div className="ms-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setShortcutsOpen(true)}
              aria-label="راهنمای میان‌برهای صفحه‌کلید"
              title="میان‌برهای صفحه‌کلید (؟)"
              className="hidden rounded p-2 text-content-muted transition hover:bg-surface-sunken sm:block"
            >
              <Keyboard className="size-4.5" />
            </button>

            <button
              type="button"
              onClick={() => setTheme(nextTheme)}
              aria-label={`تغییر تم — اکنون: ${themeLabels[theme]}`}
              title={`تم: ${themeLabels[theme]}`}
              className="rounded p-2 text-content-muted transition hover:bg-surface-sunken"
            >
              <ThemeIcon className="size-4.5" />
            </button>

            <div className="mx-1 hidden h-6 w-px bg-border sm:block" />

            <div className="hidden items-center gap-2 sm:flex">
              <div className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-primary">
                <User className="size-4" />
              </div>
              <div className="hidden min-w-0 md:block">
                <p className="truncate text-xs font-medium text-content">{user?.fullName}</p>
                <p className="truncate text-2xs text-content-subtle">{user?.username}</p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void logout()}
              aria-label="خروج از سامانه"
              title="خروج"
              className="rounded p-2 text-content-muted transition hover:bg-danger-soft hover:text-danger"
            >
              <LogOut className="size-4.5" />
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-3 sm:p-4 lg:p-6">
          <Outlet />
        </main>
      </div>

      <Modal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        title="میان‌برهای صفحه‌کلید"
        description="برای کار سریع‌تر بدون ماوس"
      >
        <ul className="divide-y divide-border">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center justify-between gap-4 py-2.5">
              <span className="text-sm text-content">{s.label}</span>
              <kbd className={cn(
                'shrink-0 rounded border border-border bg-surface-sunken px-2 py-1',
                'font-mono text-xs text-content-muted field-ltr',
              )}>
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}

/** نوار عنوان صفحه — الگوی مشترک همه صفحات. */
export function PageHeader({
  title, description, actions, breadcrumb,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {breadcrumb ? <div className="mb-1">{breadcrumb}</div> : null}
        <h1 className="truncate text-2xl font-bold text-content">{title}</h1>
        {description ? (
          <p className="mt-0.5 text-sm text-content-muted">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 no-print">{actions}</div>
      ) : null}
    </div>
  );
}

