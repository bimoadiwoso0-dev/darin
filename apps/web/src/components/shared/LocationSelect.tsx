import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, MapPin, X } from 'lucide-react';
import { LOCATION_KIND, persianNormalize, type LocationKind } from '@darin/shared';
import { api } from '@/lib/api';
import { Spinner, cn } from '@/components/ui';
import { toPersianDigits } from '@/lib/format';

export interface FlatLocation {
  id: string;
  name: string;
  fullCode: string;
  kind: string;
  depth: number;
  capacity: number | null;
}

/**
 * انتخاب مکان از درخت قفسه‌ها.
 *
 * ── چرا فهرست کامل و نه جستجوی سرور ─────────────────────────────────────
 * تعداد مکان‌ها (ساختمان تا طبقه قفسه) حتی در کتابخانه بزرگ چند هزار
 * رکورد است و یک بار گرفتنش ارزان‌تر از ده‌ها درخواست جستجوست. فیلتر
 * محلی با نرمال‌سازی فارسی انجام می‌شود تا «قفسه ۳» و «قفسه۳» هر دو
 * پیدا شوند.
 *
 * ── چرا تورفتگی ──────────────────────────────────────────────────────────
 * «قفسه ۳» بدون بافت بی‌معناست؛ کتابدار باید ببیند زیر کدام بخش و کدام
 * طبقه است. تورفتگی این سلسله‌مراتب را بدون اشغال فضا نشان می‌دهد.
 */
export function LocationSelect({
  value, onChange, kinds, placeholder = 'انتخاب مکان…', disabled, invalid, id, allowClear = true,
}: {
  value: string | null;
  onChange: (id: string | null, location: FlatLocation | null) => void;
  /** محدود کردن به نوع خاص — مثلاً فقط قفسه و طبقه قفسه */
  kinds?: LocationKind[];
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  allowClear?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [highlighted, setHighlighted] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const { data: locations, isLoading } = useQuery({
    queryKey: ['locations', 'flat', kinds?.join(',') ?? 'all'],
    queryFn: () => api.get<FlatLocation[]>('/locations/flat', { kinds: kinds?.join(',') }),
    staleTime: 5 * 60_000,
  });

  const selected = locations?.find((l) => l.id === value) ?? null;

  const filtered = React.useMemo(() => {
    if (!locations) return [];
    const normalized = persianNormalize(query);
    if (!normalized) return locations;
    return locations.filter(
      (l) =>
        persianNormalize(l.name).includes(normalized) ||
        l.fullCode.toLowerCase().includes(query.trim().toLowerCase()),
    );
  }, [locations, query]);

  React.useEffect(() => setHighlighted(0), [filtered.length]);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) { setOpen(false); setQuery(''); }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const select = (location: FlatLocation) => {
    onChange(location.id, location);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); setQuery(''); return; }
    if (filtered.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlighted((h) => (h + 1) % filtered.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted((h) => (h - 1 + filtered.length) % filtered.length); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filtered[highlighted];
      if (target) select(target);
    }
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
          <MapPin className="size-4 shrink-0 text-content-subtle" aria-hidden />
          <span className={cn('min-w-0 flex-1 truncate', !selected && 'text-content-subtle')}>
            {selected ? (
              <>
                {selected.name}
                <span className="ms-1.5 font-mono text-2xs text-content-subtle" dir="ltr">
                  {selected.fullCode}
                </span>
              </>
            ) : (
              placeholder
            )}
          </span>
          {selected && allowClear && !disabled ? (
            <span
              role="button"
              tabIndex={0}
              aria-label="حذف مکان انتخاب‌شده"
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
          placeholder="نام یا کد مکان…"
          aria-label="جستجوی مکان"
          className="h-input w-full rounded border border-primary bg-surface px-3 text-sm outline-none ring-2 ring-primary/25"
        />
      )}

      {open ? (
        <div
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-surface shadow-overlay animate-slide-up"
        >
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-content-muted">
              <Spinner className="size-3.5" /> در حال بارگذاری مکان‌ها…
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-content-muted">
              مکانی با این نام یافت نشد.
            </p>
          ) : (
            filtered.map((location, i) => (
              <button
                key={location.id}
                type="button"
                role="option"
                aria-selected={location.id === value}
                onClick={() => select(location)}
                onMouseEnter={() => setHighlighted(i)}
                className={cn(
                  'flex w-full items-center gap-2 py-1.5 pe-3 text-start text-sm transition',
                  highlighted === i ? 'bg-primary-soft' : 'hover:bg-surface-sunken',
                )}
                // تورفتگی بر اساس عمق در درخت — بافت مکان را نشان می‌دهد
                style={{ paddingInlineStart: `${0.75 + location.depth * 0.85}rem` }}
              >
                <span className="min-w-0 flex-1 truncate text-content">{location.name}</span>
                <span className="shrink-0 text-2xs text-content-subtle">
                  {LOCATION_KIND[location.kind as keyof typeof LOCATION_KIND] ?? location.kind}
                  {location.capacity ? ` · ظرفیت ${toPersianDigits(location.capacity)}` : ''}
                </span>
                <span className="shrink-0 font-mono text-2xs text-content-subtle" dir="ltr">
                  {location.fullCode}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
