import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Check, Library, ScrollText, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, Card, Field, Input, cn } from '@/components/ui';
import { formatMoney } from '@/lib/format';

/**
 * راه‌اندازی اولیه (قوانین ۱۱۰، ۱۱۱).
 *
 * ── چرا رمز مدیر اینجا تعیین می‌شود ──────────────────────────────────────
 * هیچ حساب مدیر با رمز پیش‌فرض در Seed ساخته نمی‌شود. اولین کسی که سامانه
 * را باز می‌کند، خودش نام کاربری و رمز مدیر ارشد را می‌سازد. بنابراین هیچ
 * رمزی در مخزن کد، مستندات یا فایل نمونه وجود ندارد.
 *
 * ── چرا سه گام ───────────────────────────────────────────────────────────
 * پرسیدن ۱۲ فیلد در یک صفحه، کاربر را می‌ترساند. سه گام کوتاه با عنوان
 * روشن، همان اطلاعات را با فشار ذهنی کمتر می‌گیرد.
 */

type StepKey = 'library' | 'admin' | 'rules';

const STEPS: Array<{ key: StepKey; title: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'library', title: 'مشخصات کتابخانه', icon: Building2 },
  { key: 'admin', title: 'حساب مدیر', icon: ShieldCheck },
  { key: 'rules', title: 'قوانین امانت', icon: ScrollText },
];

interface FormState {
  libraryName: string;
  address: string;
  phone: string;
  email: string;
  username: string;
  fullName: string;
  adminEmail: string;
  password: string;
  passwordConfirm: string;
  maxItems: number;
  periodDays: number;
  maxRenewals: number;
  dailyFineAmount: number;
  createStarterLocations: boolean;
}

const INITIAL: FormState = {
  libraryName: '',
  address: '',
  phone: '',
  email: '',
  username: '',
  fullName: '',
  adminEmail: '',
  password: '',
  passwordConfirm: '',
  maxItems: 5,
  periodDays: 14,
  maxRenewals: 2,
  dailyFineAmount: 5000,
  createStarterLocations: true,
};

/** ارزیابی ساده قدرت رمز — فقط راهنمای بصری؛ قانون واقعی در سرور است. */
function passwordStrength(value: string): { score: number; label: string; tone: string } {
  let score = 0;
  if (value.length >= 10) score++;
  if (value.length >= 14) score++;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++;
  if (/[0-9]/.test(value)) score++;
  if (/[^a-zA-Z0-9]/.test(value)) score++;

  if (score <= 2) return { score, label: 'ضعیف', tone: 'bg-danger' };
  if (score === 3) return { score, label: 'متوسط', tone: 'bg-warning' };
  if (score === 4) return { score, label: 'خوب', tone: 'bg-info' };
  return { score, label: 'قوی', tone: 'bg-success' };
}

