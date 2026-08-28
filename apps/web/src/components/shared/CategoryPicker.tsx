import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronLeft, FolderTree, X } from 'lucide-react';
import { persianNormalize } from '@darin/shared';
import { api } from '@/lib/api';
import { Badge, Spinner, cn } from '@/components/ui';
import { toPersianDigits } from '@/lib/format';

export interface CategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  code: string | null;
  kind: 'SUBJECT' | 'GENRE';
  depth: number;
  colorHex: string | null;
  bookCount: number;
  children: CategoryNode[];
}

/**
 * انتخاب موضوع از درخت دسته‌بندی (قانون ۲۹).
 *
 * ── چند موضوع، یکی اصلی ─────────────────────────────────────────────────
 * یک کتاب می‌تواند هم‌زمان زیر «ادبیات فارسی» و «شعر کلاسیک» باشد، اما
 * برای رده‌بندی قفسه و گزارش‌ها یکی باید «اصلی» باشد. اولین انتخاب خودکار
 * اصلی می‌شود و کاربر می‌تواند تغییرش دهد.
 *
 * ── چرا درخت و نه فهرست تخت ─────────────────────────────────────────────
 * «غزل» بدون دیدن اینکه زیر «شعر» و آن زیر «ادبیات» است، ابهام دارد.
 */
