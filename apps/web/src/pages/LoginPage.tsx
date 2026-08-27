import * as React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Library, Lock, User } from 'lucide-react';
import { SETTING_KEYS } from '@darin/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, Field, Input } from '@/components/ui';

/**
 * صفحه ورود.
 *
 * ── چرا خطا عمومی است ────────────────────────────────────────────────────
 * پیام سرور برای «نام کاربری اشتباه» و «رمز اشتباه» یکسان است تا کسی نتواند
 * با آزمون‌وخطا فهرست نام‌های کاربری معتبر را بسازد. اینجا هم همان پیام
 * سرور نمایش داده می‌شود، نه تفسیر خودمان.
 *
 * ── قفل حساب ─────────────────────────────────────────────────────────────
 * پس از چند تلاش ناموفق سرور حساب را موقتاً قفل می‌کند و پیام آن فارسی و
 * گویاست؛ ما فقط نمایشش می‌دهیم.
 */
export function LoginPage() {
  const { user, login } = useAuth();
  const location = useLocation();

  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [rememberMe, setRememberMe] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const { data: publicSettings } = useQuery({
    queryKey: ['settings', 'public'],
    queryFn: () => api.get<Record<string, unknown>>('/settings/public'),
    staleTime: Infinity,
    retry: 1,
  });

  const libraryName =
    (publicSettings?.[SETTING_KEYS.LIBRARY_NAME] as string | undefined) || 'کتابخانه';

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username.trim(), password, rememberMe);
      // هدایت پس از ورود توسط `<Navigate>` پایین انجام می‌شود؛ به محض
      // به‌روز شدن Cache کاربر، این کامپوننت دوباره رندر می‌شود.
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'ارتباط با سرور برقرار نشد.',
      );
      setSubmitting(false);
    }
  };

  if (user) return <Navigate to={from && from !== '/login' ? from : '/'} replace />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex size-14 items-center justify-center rounded-xl bg-primary text-primary-content shadow-raised">
            <Library className="size-7" />
          </div>
          <h1 className="text-xl font-bold text-content">{libraryName}</h1>
          <p className="mt-1 text-sm text-content-muted">سامانه مدیریت کتابخانه دارین</p>
        </div>

        <Card className="p-5">
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Field label="نام کاربری" htmlFor="username" required>
              <Input
                id="username"
                name="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                required
                ltr
                prefixIcon={<User className="size-4" />}
                placeholder="username"
              />
            </Field>

            <Field label="رمز عبور" htmlFor="password" required>
              <Input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                ltr
                prefixIcon={<Lock className="size-4" />}
                placeholder="••••••••"
              />
            </Field>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-content-muted">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="size-4 rounded border-border-strong text-primary focus:ring-primary/30"
              />
              مرا به خاطر بسپار
            </label>

            {error ? (
              <div
                role="alert"
                className="rounded border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-content"
              >
                {error}
              </div>
            ) : null}

            <Button type="submit" variant="primary" className="w-full" loading={submitting}>
              ورود به سامانه
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-center text-2xs text-content-subtle">
          اگر رمز عبور خود را فراموش کرده‌اید، با مدیر سامانه تماس بگیرید.
        </p>
      </div>
    </div>
  );
}
