import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Book, Boxes, MapPin, Search, User } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, Badge, Spinner } from '@/components/ui';
import { formatIdentifier } from '@/lib/format';
import { COPY_STATUS, MEMBER_STATUS } from '@darin/shared';

interface GlobalResult {
  books: Array<{
    id: string; title: string; authors: string[]; publicationYear: number | null;
    totalCopies: number; availableCopies: number; sampleLocation: string | null;
  }>;
  members: Array<{
    id: string; memberCode: string; fullName: string; mobile: string | null;
    status: string; activeLoans: number;
  }>;
  copies: Array<{
    id: string; barcode: string; accessionNumber: string; status: string;
    bookTitle: string; locationCode: string | null;
  }>;
  locations: Array<{ id: string; name: string; fullCode: string; kind: string }>;
  totalBooks: number;
}

/**
 * جستجوی سراسری Header (قوانین ۴۴، ۱۰۶).
 *
 * ── چرا یک کادر برای همه‌چیز ─────────────────────────────────────────────
 * کتابدار وقتی چیزی در دست دارد، نمی‌خواهد اول تصمیم بگیرد «این بارکد
 * است یا شماره ثبت یا کد عضویت». یک کادر می‌گیرد و سیستم تشخیص می‌دهد.
 *
 * ── ناوبری کامل با صفحه‌کلید ────────────────────────────────────────────
 * جهت‌های بالا/پایین بین نتایج، Enter برای انتخاب، Esc برای بستن.
 * کتابدار اصلاً لازم نیست دست از صفحه‌کلید بردارد.
 */
