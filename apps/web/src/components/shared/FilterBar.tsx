import * as React from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { Badge, Button, Input, cn } from '@/components/ui';

/**
 * نوار جستجو و فیلتر فهرست‌ها (قانون ۳۳).
 *
 * فیلترهای پیشرفته پیش‌فرض بسته‌اند: ۹۰٪ مواقع کتابدار فقط تایپ می‌کند و
 * Enter می‌زند. اما اگر فیلتری فعال باشد، پنل خودکار باز می‌ماند تا کاربر
 * نبیند فهرست خالی است و نداند چرا.
 */
export function FilterBar({
  search, onSearchChange, placeholder = 'جستجو…', activeCount, onReset, children, actions,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  placeholder?: string;
  /** تعداد فیلترهای فعال — روی دکمه نمایش داده می‌شود */
  activeCount?: number;
  onReset?: () => void;
  /** فیلترهای پیشرفته */
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const [expanded, setExpanded] = React.useState(() => (activeCount ?? 0) > 0);

  return (
    <div className="border-b border-border no-print">
      <div className="flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[12rem] flex-1">
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            prefixIcon={<Search className="size-4" />}
            suffix={
              search ? (
                <button
                  type="button"
                  onClick={() => onSearchChange('')}
                  aria-label="پاک کردن جستجو"
                  className="pointer-events-auto rounded p-0.5 hover:text-content"
                >
                  <X className="size-3.5" />
                </button>
              ) : undefined
            }
          />
        </div>

        {children ? (
          <Button
            variant={expanded ? 'secondary' : 'ghost'}
            onClick={() => setExpanded((e) => !e)}
            icon={<SlidersHorizontal className="size-4" />}
            aria-expanded={expanded}
          >
            فیلترها
            {activeCount ? <Badge tone="primary">{activeCount}</Badge> : null}
          </Button>
        ) : null}

        {activeCount && onReset ? (
          <Button variant="ghost" size="sm" onClick={onReset} icon={<X className="size-3.5" />}>
            پاک کردن
          </Button>
        ) : null}

        {actions ? <div className="ms-auto flex items-center gap-2">{actions}</div> : null}
      </div>

      {children && expanded ? (
        <div className={cn('grid gap-3 border-t border-border bg-surface-sunken p-3', 'sm:grid-cols-2 lg:grid-cols-4')}>
          {children}
        </div>
      ) : null}
    </div>
  );
}
