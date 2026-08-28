import * as React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Loader2, X } from 'lucide-react';

/** ادغام کلاس‌های Tailwind با حل تعارض (`p-2` + `p-4` → `p-4`). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ═══════════════════════════════════════════════════════════════════════════
//  دکمه
// ═══════════════════════════════════════════════════════════════════════════

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-content hover:bg-primary-hover shadow-sm',
  secondary: 'bg-surface-sunken text-content hover:bg-border border border-border',
  outline: 'border border-border-strong text-content hover:bg-surface-sunken',
  ghost: 'text-content-muted hover:bg-surface-sunken hover:text-content',
  danger: 'bg-danger text-white hover:brightness-110 shadow-sm',
  success: 'bg-success text-white hover:brightness-110 shadow-sm',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-input px-4 text-sm gap-2',
  lg: 'h-11 px-6 text-base gap-2',
  icon: 'h-input w-input p-0',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'secondary', size = 'md', loading, icon, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      // دکمه در حال بارگذاری غیرفعال است تا کتابدار دو بار امانت ثبت نکند
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded font-medium transition',
        'disabled:cursor-not-allowed disabled:opacity-55',
        'focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  ),
);
Button.displayName = 'Button';

// ═══════════════════════════════════════════════════════════════════════════
//  فیلد ورودی
// ═══════════════════════════════════════════════════════════════════════════

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  /**
   * محتوای لاتین (بارکد، شابک، نام کاربری).
   * بدون این، مرورگر متن لاتین را داخل فیلد RTL برعکس نشان می‌دهد.
   */
  ltr?: boolean;
  prefixIcon?: React.ReactNode;
  suffix?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ltr, prefixIcon, suffix, ...props }, ref) => (
    <div className="relative flex items-center">
      {prefixIcon ? (
        <span className="pointer-events-none absolute start-3 text-content-subtle" aria-hidden>
          {prefixIcon}
        </span>
      ) : null}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'h-input w-full rounded border bg-surface px-3 text-sm text-content transition',
          'placeholder:text-content-subtle',
          'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25',
          'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-content-subtle',
          invalid ? 'border-danger focus:border-danger focus:ring-danger/25' : 'border-border',
          prefixIcon && 'ps-9',
          suffix && 'pe-9',
          ltr && 'field-ltr',
          className,
        )}
        {...props}
      />
      {suffix ? (
        <span className="absolute end-3 text-content-subtle">{suffix}</span>
      ) : null}
    </div>
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }
>(({ className, invalid, ...props }, ref) => (
  <textarea
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn(
      'min-h-[5rem] w-full rounded border bg-surface px-3 py-2 text-sm text-content transition',
      'placeholder:text-content-subtle',
      'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25',
      invalid ? 'border-danger' : 'border-border',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }
>(({ className, invalid, children, ...props }, ref) => (
  <select
    ref={ref}
    aria-invalid={invalid || undefined}
    className={cn(
      'h-input w-full rounded border bg-surface px-3 text-sm text-content transition',
      'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25',
      'disabled:cursor-not-allowed disabled:bg-surface-sunken',
      invalid ? 'border-danger' : 'border-border',
      className,
    )}
    {...props}
  >
    {children}
  </select>
));
Select.displayName = 'Select';

// ═══════════════════════════════════════════════════════════════════════════
//  فیلد فرم — برچسب، راهنما و خطا در یک بسته
// ═══════════════════════════════════════════════════════════════════════════

export function Field({
  label, required, error, hint, children, className, htmlFor,
}: {
  label?: string;
  required?: boolean;
  error?: string | string[];
  hint?: string;
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  const messages = Array.isArray(error) ? error : error ? [error] : [];
  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? (
        <label htmlFor={htmlFor} className="block text-xs font-medium text-content-muted">
          {label}
          {required ? <span className="text-danger ms-1" aria-hidden>*</span> : null}
        </label>
      ) : null}
      {children}
      {messages.length > 0 ? (
        // `role="alert"` تا صفحه‌خوان خطا را بی‌درنگ اعلام کند
        <div role="alert" className="space-y-0.5">
          {messages.map((m) => (
            <p key={m} className="text-xs text-danger">{m}</p>
          ))}
        </div>
      ) : hint ? (
        <p className="text-xs text-content-subtle">{hint}</p>
      ) : null}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  کارت
// ═══════════════════════════════════════════════════════════════════════════

export function Card({
  className, children, ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-surface shadow-card', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title, description, action, className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3 border-b border-border px-4 py-3', className)}>
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-content">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-xs text-content-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  نشان وضعیت
// ═══════════════════════════════════════════════════════════════════════════

type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-sunken text-content-muted border-border',
  primary: 'bg-primary-soft text-primary border-primary/20',
  success: 'bg-success-soft text-success-content border-success/20',
  warning: 'bg-warning-soft text-warning-content border-warning/20',
  danger: 'bg-danger-soft text-danger-content border-danger/20',
  info: 'bg-info-soft text-info-content border-info/20',
};

export function Badge({
  tone = 'neutral', children, className, icon,
}: {
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
  icon?: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded border px-2 py-0.5 text-2xs font-medium',
        BADGE_TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  حالت‌های خالی و بارگذاری (قوانین ۹۳، ۹۴)
// ═══════════════════════════════════════════════════════════════════════════

export function EmptyState({
  icon, title, description, action, className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icon ? (
        <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-surface-sunken text-content-subtle">
          {icon}
        </div>
      ) : null}
      <p className="text-sm font-medium text-content">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-xs text-content-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton h-4 w-full', className)} aria-hidden />;
}

/** اسکلت جدول — ساختار نهایی را از قبل نشان می‌دهد تا پرش چیدمان نداشته باشیم. */
export function TableSkeleton({ rows = 8, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="divide-y divide-border" aria-busy="true" aria-live="polite">
      <span className="sr-only">در حال بارگذاری…</span>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-row items-center gap-4 px-4">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton
              key={c}
              className={c === 0 ? 'w-1/3' : c === columns - 1 ? 'w-16' : 'w-1/6'}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  جدول
// ═══════════════════════════════════════════════════════════════════════════

/**
 * پوسته جدول با اسکرول افقی مستقل.
 * جدول‌های عریض نباید کل صفحه را افقی اسکرول کنند (قانون ۹۵).
 */
export function TableWrapper({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full min-w-[40rem] border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({
  children, className, numeric, amount, ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean; amount?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap border-b border-border bg-surface-sunken px-4 py-2.5',
        'text-start text-2xs font-semibold uppercase tracking-wide text-content-muted',
        numeric && 'text-end',
        className,
      )}
      data-amount={amount || undefined}
      {...props}
    >
      {children}
    </th>
  );
}

export function Td({
  children, className, numeric, amount, ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & {
  /** عبارت عددی با ترتیب معنادار (مثل «۳ / ۵») — چپ‌به‌راست رسم می‌شود */
  numeric?: boolean;
  /** مبلغ — جهت فارسی می‌ماند، فقط ارقام هم‌عرض می‌شوند */
  amount?: boolean;
}) {
  return (
    <td
      className={cn(
        'border-b border-border px-4 py-2.5 align-middle',
        numeric && 'cell-numeric',
        amount && 'cell-amount',
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  دیالوگ
// ═══════════════════════════════════════════════════════════════════════════

export function Modal({
  open, onClose, title, description, children, footer, size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}) {
  const ref = React.useRef<HTMLDivElement>(null);

  // Esc برای بستن (قانون ۴۶)
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // جلوگیری از اسکرول پس‌زمینه هنگام باز بودن دیالوگ
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  // تمرکز اولیه روی دیالوگ تا Tab داخل آن بماند
  React.useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  if (!open) return null;

  const widths = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:items-center">
      <div
        className="fixed inset-0 bg-black/45 animate-fade-in"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={cn(
          'relative z-10 w-full rounded-lg border border-border bg-surface shadow-overlay animate-slide-up',
          widths[size],
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-content">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-xs text-content-muted">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="بستن"
            className="rounded p-1 text-content-subtle transition hover:bg-surface-sunken hover:text-content"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 py-4">{children}</div>

        {footer ? (
          <div className="flex justify-end gap-2 border-t border-border bg-surface-sunken px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * دیالوگ تأیید عملیات خطرناک (قانون ۹۱).
 * حذف، بایگانی و تغییر وضعیت بحرانی باید از این عبور کنند.
 */
export function ConfirmDialog({
  open, onClose, onConfirm, title, message, confirmLabel = 'تأیید',
  cancelLabel = 'انصراف', tone = 'danger', loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-content-muted">{message}</div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  سایر
// ═══════════════════════════════════════════════════════════════════════════

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin text-content-subtle', className)} aria-hidden />;
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn('border-border', className)} />;
}

/** برچسب و مقدار — الگوی پرتکرار صفحات جزئیات. */
export function DataRow({
  label, value, className, ltr,
}: {
  label: string;
  value: React.ReactNode;
  className?: string;
  ltr?: boolean;
}) {
  return (
    <div className={cn('flex items-baseline gap-3 py-1.5', className)}>
      <dt className="w-32 shrink-0 text-xs text-content-muted">{label}</dt>
      <dd className={cn('min-w-0 flex-1 text-sm text-content', ltr && 'field-ltr')}>
        {value || <span className="text-content-subtle">—</span>}
      </dd>
    </div>
  );
}