export function SetupPage() {
  const queryClient = useQueryClient();
  const { login } = useAuth();

  const [step, setStep] = React.useState(0);
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!e[key as string]) return e;
      const next = { ...e };
      delete next[key as string];
      return next;
    });
  };

  /** اعتبارسنجی همان گام — کاربر نباید تا گام آخر برود و بعد خطا ببیند. */
  const validateStep = (index: number): boolean => {
    const next: Record<string, string> = {};

    if (index === 0) {
      if (form.libraryName.trim().length < 2) next.libraryName = 'نام کتابخانه را وارد کنید.';
      if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
        next.email = 'ایمیل معتبر نیست.';
      }
    }

    if (index === 1) {
      if (!/^[a-zA-Z0-9._-]{3,60}$/.test(form.username.trim())) {
        next.username = 'نام کاربری حداقل ۳ نویسه و فقط شامل حروف انگلیسی، عدد، نقطه، خط تیره و زیرخط باشد.';
      }
      if (form.fullName.trim().length < 2) next.fullName = 'نام و نام خانوادگی را وارد کنید.';
      if (form.password.length < 10) next.password = 'رمز عبور باید حداقل ۱۰ نویسه باشد.';
      else if (!/[a-zA-Z]/.test(form.password) || !/[0-9]/.test(form.password)) {
        next.password = 'رمز عبور باید شامل حرف و عدد باشد.';
      }
      if (form.password !== form.passwordConfirm) {
        next.passwordConfirm = 'تکرار رمز عبور مطابقت ندارد.';
      }
      if (form.adminEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.adminEmail)) {
        next.adminEmail = 'ایمیل معتبر نیست.';
      }
    }

    if (index === 2) {
      if (form.maxItems < 1) next.maxItems = 'حداقل یک جلد.';
      if (form.periodDays < 1) next.periodDays = 'حداقل یک روز.';
      if (form.dailyFineAmount < 0) next.dailyFineAmount = 'مبلغ نمی‌تواند منفی باشد.';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async () => {
    if (!validateStep(2)) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await api.post('/setup/complete', {
        library: {
          name: form.libraryName.trim(),
          address: form.address.trim() || undefined,
          phone: form.phone.trim() || undefined,
          email: form.email.trim() || '',
          timezone: 'Asia/Tehran',
          currency: 'IRT',
        },
        admin: {
          username: form.username.trim().toLowerCase(),
          fullName: form.fullName.trim(),
          email: form.adminEmail.trim() || '',
          password: form.password,
        },
        rules: {
          maxItems: form.maxItems,
          periodDays: form.periodDays,
          maxRenewals: form.maxRenewals,
          dailyFineAmount: form.dailyFineAmount,
        },
        createStarterLocations: form.createStarterLocations,
      });

      // ورود خودکار با همان مشخصاتی که کاربر تازه ساخته — دوباره پرسیدن
      // رمز بلافاصله پس از ساختنش، کار اضافه بی‌دلیل است.
      await login(form.username.trim().toLowerCase(), form.password, false);
      await queryClient.invalidateQueries({ queryKey: ['setup', 'status'] });
      window.location.href = '/';
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'راه‌اندازی انجام نشد.');
      setSubmitting(false);
    }
  };

  const next = () => {
    if (!validateStep(step)) return;
    if (step === STEPS.length - 1) void submit();
    else setStep((s) => s + 1);
  };

  const strength = passwordStrength(form.password);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex size-14 items-center justify-center rounded-xl bg-primary text-primary-content shadow-raised">
            <Library className="size-7" />
          </div>
          <h1 className="text-xl font-bold text-content">راه‌اندازی سامانه دارین</h1>
          <p className="mt-1 text-sm text-content-muted">
            چند دقیقه وقت می‌گیرد و فقط یک بار انجام می‌شود.
          </p>
        </div>

        {/* نوار گام‌ها */}
        <ol className="mb-4 flex items-center gap-2" aria-label="گام‌های راه‌اندازی">
          {STEPS.map((s, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <li key={s.key} className="flex flex-1 items-center gap-2">
                <div
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition',
                    done && 'border-success bg-success text-white',
                    active && 'border-primary bg-primary text-primary-content',
                    !done && !active && 'border-border bg-surface text-content-subtle',
                  )}
                  aria-current={active ? 'step' : undefined}
                >
                  {done ? <Check className="size-4" /> : <s.icon className="size-4" />}
                </div>
                <span
                  className={cn(
                    'hidden truncate text-xs sm:block',
                    active ? 'font-medium text-content' : 'text-content-subtle',
                  )}
                >
                  {s.title}
                </span>
                {i < STEPS.length - 1 ? (
                  <div className={cn('h-px flex-1', done ? 'bg-success' : 'bg-border')} />
                ) : null}
              </li>
            );
          })}
        </ol>

        <Card className="p-5">
          <form
            onSubmit={(e) => { e.preventDefault(); next(); }}
            className="space-y-4"
            noValidate
          >
            {step === 0 ? (
              <>
                <Field label="نام کتابخانه" htmlFor="libraryName" required error={errors.libraryName}>
                  <Input
                    id="libraryName"
                    value={form.libraryName}
                    onChange={(e) => set('libraryName', e.target.value)}
                    invalid={!!errors.libraryName}
                    autoFocus
                    placeholder="مثلاً: کتابخانه عمومی شهید بهشتی"
                  />
                </Field>
                <Field label="نشانی" htmlFor="address" hint="در برچسب‌ها و کارت عضویت چاپ می‌شود.">
                  <Input id="address" value={form.address} onChange={(e) => set('address', e.target.value)} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="تلفن" htmlFor="phone">
                    <Input id="phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} ltr />
                  </Field>
                  <Field label="ایمیل" htmlFor="email" error={errors.email}>
                    <Input
                      id="email" type="email" value={form.email} ltr
                      onChange={(e) => set('email', e.target.value)}
                      invalid={!!errors.email}
                    />
                  </Field>
                </div>
                <label className="flex cursor-pointer items-start gap-2 rounded border border-border bg-surface-sunken p-3">
                  <input
                    type="checkbox"
                    checked={form.createStarterLocations}
                    onChange={(e) => set('createStarterLocations', e.target.checked)}
                    className="mt-0.5 size-4 rounded border-border-strong text-primary focus:ring-primary/30"
                  />
                  <span className="text-xs text-content-muted">
                    <span className="block text-sm font-medium text-content">
                      ساخت ساختار اولیه قفسه‌ها
                    </span>
                    یک ساختمان، یک طبقه و چهار بخش (عمومی، مرجع، کودک، مخزن) ساخته می‌شود.
                    بعداً می‌توانید آن را تغییر دهید یا حذف کنید.
                  </span>
                </label>
              </>
            ) : null}

            {step === 1 ? (
              <>
                <div className="rounded border border-info/30 bg-info-soft p-3 text-xs leading-relaxed text-info-content">
                  این حساب دسترسی کامل به سامانه دارد. رمز عبور آن هیچ‌جا ذخیره یا
                  نمایش داده نمی‌شود؛ آن را در جای امن نگه دارید.
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="نام کاربری" htmlFor="username" required error={errors.username}>
                    <Input
                      id="username" value={form.username} ltr autoComplete="username" autoFocus
                      onChange={(e) => set('username', e.target.value)}
                      invalid={!!errors.username}
                      placeholder="admin"
                    />
                  </Field>
                  <Field label="نام و نام خانوادگی" htmlFor="fullName" required error={errors.fullName}>
                    <Input
                      id="fullName" value={form.fullName}
                      onChange={(e) => set('fullName', e.target.value)}
                      invalid={!!errors.fullName}
                    />
                  </Field>
                </div>
                <Field label="ایمیل مدیر" htmlFor="adminEmail" error={errors.adminEmail}>
                  <Input
                    id="adminEmail" type="email" value={form.adminEmail} ltr
                    onChange={(e) => set('adminEmail', e.target.value)}
                    invalid={!!errors.adminEmail}
                  />
                </Field>
                <Field
                  label="رمز عبور"
                  htmlFor="password"
                  required
                  error={errors.password}
                  hint="حداقل ۱۰ نویسه، شامل حرف و عدد."
                >
                  <Input
                    id="password" type="password" value={form.password} ltr autoComplete="new-password"
                    onChange={(e) => set('password', e.target.value)}
                    invalid={!!errors.password}
                  />
                </Field>
                {form.password ? (
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                      <div
                        className={cn('h-full rounded-full transition-all', strength.tone)}
                        style={{ width: `${(strength.score / 5) * 100}%` }}
                      />
                    </div>
                    <span className="text-2xs text-content-muted">{strength.label}</span>
                  </div>
                ) : null}
                <Field label="تکرار رمز عبور" htmlFor="passwordConfirm" required error={errors.passwordConfirm}>
                  <Input
                    id="passwordConfirm" type="password" value={form.passwordConfirm} ltr
                    autoComplete="new-password"
                    onChange={(e) => set('passwordConfirm', e.target.value)}
                    invalid={!!errors.passwordConfirm}
                  />
                </Field>
              </>
            ) : null}

            {step === 2 ? (
              <>
                <p className="text-xs text-content-muted">
                  این‌ها مقادیر پیش‌فرض‌اند و هر زمان در «تنظیمات» قابل تغییرند.
                  نوع عضویت‌ها می‌توانند مقدار متفاوتی داشته باشند.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="حداکثر کتاب هم‌زمان" htmlFor="maxItems" required error={errors.maxItems}>
                    <Input
                      id="maxItems" type="number" min={1} max={100} value={form.maxItems} ltr
                      onChange={(e) => set('maxItems', Number(e.target.value))}
                      invalid={!!errors.maxItems}
                    />
                  </Field>
                  <Field label="مدت امانت (روز)" htmlFor="periodDays" required error={errors.periodDays}>
                    <Input
                      id="periodDays" type="number" min={1} max={365} value={form.periodDays} ltr
                      onChange={(e) => set('periodDays', Number(e.target.value))}
                      invalid={!!errors.periodDays}
                    />
                  </Field>
                  <Field label="حداکثر دفعات تمدید" htmlFor="maxRenewals" required>
                    <Input
                      id="maxRenewals" type="number" min={0} max={20} value={form.maxRenewals} ltr
                      onChange={(e) => set('maxRenewals', Number(e.target.value))}
                    />
                  </Field>
                  <Field
                    label="جریمه روزانه دیرکرد (تومان)"
                    htmlFor="dailyFineAmount"
                    required
                    error={errors.dailyFineAmount}
                    hint={form.dailyFineAmount > 0 ? formatMoney(form.dailyFineAmount) : 'بدون جریمه'}
                  >
                    <Input
                      id="dailyFineAmount" type="number" min={0} step={500} value={form.dailyFineAmount} ltr
                      onChange={(e) => set('dailyFineAmount', Number(e.target.value))}
                      invalid={!!errors.dailyFineAmount}
                    />
                  </Field>
                </div>
              </>
            ) : null}

            {serverError ? (
              <div
                role="alert"
                className="rounded border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger-content"
              >
                {serverError}
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-2 pt-1">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                disabled={step === 0 || submitting}
              >
                بازگشت
              </Button>
              <Button type="submit" variant="primary" loading={submitting}>
                {step === STEPS.length - 1 ? 'پایان و ورود به سامانه' : 'ادامه'}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
