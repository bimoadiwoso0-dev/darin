import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { Th, cn } from '@/components/ui';

/**
 * سرستون مرتب‌شونده.
 * کلیک روی ستون فعلی جهت را برعکس می‌کند؛ کلیک روی ستون دیگر با ترتیب
 * پیش‌فرض همان ستون شروع می‌کند (متن صعودی، عدد و تاریخ نزولی).
 */
export function SortableHeader<TKey extends string>({
  column, label, sort, order, onSort, numeric, defaultOrder = 'asc', className,
}: {
  column: TKey;
  label: string;
  sort: string;
  order: 'asc' | 'desc';
  onSort: (column: TKey, order: 'asc' | 'desc') => void;
  numeric?: boolean;
  defaultOrder?: 'asc' | 'desc';
  className?: string;
}) {
  const active = sort === column;
  const Icon = !active ? ChevronsUpDown : order === 'asc' ? ArrowUp : ArrowDown;

  return (
    <Th numeric={numeric} className={cn('p-0', className)}>
      <button
        type="button"
        onClick={() => onSort(column, active ? (order === 'asc' ? 'desc' : 'asc') : defaultOrder)}
        aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={cn(
          'flex w-full items-center gap-1 px-4 py-2.5 transition hover:text-content',
          numeric ? 'justify-end' : 'justify-start',
          active && 'text-content',
        )}
      >
        {label}
        <Icon className={cn('size-3', active ? 'text-primary' : 'text-content-subtle')} />
      </button>
    </Th>
  );
}
