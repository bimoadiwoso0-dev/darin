import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2, ChevronLeft, LayoutGrid, ListTree, MapPin, Plus, Printer, Trash2,
} from 'lucide-react';
import { LOCATION_KIND, persianNormalize } from '@darin/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, Input,
  Modal, Select, Skeleton, cn,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { ShelfLabelModal } from '@/components/locations/ShelfLabelModal';
import { formatNumber, formatPercent, toPersianDigits } from '@/lib/format';

interface LocationNode {
  id: string; parentId: string | null; kind: string; name: string; code: string;
  fullCode: string; depth: number; capacity: number | null; sortOrder: number;
  qrToken: string; copyCount: number; children: LocationNode[];
}

interface ShelfOccupancy {
  id: string; name: string; fullCode: string; kind: string;
  capacity: number | null; occupied: number; available: number | null;
  utilization: number | null;
}

/**
 * قفسه‌ها و مکان‌ها (قوانین ۱۰، ۲۹، ۸۳).
 *
 * ── دو نمای یک داده ──────────────────────────────────────────────────────
 * «درخت» برای دیدن ساختار و ویرایش آن است؛ «نقشه اشغال» برای پاسخ به
 * سؤالی که کتابدار هنگام قفسه‌چینی دارد: «کجا جا هست؟». همان داده با دو
 * پرسش متفاوت.
 *
 * ── رنگ‌بندی پرشدگی ─────────────────────────────────────────────────────
 * سبز زیر ۷۰٪، کهربایی تا ۹۰٪ و قرمز بالای آن. عدد درصد هم کنارش نوشته
 * می‌شود — تکیه بر رنگ به‌تنهایی برای کاربر نابینای رنگ کار نمی‌کند.
 */
