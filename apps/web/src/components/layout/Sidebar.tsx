import * as React from 'react';
import { NavLink } from 'react-router-dom';
import type { PermissionKey } from '@darin/shared';
import {
  Archive, BarChart3, BookOpen, Bookmark, Boxes, Building2, ClipboardCheck,
  CreditCard, FileText, FolderTree, Landmark, LayoutDashboard, Library,
  ScanBarcode, Settings, Shield, Tags, Undo2, Users, UserCog, Wallet, X,
} from 'lucide-react';
import { cn } from '@/components/ui';
import { useAuth } from '@/lib/auth';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** مجوز لازم — بدون آن، آیتم برای این کاربر نمایش داده نمی‌شود */
  permission?: PermissionKey;
  anyOf?: PermissionKey[];
  /** نشانه عددی (مثلاً تعداد رزروهای آماده تحویل) */
  badgeKey?: 'readyReservations' | 'overdue';
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * گروه‌بندی منو طبق قانون ۱۱۸.
 *
 * ترتیب گروه‌ها بر اساس تناوب استفاده روزانه کتابدار است، نه ترتیب
 * الفبایی: امانت و بازگشت بالاتر از تنظیمات‌اند چون روزی ده‌ها بار
 * استفاده می‌شوند.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    label: '',
    items: [
      { to: '/', label: 'داشبورد', icon: LayoutDashboard, permission: 'dashboard.view' },
      { to: '/circulation', label: 'میز امانت', icon: ScanBarcode, permission: 'loans.create' },
    ],
  },
  {
    label: 'امانت',
    items: [
      { to: '/loans', label: 'امانت‌ها', icon: BookOpen, permission: 'loans.view' },
      { to: '/returns', label: 'بازگشت', icon: Undo2, permission: 'loans.return' },
      { to: '/reservations', label: 'رزروها', icon: Bookmark, permission: 'reservations.view', badgeKey: 'readyReservations' },
      { to: '/fines', label: 'جریمه‌ها', icon: Wallet, permission: 'fines.view' },
    ],
  },
  {
    label: 'کتابخانه',
    items: [
      { to: '/books', label: 'کتاب‌ها', icon: Library, permission: 'books.view' },
      { to: '/copies', label: 'نسخه‌های فیزیکی', icon: Boxes, permission: 'copies.view' },
      { to: '/authors', label: 'پدیدآورندگان', icon: Users, permission: 'authors.view' },
      { to: '/publishers', label: 'ناشران', icon: Landmark, permission: 'publishers.view' },
      { to: '/categories', label: 'دسته‌بندی‌ها', icon: FolderTree, permission: 'categories.view' },
      { to: '/series', label: 'مجموعه‌ها', icon: Tags, permission: 'books.view' },
    ],
  },
  {
    label: 'مکان',
    items: [
      { to: '/locations', label: 'قفسه‌ها و مکان‌ها', icon: Building2, permission: 'locations.view' },
      { to: '/inventory', label: 'شمارش موجودی', icon: ClipboardCheck, anyOf: ['inventory.view', 'inventory.manage'] },
    ],
  },
  {
    label: 'اعضا',
    items: [
      { to: '/members', label: 'اعضا', icon: Users, permission: 'members.view' },
      { to: '/membership-cards', label: 'کارت عضویت', icon: CreditCard, permission: 'members.card' },
    ],
  },
  {
    label: 'گزارش',
    items: [
      { to: '/reports', label: 'گزارش‌ها', icon: BarChart3, permission: 'reports.view' },
      { to: '/imports', label: 'ورود اطلاعات', icon: FileText, permission: 'imports.run' },
    ],
  },
  {
    label: 'مدیریت',
    items: [
      { to: '/users', label: 'کاربران', icon: UserCog, permission: 'users.view' },
      { to: '/roles', label: 'نقش‌ها و دسترسی‌ها', icon: Shield, permission: 'roles.manage' },
      { to: '/audit-logs', label: 'گزارش فعالیت‌ها', icon: FileText, permission: 'audit.view' },
      { to: '/backups', label: 'پشتیبان‌گیری', icon: Archive, permission: 'backup.manage' },
      { to: '/settings', label: 'تنظیمات', icon: Settings, anyOf: ['settings.view', 'settings.manage'] },
    ],
  },
];

export function Sidebar({
  open, onClose, badges,
}: {
  open: boolean;
  onClose: () => void;
  badges?: Partial<Record<'readyReservations' | 'overdue', number>>;
}) {
  const { can, canAny, user } = useAuth();

  const visibleGroups = React.useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          if (item.permission) return can(item.permission);
          if (item.anyOf) return canAny(...item.anyOf);
          return true;
        }),
      })).filter((group) => group.items.length > 0),
    [can, canAny],
  );

  return (
    <>
      {/* پوشش تیره در موبایل هنگام باز بودن منو */}
      {open ? (
        <div
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 z-40 flex w-sidebar flex-col border-e border-border bg-surface',
          'transition-transform duration-200 lg:static lg:translate-x-0',
          // در RTL منو از سمت راست می‌آید؛ `start-0` این را خودکار مدیریت می‌کند
          'start-0',
          open ? 'translate-x-0' : 'translate-x-full lg:translate-x-0',
        )}
        aria-label="منوی اصلی"
      >
        <div className="flex h-header shrink-0 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded bg-primary text-primary-content">
              <Library className="size-4.5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-content">دارین</p>
              <p className="truncate text-2xs text-content-subtle">مدیریت کتابخانه</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن منو"
            className="rounded p-1 text-content-subtle hover:bg-surface-sunken lg:hidden"
          >
            <X className="size-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {visibleGroups.map((group, index) => (
            <div key={group.label || index} className={index > 0 ? 'mt-4' : ''}>
              {group.label ? (
                <p className="px-3 pb-1.5 text-2xs font-semibold uppercase tracking-wide text-content-subtle">
                  {group.label}
                </p>
              ) : null}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const badge = item.badgeKey ? badges?.[item.badgeKey] : undefined;
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.to === '/'}
                        onClick={onClose}
                        className={({ isActive }) =>
                          cn(
                            'flex items-center gap-2.5 rounded px-3 py-2 text-sm transition',
                            isActive
                              ? 'bg-primary-soft font-medium text-primary'
                              : 'text-content-muted hover:bg-surface-sunken hover:text-content',
                          )
                        }
                      >
                        <item.icon className="size-4 shrink-0" />
                        <span className="flex-1 truncate">{item.label}</span>
                        {badge ? (
                          <span className="rounded-full bg-warning px-1.5 py-0.5 text-2xs font-semibold text-white">
                            {new Intl.NumberFormat('fa-IR').format(badge)}
                          </span>
                        ) : null}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-border px-4 py-3">
          <p className="truncate text-xs font-medium text-content">{user?.fullName}</p>
          <p className="truncate text-2xs text-content-subtle">
            {user?.isSuperAdmin ? 'مدیر ارشد سیستم' : user?.roles.join('، ')}
          </p>
        </div>
      </aside>
    </>
  );
}
