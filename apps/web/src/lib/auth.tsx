import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PermissionKey } from '@darin/shared';
import { api, ApiError } from './api';

export interface CurrentUser {
  sub: string;
  username: string;
  fullName: string;
  branchId: string | null;
  roles: string[];
  permissions: string[];
  isSuperAdmin: boolean;
}

interface AuthContextValue {
  user: CurrentUser | null;
  loading: boolean;
  login: (username: string, password: string, rememberMe: boolean) => Promise<void>;
  logout: () => Promise<void>;
  /** آیا کاربر این مجوز را دارد؟ مدیر ارشد همیشه `true`. */
  can: (permission: PermissionKey) => boolean;
  /** آیا کاربر **یکی** از این مجوزها را دارد؟ */
  canAny: (...permissions: PermissionKey[]) => boolean;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<CurrentUser>('/auth/me'),
    // ۴۰۱ یعنی «وارد نشده» — یک حالت عادی است، نه خطایی که باید دوباره تلاش شود
    retry: (count, error) =>
      !(error instanceof ApiError && (error.status === 401 || error.status === 403)) && count < 2,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const login = React.useCallback(
    async (username: string, password: string, rememberMe: boolean) => {
      await api.post('/auth/login', { username, password, rememberMe });
      // کل Cache باطل می‌شود: داده کاربر قبلی نباید به کاربر جدید نشت کند
      await queryClient.invalidateQueries();
    },
    [queryClient],
  );

  const logout = React.useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      queryClient.clear();
      // بارگذاری کامل صفحه — تضمین می‌کند هیچ حالتی از کاربر قبلی باقی نماند
      window.location.href = '/login';
    }
  }, [queryClient]);

  const permissionSet = React.useMemo(
    () => new Set(user?.permissions ?? []),
    [user?.permissions],
  );

  const can = React.useCallback(
    (permission: PermissionKey) => {
      if (!user) return false;
      if (user.isSuperAdmin) return true;
      return permissionSet.has(permission);
    },
    [user, permissionSet],
  );

  const canAny = React.useCallback(
    (...permissions: PermissionKey[]) => {
      if (!user) return false;
      if (user.isSuperAdmin) return true;
      return permissions.some((p) => permissionSet.has(p));
    },
    [user, permissionSet],
  );

  const value = React.useMemo<AuthContextValue>(
    () => ({ user: user ?? null, loading: isLoading, login, logout, can, canAny }),
    [user, isLoading, login, logout, can, canAny],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error('useAuth باید داخل AuthProvider استفاده شود.');
  return context;
}

/**
 * نمایش مشروط بر اساس مجوز.
 *
 * ── قانون ۱۳۵: دکمه بی‌عملکرد ممنوع ─────────────────────────────────────
 * دکمه‌ای که کاربر مجوزش را ندارد **پنهان** می‌شود، نه غیرفعال. دکمه
 * غیرفعال به کاربر می‌گوید «این کار ممکن است» و بعد اجازه نمی‌دهد.
 *
 * توجه: این فقط یک لایه UX است. کنترل واقعی دسترسی در Backend انجام
 * می‌شود و پنهان کردن دکمه هیچ چیزی را ایمن نمی‌کند.
 */
export function Can({
  permission, any, children, fallback = null,
}: {
  permission?: PermissionKey;
  any?: PermissionKey[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { can, canAny } = useAuth();
  const allowed = permission ? can(permission) : any ? canAny(...any) : true;
  return <>{allowed ? children : fallback}</>;
}