export function LocationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();

  const [view, setView] = React.useState<'tree' | 'occupancy'>('tree');
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [search, setSearch] = React.useState('');
  const [createParent, setCreateParent] = React.useState<LocationNode | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [labelTarget, setLabelTarget] = React.useState<LocationNode | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<LocationNode | null>(null);

  const [form, setForm] = React.useState({ kind: 'SHELF', name: '', code: '', capacity: '' });

  const { data: tree, isLoading } = useQuery({
    queryKey: ['locations', 'tree'],
    queryFn: () => api.get<LocationNode[]>('/locations'),
  });

  const { data: occupancy, isLoading: occupancyLoading } = useQuery({
    queryKey: ['locations', 'occupancy'],
    queryFn: () => api.get<ShelfOccupancy[]>('/locations/occupancy'),
    enabled: view === 'occupancy',
  });

  // ریشه‌ها همیشه باز باشند تا صفحه خالی به نظر نرسد
  React.useEffect(() => {
    if (!tree) return;
    setExpanded((current) => {
      if (current.size > 0) return current;
      const next = new Set<string>();
      for (const root of tree) {
        next.add(root.id);
        for (const child of root.children) next.add(child.id);
      }
      return next;
    });
  }, [tree]);

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/locations', {
        parentId: createParent?.id ?? null,
        kind: form.kind,
        name: form.name.trim(),
        code: form.code.trim(),
        capacity: form.capacity ? Number(form.capacity) : null,
      }),
    onSuccess: () => {
      toast.success('مکان افزوده شد');
      setCreateOpen(false);
      setForm({ kind: 'SHELF', name: '', code: '', capacity: '' });
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
    },
    onError: (error) => toast.apiError(error, 'افزودن مکان انجام نشد'),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/locations/${deleteTarget?.id}`),
    onSuccess: () => {
      toast.success('مکان حذف شد');
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['locations'] });
    },
    onError: (error) => toast.apiError(error, 'حذف مکان انجام نشد'),
  });

  const openCreate = (parent: LocationNode | null) => {
    setCreateParent(parent);
    // نوع پیش‌فرض یک پله پایین‌تر از والد پیشنهاد می‌شود
    setForm({ kind: suggestChildKind(parent?.kind), name: '', code: '', capacity: '' });
    setCreateOpen(true);
  };

  /** جستجو درخت را تخت می‌کند — گشتن در شاخه‌ها هنگام جستجو کند است. */
  const searchResults = React.useMemo(() => {
    const normalized = persianNormalize(search);
    if (!normalized && !search.trim()) return null;
    const found: LocationNode[] = [];
    const walk = (nodes: LocationNode[]) => {
      for (const node of nodes) {
        if (
          persianNormalize(node.name).includes(normalized) ||
          node.fullCode.toLowerCase().includes(search.trim().toLowerCase())
        ) {
          found.push(node);
        }
        walk(node.children);
      }
    };
    walk(tree ?? []);
    return found;
  }, [tree, search]);

  /*
   * `copyCount` هر گره از سمت سرور **تجمعی** است (شامل همه نوادگان).
   * پس جمع کل فقط جمع ریشه‌هاست؛ جمع زدن همه گره‌ها هر نسخه را به تعداد
   * عمقش چند بار می‌شمرد.
   */
  const totalCopies = React.useMemo(
    () => (tree ?? []).reduce((sum, root) => sum + root.copyCount, 0),
    [tree],
  );

  return (
    <>
      <PageHeader
        title="قفسه‌ها و مکان‌ها"
        description={
          tree ? `${formatNumber(totalCopies)} نسخه در ${formatNumber(countNodes(tree))} مکان` : undefined
        }
        actions={
          <>
            <div className="flex rounded border border-border bg-surface p-0.5">
              <button
                type="button"
                onClick={() => setView('tree')}
                className={cn(
                  'flex items-center gap-1.5 rounded px-3 py-1.5 text-xs transition',
                  view === 'tree'
                    ? 'bg-primary text-primary-content'
                    : 'text-content-muted hover:bg-surface-sunken',
                )}
              >
                <ListTree className="size-3.5" /> درخت
              </button>
              <button
                type="button"
                onClick={() => setView('occupancy')}
                className={cn(
                  'flex items-center gap-1.5 rounded px-3 py-1.5 text-xs transition',
                  view === 'occupancy'
                    ? 'bg-primary text-primary-content'
                    : 'text-content-muted hover:bg-surface-sunken',
                )}
              >
                <LayoutGrid className="size-3.5" /> نقشه اشغال
              </button>
            </div>
            {can('locations.manage') ? (
              <Button variant="primary" onClick={() => openCreate(null)} icon={<Plus className="size-4" />}>
                افزودن مکان
              </Button>
            ) : null}
          </>
        }
      />

      {view === 'tree' ? (
        <Card>
          <div className="border-b border-border p-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="نام یا کد مکان…"
              aria-label="جستجوی مکان"
              prefixIcon={<MapPin className="size-4" />}
            />
          </div>

          {isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-9" />)}
            </div>
          ) : searchResults ? (
            searchResults.length > 0 ? (
              <ul className="divide-y divide-border">
                {searchResults.map((node) => (
                  <li key={node.id}>
                    <LocationRow
                      node={node}
                      depth={0}
                      expandable={false}
                      onNavigate={() => navigate(`/locations/${node.id}`)}
                      onAddChild={can('locations.manage') ? () => openCreate(node) : undefined}
                      onPrintLabel={can('labels.print') ? () => setLabelTarget(node) : undefined}
                      onDelete={can('locations.manage') ? () => setDeleteTarget(node) : undefined}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="مکانی با این نام یافت نشد" />
            )
          ) : (tree ?? []).length > 0 ? (
            <ul>
              {(tree ?? []).map((root) => (
                <LocationBranch
                  key={root.id}
                  node={root}
                  depth={0}
                  expanded={expanded}
                  onToggle={(nodeId) =>
                    setExpanded((s) => {
                      const next = new Set(s);
                      if (next.has(nodeId)) next.delete(nodeId);
                      else next.add(nodeId);
                      return next;
                    })
                  }
                  onNavigate={(nodeId) => navigate(`/locations/${nodeId}`)}
                  onAddChild={can('locations.manage') ? openCreate : undefined}
                  onPrintLabel={can('labels.print') ? setLabelTarget : undefined}
                  onDelete={can('locations.manage') ? setDeleteTarget : undefined}
                />
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={<Building2 className="size-6" />}
              title="هنوز مکانی تعریف نشده"
              description="ساختار کتابخانه را بسازید: ساختمان ← طبقه ← بخش ← قفسه ← طبقه قفسه."
              action={
                can('locations.manage') ? (
                  <Button variant="primary" onClick={() => openCreate(null)}>
                    افزودن اولین مکان
                  </Button>
                ) : null
              }
            />
          )}
        </Card>
      ) : (
        <Card>
          <CardHeader
            title="نقشه اشغال قفسه‌ها"
            description="برای یافتن جای خالی هنگام قفسه‌چینی"
          />
          {occupancyLoading ? (
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-24" />)}
            </div>
          ) : occupancy && occupancy.length > 0 ? (
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {occupancy.map((shelf) => (
                <Link
                  key={shelf.id}
                  to={`/locations/${shelf.id}`}
                  className="rounded-lg border border-border bg-surface p-3 transition hover:border-border-strong hover:shadow-raised"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-content">{shelf.name}</p>
                      <p className="font-mono text-2xs text-content-subtle" dir="ltr">
                        {shelf.fullCode}
                      </p>
                    </div>
                    <Badge tone="neutral">
                      {LOCATION_KIND[shelf.kind as keyof typeof LOCATION_KIND] ?? shelf.kind}
                    </Badge>
                  </div>

                  {shelf.capacity !== null ? (
                    <>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-sunken">
                        <div
                          className={cn('h-full rounded-full transition-all', utilizationColor(shelf.utilization))}
                          style={{ width: `${Math.min(100, shelf.utilization ?? 0)}%` }}
                        />
                      </div>
                      <p className="mt-1.5 flex items-baseline justify-between text-xs">
                        <span className="text-content-muted">
                          {toPersianDigits(shelf.occupied)} از {toPersianDigits(shelf.capacity)}
                        </span>
                        <span className={cn('font-medium', utilizationTextColor(shelf.utilization))}>
                          {formatPercent(shelf.utilization)}
                        </span>
                      </p>
                      <p className="mt-0.5 text-2xs text-content-subtle">
                        {shelf.available && shelf.available > 0
                          ? `${toPersianDigits(shelf.available)} جای خالی`
                          : 'پر است'}
                      </p>
                    </>
                  ) : (
                    <p className="mt-3 text-xs text-content-muted">
                      {toPersianDigits(shelf.occupied)} نسخه — ظرفیت تعریف نشده
                    </p>
                  )}
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<LayoutGrid className="size-6" />}
              title="قفسه‌ای با ظرفیت تعریف‌شده وجود ندارد"
              description="برای هر قفسه ظرفیت تعیین کنید تا نقشه اشغال معنا پیدا کند."
            />
          )}
        </Card>
      )}

      {/* ── افزودن مکان ────────────────────────────────────────────── */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="افزودن مکان"
        description={
          createParent
            ? `زیرمجموعه «${createParent.name}» (${createParent.fullCode})`
            : 'مکان ریشه — معمولاً یک ساختمان'
        }
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>انصراف</Button>
            <Button
              variant="primary"
              onClick={() => create.mutate()}
              loading={create.isPending}
              disabled={!form.name.trim() || !form.code.trim()}
            >
              افزودن
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="نوع مکان" required>
              <Select value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
                {Object.entries(LOCATION_KIND).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </Select>
            </Field>

            <Field
              label="کد"
              required
              hint="فقط حروف انگلیسی، عدد و زیرخط — در کد کامل مکان استفاده می‌شود."
            >
              <Input
                ltr value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder="S1"
              />
            </Field>
          </div>

          <Field label="نام" required>
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="قفسه ادبیات فارسی"
              autoFocus
            />
          </Field>

          <Field
            label="ظرفیت (تعداد نسخه)"
            hint="برای قفسه و طبقه قفسه پرش کنید تا نقشه اشغال کار کند."
          >
            <Input
              type="number" min={0} ltr value={form.capacity}
              onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
            />
          </Field>

          {form.code.trim() && createParent ? (
            <p className="rounded border border-border bg-surface-sunken px-3 py-2 text-xs text-content-muted">
              کد کامل این مکان:{' '}
              <span className="font-mono text-content" dir="ltr">
                {createParent.fullCode}-{form.code.trim()}
              </span>
            </p>
          ) : null}
        </div>
      </Modal>

      <ShelfLabelModal
        open={!!labelTarget}
        onClose={() => setLabelTarget(null)}
        locationId={labelTarget?.id ?? null}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title="حذف مکان"
        confirmLabel="حذف کن"
        message={
          <>
            <p>«{deleteTarget?.name}» حذف می‌شود.</p>
            {deleteTarget && deleteTarget.copyCount > 0 ? (
              <p className="mt-2 rounded border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-danger-content">
                این مکان {toPersianDigits(deleteTarget.copyCount)} نسخه دارد. ابتدا آنها را
                جابه‌جا کنید؛ سرور اجازه حذف مکان دارای نسخه را نمی‌دهد.
              </p>
            ) : null}
            {deleteTarget && deleteTarget.children.length > 0 ? (
              <p className="mt-2 rounded border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-danger-content">
                این مکان {toPersianDigits(deleteTarget.children.length)} زیرمجموعه دارد.
              </p>
            ) : null}
          </>
        }
      />
    </>
  );
}

function LocationBranch({
  node, depth, expanded, onToggle, onNavigate, onAddChild, onPrintLabel, onDelete,
}: {
  node: LocationNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  onNavigate: (id: string) => void;
  onAddChild?: (parent: LocationNode) => void;
  onPrintLabel?: (node: LocationNode) => void;
  onDelete?: (node: LocationNode) => void;
}) {
  const isOpen = expanded.has(node.id);
  return (
    <li>
      <LocationRow
        node={node}
        depth={depth}
        expandable={node.children.length > 0}
        expanded={isOpen}
        onToggleExpand={() => onToggle(node.id)}
        onNavigate={() => onNavigate(node.id)}
        onAddChild={onAddChild ? () => onAddChild(node) : undefined}
        onPrintLabel={onPrintLabel ? () => onPrintLabel(node) : undefined}
        onDelete={onDelete ? () => onDelete(node) : undefined}
      />
      {isOpen && node.children.length > 0 ? (
        <ul>
          {node.children.map((child) => (
            <LocationBranch
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onNavigate={onNavigate}
              onAddChild={onAddChild}
              onPrintLabel={onPrintLabel}
              onDelete={onDelete}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function LocationRow({
  node, depth, expandable, expanded, onToggleExpand, onNavigate,
  onAddChild, onPrintLabel, onDelete,
}: {
  node: LocationNode;
  depth: number;
  expandable: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onNavigate: () => void;
  onAddChild?: () => void;
  onPrintLabel?: () => void;
  onDelete?: () => void;
}) {
  const full = node.capacity !== null && node.copyCount >= node.capacity;

  return (
    <div
      className="group flex items-center gap-2 border-b border-border py-2 pe-3 transition hover:bg-surface-sunken"
      style={{ paddingInlineStart: `${0.75 + depth * 1.1}rem` }}
    >
      {expandable ? (
        <button
          type="button"
          onClick={onToggleExpand}
          aria-label={expanded ? 'بستن زیرمجموعه' : 'باز کردن زیرمجموعه'}
          aria-expanded={expanded}
          className="rounded p-1 text-content-subtle hover:text-content"
        >
          <ChevronLeft className={cn('size-4 transition', expanded && '-rotate-90')} />
        </button>
      ) : (
        <span className="w-6" aria-hidden />
      )}

      <button
        type="button"
        onClick={onNavigate}
        className="flex min-w-0 flex-1 items-center gap-2 text-start"
      >
        <span className="truncate text-sm text-content">{node.name}</span>
        <span className="shrink-0 font-mono text-2xs text-content-subtle" dir="ltr">
          {node.fullCode}
        </span>
      </button>

      <Badge tone="neutral">
        {LOCATION_KIND[node.kind as keyof typeof LOCATION_KIND] ?? node.kind}
      </Badge>

      {node.capacity !== null ? (
        <Badge tone={full ? 'danger' : 'success'}>
          {toPersianDigits(node.copyCount)} / {toPersianDigits(node.capacity)}
        </Badge>
      ) : node.copyCount > 0 ? (
        <Badge tone="neutral">{toPersianDigits(node.copyCount)} نسخه</Badge>
      ) : null}

      {/* عملیات فقط هنگام اشاره ماوس یا تمرکز صفحه‌کلید دیده می‌شوند تا
          فهرست شلوغ نشود، اما همیشه در دسترس صفحه‌خوان‌اند. */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
        {onAddChild ? (
          <Button
            variant="ghost" size="icon" onClick={onAddChild}
            aria-label={`افزودن زیرمجموعه به ${node.name}`}
            icon={<Plus className="size-3.5" />}
            className="size-7"
          />
        ) : null}
        {onPrintLabel ? (
          <Button
            variant="ghost" size="icon" onClick={onPrintLabel}
            aria-label={`چاپ برچسب ${node.name}`}
            icon={<Printer className="size-3.5" />}
            className="size-7"
          />
        ) : null}
        {onDelete ? (
          <Button
            variant="ghost" size="icon" onClick={onDelete}
            aria-label={`حذف ${node.name}`}
            icon={<Trash2 className="size-3.5" />}
            className="size-7 text-content-subtle hover:text-danger"
          />
        ) : null}
      </div>
    </div>
  );
}

/** نوع پیشنهادی فرزند — یک پله پایین‌تر از والد. */
function suggestChildKind(parentKind?: string): string {
  const order = ['BUILDING', 'FLOOR', 'SECTION', 'ROOM', 'AISLE', 'SHELF', 'SHELF_LEVEL', 'POSITION'];
  if (!parentKind) return 'BUILDING';
  const index = order.indexOf(parentKind);
  return index >= 0 && index < order.length - 1 ? order[index + 1]! : 'POSITION';
}

function countNodes(nodes: LocationNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
}

function utilizationColor(utilization: number | null): string {
  if (utilization === null) return 'bg-border';
  if (utilization >= 90) return 'bg-danger';
  if (utilization >= 70) return 'bg-warning';
  return 'bg-success';
}

function utilizationTextColor(utilization: number | null): string {
  if (utilization === null) return 'text-content-muted';
  if (utilization >= 90) return 'text-danger';
  if (utilization >= 70) return 'text-warning';
  return 'text-success';
}
