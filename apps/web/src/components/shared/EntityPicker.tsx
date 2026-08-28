import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Plus, X } from 'lucide-react';
import { api, type Paginated } from '@/lib/api';
import { Spinner, cn } from '@/components/ui';
import { useDebounced } from '@/hooks/useUrlFilters';

export interface PickerOption {
  id: string;
  label: string;
  hint?: string;
}

/**
 * انتخابگر رکورد مرجع (ناشر، پدیدآورنده، مجموعه، عضو…).
 *
 * ── چرا جستجوی سمت سرور ─────────────────────────────────────────────────
 * کتابخانه ممکن است ۲٬۰۰۰ ناشر و ۸٬۰۰۰ پدیدآورنده داشته باشد. یک `<select>`
 * با ۸٬۰۰۰ گزینه هم کند است هم غیرقابل استفاده. اینجا هر بار فقط ۱۰ نتیجه
 * مرتبط از سرور می‌آید.
 *
 * ── امکان ثبت درجا ──────────────────────────────────────────────────────
 * کتابدار وسط ثبت کتاب به ناشری می‌رسد که هنوز در سیستم نیست. مجبور کردنش
 * به رها کردن فرم و رفتن به صفحه ناشران، کار را کند می‌کند. با `allowCreate`
 * همان نام تایپ‌شده به‌عنوان مقدار جدید برگردانده می‌شود و سرور رکوردش را
 * می‌سازد.
 */
export function EntityPicker({
  endpoint,
  value,
  valueLabel,
  onChange,
  mapItem,
  placeholder = 'جستجو و انتخاب…',
  allowCreate,
  createLabel = 'ثبت به‌عنوان مورد جدید',
  disabled,
  invalid,
  extraParams,
  id,
}: {
  /** مسیر API که `{ data, meta }` برمی‌گرداند، مثلاً `/publishers` */
  endpoint: string;
  value: string | null;
  /** برچسب مقدار فعلی — لازم است چون خود مقدار فقط یک شناسه است */
  valueLabel?: string | null;
  onChange: (id: string | null, label: string | null, isNew?: boolean) => void;
  mapItem: (item: never) => PickerOption;
  placeholder?: string;
  allowCreate?: boolean;
  createLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  extraParams?: Record<string, unknown>;
  id?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [highlighted, setHighlighted] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const debounced = useDebounced(query.trim(), 250);

  const { data, isFetching } = useQuery({
    queryKey: ['picker', endpoint, debounced, extraParams],
    queryFn: () =>
      api.get<Paginated<never>>(endpoint, { q: debounced || undefined, pageSize: 10, ...extraParams }),
    enabled: open,
    staleTime: 30_000,
  });

  const options = React.useMemo(() => (data?.data ?? []).map(mapItem), [data, mapItem]);

  const canCreate =
    allowCreate &&
    query.trim().length >= 2 &&
    !options.some((o) => o.label.trim() === query.trim());

  const totalRows = options.length + (canCreate ? 1 : 0);

  React.useEffect(() => setHighlighted(0), [totalRows]);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const select = (index: number) => {
    if (canCreate && index === options.length) {
      onChange(null, query.trim(), true);
    } else {
      const option = options[index];
      if (!option) return;
      onChange(option.id, option.label, false);
    }
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); setQuery(''); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted((h) => (h + 1) % Math.max(totalRows, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted((h) => (h - 1 + totalRows) % Math.max(totalRows, 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); select(highlighted); }
  };

  return (
    <div ref={containerRef} className="relative">
      {!open ? (
        <button
          type="button"
          id={id}
          disabled={disabled}
          onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
          aria-invalid={invalid || undefined}
          className={cn(
            'flex h-input w-full items-center gap-2 rounded border bg-surface px-3 text-start text-sm transition',
            'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25',
            'disabled:cursor-not-allowed disabled:bg-surface-sunken',
            invalid ? 'border-danger' : 'border-border',
          )}
        >
          <span className={cn('min-w-0 flex-1 truncate', !valueLabel && 'text-content-subtle')}>
            {valueLabel || placeholder}
          </span>
          {valueLabel && !disabled ? (
            <span
              role="button"
              tabIndex={0}
              aria-label="حذف انتخاب"
              onClick={(e) => { e.stopPropagation(); onChange(null, null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onChange(null, null); }
              }}
              className="shrink-0 rounded p-0.5 text-content-subtle hover:text-danger"
            >
              <X className="size-3.5" />
            </span>
          ) : null}
          <ChevronDown className="size-4 shrink-0 text-content-subtle" aria-hidden />
        </button>
      ) : (
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          role="combobox"
          aria-expanded
          aria-autocomplete="list"
          className={cn(
            'h-input w-full rounded border border-primary bg-surface px-3 text-sm',
            'outline-none ring-2 ring-primary/25',
          )}
        />
      )}

      {open ? (
        <div
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-surface shadow-overlay animate-slide-up"
        >
          {isFetching && options.length === 0 ? (
            <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-content-muted">
              <Spinner className="size-3.5" /> در حال جستجو…
            </div>
          ) : null}

          {options.map((option, i) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.id === value}
              onClick={() => select(i)}
              onMouseEnter={() => setHighlighted(i)}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-start text-sm transition',
                highlighted === i ? 'bg-primary-soft' : 'hover:bg-surface-sunken',
              )}
            >
              <span className="min-w-0 flex-1 truncate text-content">{option.label}</span>
              {option.hint ? (
                <span className="shrink-0 text-2xs text-content-subtle">{option.hint}</span>
              ) : null}
              {option.id === value ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
            </button>
          ))}

          {canCreate ? (
            <button
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => select(options.length)}
              onMouseEnter={() => setHighlighted(options.length)}
              className={cn(
                'flex w-full items-center gap-2 border-t border-border px-3 py-2 text-start text-sm transition',
                highlighted === options.length ? 'bg-primary-soft' : 'hover:bg-surface-sunken',
              )}
            >
              <Plus className="size-3.5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate text-content">
                «{query.trim()}» — {createLabel}
              </span>
            </button>
          ) : null}

          {!isFetching && totalRows === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-content-muted">
              {debounced ? 'موردی یافت نشد.' : 'برای جستجو تایپ کنید.'}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