export function CategoryPicker({
  value, primaryId, onChange, onPrimaryChange, invalid,
}: {
  value: string[];
  primaryId: string | null;
  onChange: (ids: string[]) => void;
  onPrimaryChange: (id: string | null) => void;
  invalid?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const containerRef = React.useRef<HTMLDivElement>(null);

  const { data: tree, isLoading } = useQuery({
    queryKey: ['categories', 'tree'],
    queryFn: () => api.get<CategoryNode[]>('/categories'),
    staleTime: 5 * 60_000,
  });

  /** نگاشت شناسه → گره، برای نمایش نام دسته‌های انتخاب‌شده. */
  const byId = React.useMemo(() => {
    const map = new Map<string, CategoryNode>();
    const walk = (nodes: CategoryNode[]) => {
      for (const node of nodes) { map.set(node.id, node); walk(node.children); }
    };
    walk(tree ?? []);
    return map;
  }, [tree]);

  /**
   * هنگام جستجو، درخت به یک فهرست تخت از تطابق‌ها تبدیل می‌شود.
   * جستجوی درختی که فقط شاخه‌ها را باز کند، کاربر را مجبور می‌کند دنبال
   * نتیجه بگردد.
   */
  const matches = React.useMemo(() => {
    const normalized = persianNormalize(query);
    if (!normalized) return null;
    const found: CategoryNode[] = [];
    const walk = (nodes: CategoryNode[]) => {
      for (const node of nodes) {
        if (persianNormalize(node.name).includes(normalized)) found.push(node);
        walk(node.children);
      }
    };
    walk(tree ?? []);
    return found.slice(0, 40);
  }, [tree, query]);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const toggle = (id: string) => {
    if (value.includes(id)) {
      const next = value.filter((v) => v !== id);
      onChange(next);
      // اگر موضوع اصلی حذف شد، اولین موضوع باقی‌مانده جایش را می‌گیرد
      if (primaryId === id) onPrimaryChange(next[0] ?? null);
    } else {
      onChange([...value, id]);
      if (!primaryId) onPrimaryChange(id);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div
        className={cn(
          'min-h-input w-full rounded border bg-surface p-1.5',
          invalid ? 'border-danger' : 'border-border',
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {value.map((id) => {
            const node = byId.get(id);
            return (
              <Badge key={id} tone={id === primaryId ? 'primary' : 'neutral'}>
                <button
                  type="button"
                  onClick={() => onPrimaryChange(id)}
                  title={id === primaryId ? 'موضوع اصلی' : 'تعیین به‌عنوان موضوع اصلی'}
                  className="max-w-[10rem] truncate"
                >
                  {node?.name ?? '…'}
                </button>
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  aria-label={`حذف ${node?.name ?? 'موضوع'}`}
                  className="rounded hover:text-danger"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            );
          })}

          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="flex flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-start text-sm text-content-subtle hover:bg-surface-sunken"
          >
            <FolderTree className="size-4" aria-hidden />
            {value.length === 0 ? 'انتخاب موضوع…' : 'افزودن موضوع'}
            <ChevronDown className="ms-auto size-4" aria-hidden />
          </button>
        </div>
      </div>

      {value.length > 1 ? (
        <p className="mt-1 text-2xs text-content-subtle">
          روی نام هر موضوع کلیک کنید تا موضوع اصلی شود (موضوع اصلی پررنگ است).
        </p>
      ) : null}

      {open ? (
        <div className="absolute inset-x-0 top-full z-50 mt-1 rounded-lg border border-border bg-surface shadow-overlay animate-slide-up">
          <div className="border-b border-border p-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="جستجوی موضوع…"
              aria-label="جستجوی موضوع"
              autoFocus
              className="h-8 w-full rounded border border-border bg-surface-sunken px-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <div className="max-h-64 overflow-y-auto p-1">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 py-4 text-xs text-content-muted">
                <Spinner className="size-3.5" /> در حال بارگذاری…
              </div>
            ) : matches ? (
              matches.length > 0 ? (
                matches.map((node) => (
                  <CategoryRow
                    key={node.id}
                    node={node}
                    depth={0}
                    selected={value.includes(node.id)}
                    onToggle={toggle}
                  />
                ))
              ) : (
                <p className="py-4 text-center text-xs text-content-muted">موضوعی یافت نشد.</p>
              )
            ) : (tree ?? []).length > 0 ? (
              (tree ?? []).map((node) => (
                <CategoryBranch
                  key={node.id}
                  node={node}
                  depth={0}
                  value={value}
                  expanded={expanded}
                  onToggleExpand={(id) =>
                    setExpanded((s) => {
                      const next = new Set(s);
                      if (next.has(id)) next.delete(id); else next.add(id);
                      return next;
                    })
                  }
                  onToggle={toggle}
                />
              ))
            ) : (
              <p className="py-4 text-center text-xs text-content-muted">
                هنوز دسته‌بندی تعریف نشده است.
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CategoryBranch({
  node, depth, value, expanded, onToggleExpand, onToggle,
}: {
  node: CategoryNode;
  depth: number;
  value: string[];
  expanded: Set<string>;
  onToggleExpand: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  const isOpen = expanded.has(node.id);
  return (
    <>
      <CategoryRow
        node={node}
        depth={depth}
        selected={value.includes(node.id)}
        onToggle={onToggle}
        expandable={node.children.length > 0}
        expanded={isOpen}
        onToggleExpand={() => onToggleExpand(node.id)}
      />
      {isOpen
        ? node.children.map((child) => (
            <CategoryBranch
              key={child.id}
              node={child}
              depth={depth + 1}
              value={value}
              expanded={expanded}
              onToggleExpand={onToggleExpand}
              onToggle={onToggle}
            />
          ))
        : null}
    </>
  );
}

function CategoryRow({
  node, depth, selected, onToggle, expandable, expanded, onToggleExpand,
}: {
  node: CategoryNode;
  depth: number;
  selected: boolean;
  onToggle: (id: string) => void;
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  return (
    <div
      className="flex items-center gap-1 rounded hover:bg-surface-sunken"
      style={{ paddingInlineStart: `${depth * 0.9}rem` }}
    >
      {expandable ? (
        <button
          type="button"
          onClick={onToggleExpand}
          aria-label={expanded ? 'بستن زیرشاخه' : 'باز کردن زیرشاخه'}
          aria-expanded={expanded}
          className="rounded p-1 text-content-subtle hover:text-content"
        >
          <ChevronLeft className={cn('size-3.5 transition', expanded && '-rotate-90')} />
        </button>
      ) : (
        <span className="w-6" aria-hidden />
      )}

      <label className="flex flex-1 cursor-pointer items-center gap-2 py-1.5 pe-2 text-sm">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(node.id)}
          className="size-4 rounded border-border-strong text-primary focus:ring-primary/30"
        />
        <span className="min-w-0 flex-1 truncate text-content">{node.name}</span>
        <span className="shrink-0 text-2xs text-content-subtle">
          {toPersianDigits(node.bookCount)}
        </span>
      </label>
    </div>
  );
}
