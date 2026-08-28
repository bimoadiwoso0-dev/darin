import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Select, cn } from '@/components/ui';
import { formatNumber, toPersianDigits } from '@/lib/format';

interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * صفحه‌بندی (قانون ۹۶).
 *
 * ── چرا شماره صفحه و نه «بارگذاری بیشتر» ────────────────────────────────
 * کتابدار روی فهرست ۱۰٬۰۰۰ کتاب کار می‌کند؛ باید بتواند بگوید «صفحه ۴۲» و
 * بعداً به همان‌جا برگردد. اسکرول بی‌پایان این را ناممکن می‌کند.
 *
 * ── جهت فلش‌ها ───────────────────────────────────────────────────────────
 * در RTL «صفحه بعد» سمت چپ است. آیکون‌ها عمداً برعکس حالت LTR انتخاب
 * شده‌اند تا با جهت خواندن فارسی هماهنگ باشند.
 */
export function Pagination({
  meta, onPageChange, onPageSizeChange, className,
}: {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  className?: string;
}) {
  if (meta.total === 0) return null;

  const from = (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.page * meta.pageSize, meta.total);

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-between gap-3 border-t border-border px-4 py-3 sm:flex-row',
        'no-print',
        className,
      )}
    >
      <p className="text-xs text-content-muted">
        نمایش {formatNumber(from)} تا {formatNumber(to)} از {formatNumber(meta.total)} رکورد
      </p>

      <div className="flex items-center gap-2">
        {onPageSizeChange ? (
          <label className="flex items-center gap-1.5 text-xs text-content-muted">
            <span className="hidden sm:inline">تعداد در صفحه</span>
            <Select
              value={meta.pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="h-8 w-auto py-0 text-xs"
              aria-label="تعداد رکورد در هر صفحه"
            >
              {[20, 50, 100, 200].map((size) => (
                <option key={size} value={size}>{toPersianDigits(size)}</option>
              ))}
            </Select>
          </label>
        ) : null}

        <nav className="flex items-center gap-1" aria-label="صفحه‌بندی">
          <PageButton
            onClick={() => onPageChange(meta.page - 1)}
            disabled={meta.page <= 1}
            label="صفحه قبل"
          >
            <ChevronRight className="size-4" />
          </PageButton>

          {pageNumbers(meta.page, meta.totalPages).map((item, i) =>
            item === '…' ? (
              <span key={`gap-${i}`} className="px-1 text-xs text-content-subtle">…</span>
            ) : (
              <button
                key={item}
                type="button"
                onClick={() => onPageChange(item)}
                aria-current={item === meta.page ? 'page' : undefined}
                className={cn(
                  'min-w-8 rounded px-2 py-1.5 text-xs transition',
                  item === meta.page
                    ? 'bg-primary font-medium text-primary-content'
                    : 'text-content-muted hover:bg-surface-sunken',
                )}
              >
                {toPersianDigits(item)}
              </button>
            ),
          )}

          <PageButton
            onClick={() => onPageChange(meta.page + 1)}
            disabled={meta.page >= meta.totalPages}
            label="صفحه بعد"
          >
            <ChevronLeft className="size-4" />
          </PageButton>
        </nav>
      </div>
    </div>
  );
}

function PageButton({
  onClick, disabled, label, children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="rounded p-1.5 text-content-muted transition hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** شماره صفحه‌های نمایشی: همیشه اول، آخر و همسایه‌های صفحه فعلی. */
function pageNumbers(current: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((p) => pages.add(p));

  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);

  const result: Array<number | '…'> = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) result.push('…');
    result.push(page);
    previous = page;
  }
  return result;
}
