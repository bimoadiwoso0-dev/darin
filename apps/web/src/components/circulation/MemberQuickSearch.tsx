import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScanLine, User } from 'lucide-react';
import { MEMBER_STATUS } from '@darin/shared';
import { api } from '@/lib/api';
import { Badge, Input, Spinner, cn } from '@/components/ui';
import { useDebounced } from '@/hooks/useUrlFilters';
import { formatDate, toPersianDigits } from '@/lib/format';

interface QuickMember {
  id: string;
  memberCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  mobile: string | null;
  status: string;
  expiresAt: string | null;
  activeLoans: number;
}

/**
 * جستجوی سریع عضو در میز امانت (قانون ۱۲۰).
 *
 * ── چرا انتخاب خودکار در تطابق قطعی ─────────────────────────────────────
 * وقتی کتابدار کارت عضویت را اسکن می‌کند، کد عضویت کامل و یکتا وارد
 * می‌شود و دقیقاً یک نتیجه برمی‌گردد. مجبور کردن او به کلیک یا زدن Enter
 * روی آن یک نتیجه، یک حرکت اضافه در کاری است که روزی صدها بار تکرار
 * می‌شود.
 *
 * تطابق قطعی یعنی: دقیقاً یک نتیجه و کد عضویت آن دقیقاً برابر با متن
 * واردشده. اگر کتابدار «احمدی» تایپ کند و یک احمدی وجود داشته باشد،
 * انتخاب خودکار نمی‌شود — چون تایپ نام هنوز ممکن است ادامه داشته باشد.
 */
export function MemberQuickSearch({
  onSelect, autoFocus, placeholder = 'کد عضویت، نام یا موبایل…',
}: {
  onSelect: (memberId: string, member: QuickMember) => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [query, setQuery] = React.useState('');
  const [highlighted, setHighlighted] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const debounced = useDebounced(query.trim(), 250);

  const { data: results, isFetching } = useQuery({
    queryKey: ['members', 'quick-search', debounced],
    queryFn: () => api.get<QuickMember[]>('/members/search', { q: debounced, limit: 8 }),
    enabled: debounced.length >= 2,
    staleTime: 15_000,
  });

  React.useEffect(() => setHighlighted(0), [results]);

  // انتخاب خودکار وقتی کارت اسکن شده و تطابق قطعی است
  React.useEffect(() => {
    if (!results || results.length !== 1) return;
    const only = results[0];
    if (!only) return;
    if (only.memberCode.toLowerCase() !== debounced.toLowerCase()) return;
    onSelect(only.id, only);
    setQuery('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, debounced]);

  const choose = (member: QuickMember) => {
    onSelect(member.id, member);
    setQuery('');
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!results || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((h) => (h - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = results[highlighted];
      if (target) choose(target);
    } else if (e.key === 'Escape') {
      setQuery('');
    }
  };

  return (
    <div className="space-y-2">
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        autoComplete="off"
        placeholder={placeholder}
        aria-label="جستجوی عضو"
        prefixIcon={<ScanLine className="size-4" />}
        suffix={isFetching ? <Spinner className="size-3.5" /> : undefined}
      />

      {debounced.length >= 2 ? (
        results && results.length > 0 ? (
          <ul className="divide-y divide-border rounded border border-border" role="listbox">
            {results.map((member, index) => (
              <li key={member.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === highlighted}
                  onClick={() => choose(member)}
                  onMouseEnter={() => setHighlighted(index)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2.5 text-start transition',
                    index === highlighted ? 'bg-primary-soft' : 'hover:bg-surface-sunken',
                  )}
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-content-subtle">
                    <User className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-content">{member.fullName}</p>
                    <p className="field-ltr truncate text-xs text-content-muted">
                      {member.memberCode}
                      {member.mobile ? ` · ${member.mobile}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={member.status === 'ACTIVE' ? 'success' : 'danger'}>
                      {MEMBER_STATUS[member.status as keyof typeof MEMBER_STATUS] ?? member.status}
                    </Badge>
                    <span className="text-2xs text-content-subtle">
                      {toPersianDigits(member.activeLoans)} امانت جاری
                      {member.expiresAt ? ` · تا ${formatDate(member.expiresAt)}` : ''}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : !isFetching ? (
          <p className="rounded border border-border px-3 py-4 text-center text-sm text-content-muted">
            عضوی با «{query}» یافت نشد.
          </p>
        ) : null
      ) : (
        <p className="text-xs text-content-subtle">
          کارت عضویت را اسکن کنید یا حداقل دو حرف از نام را تایپ کنید.
        </p>
      )}
    </div>
  );
}