export function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // تأخیر ۲۰۰ms — هر ضربه کلید یک درخواست نمی‌فرستد
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isFetching } = useQuery({
    queryKey: ['search', 'global', debounced],
    queryFn: () => api.get<GlobalResult>('/search/global', { q: debounced, limit: 5 }),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });

  /** همه نتایج در یک فهرست تخت — برای ناوبری با کلید جهت. */
  const flatResults = React.useMemo(() => {
    if (!data) return [];
    return [
      ...data.books.map((b) => ({ type: 'book' as const, id: b.id, item: b })),
      ...data.copies.map((c) => ({ type: 'copy' as const, id: c.id, item: c })),
      ...data.members.map((m) => ({ type: 'member' as const, id: m.id, item: m })),
      ...data.locations.map((l) => ({ type: 'location' as const, id: l.id, item: l })),
    ];
  }, [data]);

  React.useEffect(() => setHighlighted(0), [flatResults.length]);

  const go = React.useCallback(
    (result: (typeof flatResults)[number]) => {
      const paths = {
        book: `/books/${result.id}`,
        copy: `/copies/${result.id}`,
        member: `/members/${result.id}`,
        location: `/locations/${result.id}`,
      };
      navigate(paths[result.type]);
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    },
    [navigate],
  );

  // میان‌بر F2 برای پرش به جستجو (قانون ۴۶)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2' || ((e.ctrlKey || e.metaKey) && e.key === 'k')) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // بستن با کلیک بیرون
  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (flatResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % flatResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => (h - 1 + flatResults.length) % flatResults.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = flatResults[highlighted];
      if (target) go(target);
    }
  };

  const showPanel = open && debounced.length >= 2;

  return (
    <div ref={containerRef} className="relative w-full max-w-xl">
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute start-3 size-4 text-content-subtle" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="جستجوی کتاب، عضو، بارکد یا قفسه…"
          aria-label="جستجوی سراسری"
          aria-expanded={showPanel}
          aria-controls="global-search-results"
          role="combobox"
          aria-autocomplete="list"
          className={cn(
            'h-input w-full rounded border border-border bg-surface-sunken ps-9 pe-16 text-sm',
            'placeholder:text-content-subtle',
            'focus:border-primary focus:bg-surface focus:outline-none focus:ring-2 focus:ring-primary/20',
          )}
        />
        <div className="absolute end-3 flex items-center gap-1.5">
          {isFetching ? <Spinner className="size-3.5" /> : null}
          <kbd className="hidden rounded border border-border bg-surface px-1.5 py-0.5 text-2xs text-content-subtle sm:inline-block">
            F2
          </kbd>
        </div>
      </div>

      {showPanel ? (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-surface shadow-overlay animate-slide-up"
        >
          {flatResults.length === 0 && !isFetching ? (
            <p className="px-4 py-6 text-center text-sm text-content-muted">
              نتیجه‌ای برای «{query}» یافت نشد.
            </p>
          ) : null}

          {data?.books.length ? (
            <Section title="کتاب‌ها" count={data.totalBooks}>
              {data.books.map((book, i) => (
                <ResultRow
                  key={book.id}
                  active={flatResults[highlighted]?.id === book.id}
                  onSelect={() => go({ type: 'book', id: book.id, item: book })}
                  icon={<Book className="size-4 text-content-subtle" />}
                  title={book.title}
                  subtitle={book.authors.join('، ') || 'بدون پدیدآورنده'}
                  meta={
                    <Badge tone={book.availableCopies > 0 ? 'success' : 'warning'}>
                      {book.availableCopies > 0
                        ? `${book.availableCopies} موجود`
                        : 'ناموجود'}
                    </Badge>
                  }
                  index={i}
                />
              ))}
            </Section>
          ) : null}

          {data?.copies.length ? (
            <Section title="نسخه‌های فیزیکی">
              {data.copies.map((copy) => (
                <ResultRow
                  key={copy.id}
                  active={flatResults[highlighted]?.id === copy.id}
                  onSelect={() => go({ type: 'copy', id: copy.id, item: copy })}
                  icon={<Boxes className="size-4 text-content-subtle" />}
                  title={copy.bookTitle}
                  subtitle={`بارکد ${formatIdentifier(copy.barcode)} · ثبت ${formatIdentifier(copy.accessionNumber)}`}
                  meta={
                    <Badge tone={copy.status === 'AVAILABLE' ? 'success' : 'neutral'}>
                      {COPY_STATUS[copy.status as keyof typeof COPY_STATUS] ?? copy.status}
                    </Badge>
                  }
                />
              ))}
            </Section>
          ) : null}

          {data?.members.length ? (
            <Section title="اعضا">
              {data.members.map((member) => (
                <ResultRow
                  key={member.id}
                  active={flatResults[highlighted]?.id === member.id}
                  onSelect={() => go({ type: 'member', id: member.id, item: member })}
                  icon={<User className="size-4 text-content-subtle" />}
                  title={member.fullName}
                  subtitle={`${member.memberCode}${member.mobile ? ` · ${member.mobile}` : ''}`}
                  meta={
                    <Badge tone={member.status === 'ACTIVE' ? 'success' : 'warning'}>
                      {MEMBER_STATUS[member.status as keyof typeof MEMBER_STATUS] ?? member.status}
                    </Badge>
                  }
                />
              ))}
            </Section>
          ) : null}

          {data?.locations.length ? (
            <Section title="مکان‌ها">
              {data.locations.map((location) => (
                <ResultRow
                  key={location.id}
                  active={flatResults[highlighted]?.id === location.id}
                  onSelect={() => go({ type: 'location', id: location.id, item: location })}
                  icon={<MapPin className="size-4 text-content-subtle" />}
                  title={location.name}
                  subtitle={location.fullCode}
                />
              ))}
            </Section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Section({
  title, count, children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border last:border-b-0">
      <div className="flex items-center justify-between px-3 py-1.5">
        <p className="text-2xs font-semibold uppercase tracking-wide text-content-subtle">{title}</p>
        {count !== undefined && count > 0 ? (
          <span className="text-2xs text-content-subtle">
            {new Intl.NumberFormat('fa-IR').format(count)} نتیجه
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function ResultRow({
  active, onSelect, icon, title, subtitle, meta,
}: {
  active: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  meta?: React.ReactNode;
  index?: number;
}) {
  const ref = React.useRef<HTMLButtonElement>(null);

  // نتیجه فعال همیشه در دید بماند هنگام ناوبری با کلید
  React.useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <button
      ref={ref}
      type="button"
      role="option"
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 px-3 py-2 text-start transition',
        active ? 'bg-primary-soft' : 'hover:bg-surface-sunken',
      )}
    >
      {icon}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-content">{title}</p>
        {subtitle ? (
          <p className="truncate text-xs text-content-muted">{subtitle}</p>
        ) : null}
      </div>
      {meta}
    </button>
  );
}
