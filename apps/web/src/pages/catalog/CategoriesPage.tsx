import * as React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, FolderTree, MoveRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { persianNormalize } from '@darin/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal,
  Select, Skeleton, Textarea, cn,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { toPersianDigits } from '@/lib/format';

interface CategoryNode {
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

const EMPTY_FORM = {
  name: '',
  code: '',
  kind: 'SUBJECT' as 'SUBJECT' | 'GENRE',
  colorHex: '',
  description: '',
};

/**
 * درخت دسته‌بندی موضوعی (قانون ۲۹).
 *
 * ── چرا درخت و نه فهرست تخت ─────────────────────────────────────────────
 * موضوع‌ها ذاتاً سلسله‌مراتبی‌اند: «شعر» زیر «ادبیات» و «غزل» زیر «شعر».
 * جستجوی «همه کتاب‌های ادبیات» باید غزل‌ها را هم بیاورد، و این فقط با
 * ساختار درختی معنا پیدا می‌کند.
 *
 * ── شمارش تجمعی است ─────────────────────────────────────────────────────
 * عدد کنار هر دسته شامل زیرشاخه‌هایش هم هست؛ «ادبیات ۳۴۰» یعنی سیصد و
 * چهل کتاب در ادبیات و همه زیرشاخه‌هایش.
 */
export function CategoriesPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();

  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [search, setSearch] = React.useState('');
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CategoryNode | null>(null);
  const [parent, setParent] = React.useState<CategoryNode | null>(null);
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [deleteTarget, setDeleteTarget] = React.useState<CategoryNode | null>(null);
  const [moveTarget, setMoveTarget] = React.useState<CategoryNode | null>(null);
  const [moveParentId, setMoveParentId] = React.useState<string>('');

  const { data: tree, isLoading } = useQuery({
    queryKey: ['categories', 'tree'],
    queryFn: () => api.get<CategoryNode[]>('/categories'),
  });

  React.useEffect(() => {
    if (!tree) return;
    setExpanded((current) => {
      if (current.size > 0) return current;
      return new Set(tree.map((root) => root.id));
    });
  }, [tree]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['categories'] });
    void queryClient.invalidateQueries({ queryKey: ['books'] });
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim() || null,
        kind: form.kind,
        colorHex: form.colorHex || null,
        description: form.description.trim() || null,
        ...(editing ? {} : { parentId: parent?.id ?? null }),
      };
      return editing
        ? api.patch(`/categories/${editing.id}`, payload)
        : api.post('/categories', payload);
    },
    onSuccess: () => {
      toast.success(editing ? 'دسته ویرایش شد' : 'دسته افزوده شد');
      setFormOpen(false);
      setErrors({});
      invalidate();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.fieldErrors) setErrors(error.fieldErrors);
      toast.apiError(error, 'ذخیره دسته انجام نشد');
    },
  });

  const move = useMutation({
    mutationFn: () =>
      api.post(`/categories/${moveTarget?.id}/move`, {
        newParentId: moveParentId || null,
      }),
    onSuccess: () => {
      toast.success('دسته جابه‌جا شد', 'زیرشاخه‌ها هم همراه آن منتقل شدند.');
      setMoveTarget(null);
      setMoveParentId('');
      invalidate();
    },
    onError: (error) => toast.apiError(error, 'جابه‌جایی دسته انجام نشد'),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/categories/${deleteTarget?.id}`),
    onSuccess: () => {
      toast.success('دسته حذف شد');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (error) => toast.apiError(error, 'حذف دسته انجام نشد'),
  });

  /** فهرست تخت برای کشوی «والد جدید» هنگام جابه‌جایی. */
  const flat = React.useMemo(() => {
    const list: CategoryNode[] = [];
    const walk = (nodes: CategoryNode[]) => {
      for (const node of nodes) { list.push(node); walk(node.children); }
    };
    walk(tree ?? []);
    return list;
  }, [tree]);

  const searchResults = React.useMemo(() => {
    const normalized = persianNormalize(search);
    if (!normalized) return null;
    return flat.filter((node) => persianNormalize(node.name).includes(normalized));
  }, [flat, search]);

  /** نوادگان یک دسته — نمی‌توان دسته را زیر فرزند خودش برد. */
  const descendantIds = React.useMemo(() => {
    if (!moveTarget) return new Set<string>();
    const ids = new Set<string>([moveTarget.id]);
    const walk = (nodes: CategoryNode[]) => {
      for (const node of nodes) { ids.add(node.id); walk(node.children); }
    };
    walk(moveTarget.children);
    return ids;
  }, [moveTarget]);

  const openCreate = (parentNode: CategoryNode | null) => {
    setEditing(null);
    setParent(parentNode);
    setForm({ ...EMPTY_FORM, kind: parentNode?.kind ?? 'SUBJECT' });
    setErrors({});
    setFormOpen(true);
  };

  const canManage = can('categories.manage');
  const totalBooks = (tree ?? []).reduce((sum, root) => sum + root.bookCount, 0);

  return (
    <>
      <PageHeader
        title="دسته‌بندی‌ها"
        description={
          tree
            ? `${toPersianDigits(flat.length)} دسته · ${toPersianDigits(totalBooks)} کتاب دسته‌بندی‌شده`
            : 'در حال بارگذاری…'
        }
        actions={
          canManage ? (
            <Button variant="primary" onClick={() => openCreate(null)} icon={<Plus className="size-4" />}>
              افزودن دسته اصلی
            </Button>
          ) : null
        }
      />

      <Card>
        <div className="border-b border-border p-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجوی دسته…"
            aria-label="جستجوی دسته"
            prefixIcon={<FolderTree className="size-4" />}
          />
        </div>

        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-9" />)}
          </div>
        ) : searchResults ? (
          searchResults.length > 0 ? (
            <ul className="divide-y divide-border">
              {searchResults.map((node) => (
                <li key={node.id}>
                  <CategoryRow
                    node={node}
                    depth={0}
                    expandable={false}
                    canManage={canManage}
                    onAddChild={() => openCreate(node)}
                    onEdit={() => {
                      setEditing(node);
                      setParent(null);
                      setForm({
                        name: node.name,
                        code: node.code ?? '',
                        kind: node.kind,
                        colorHex: node.colorHex ?? '',
                        description: '',
                      });
                      setErrors({});
                      setFormOpen(true);
                    }}
                    onMove={() => { setMoveTarget(node); setMoveParentId(node.parentId ?? ''); }}
                    onDelete={() => setDeleteTarget(node)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="دسته‌ای با این نام یافت نشد" />
          )
        ) : (tree ?? []).length > 0 ? (
          <ul>
            {(tree ?? []).map((root) => (
              <CategoryBranch
                key={root.id}
                node={root}
                depth={0}
                expanded={expanded}
                canManage={canManage}
                onToggle={(id) =>
                  setExpanded((s) => {
                    const next = new Set(s);
                    if (next.has(id)) next.delete(id); else next.add(id);
                    return next;
                  })
                }
                onAddChild={openCreate}
                onEdit={(node) => {
                  setEditing(node);
                  setParent(null);
                  setForm({
                    name: node.name,
                    code: node.code ?? '',
                    kind: node.kind,
                    colorHex: node.colorHex ?? '',
                    description: '',
                  });
                  setErrors({});
                  setFormOpen(true);
                }}
                onMove={(node) => { setMoveTarget(node); setMoveParentId(node.parentId ?? ''); }}
                onDelete={setDeleteTarget}
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<FolderTree className="size-6" />}
            title="هنوز دسته‌بندی تعریف نشده"
            description="ساختار موضوعی کتابخانه را بسازید؛ مثلاً «ادبیات ← شعر ← غزل»."
            action={
              canManage ? (
                <Button variant="primary" onClick={() => openCreate(null)}>
                  افزودن اولین دسته
                </Button>
              ) : null
            }
          />
        )}
      </Card>

      {/* ── فرم دسته ───────────────────────────────────────────────── */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'ویرایش دسته' : 'افزودن دسته'}
        description={
          editing
            ? undefined
            : parent
              ? `زیرمجموعه «${parent.name}»`
              : 'دسته اصلی (بدون والد)'
        }
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>انصراف</Button>
            <Button
              variant="primary"
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={!form.name.trim()}
            >
              ذخیره
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="نام دسته" required error={errors.name}>
            <Input
              value={form.name} autoFocus
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              invalid={!!errors.name}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="نوع">
              <Select
                value={form.kind}
                onChange={(e) =>
                  setForm((f) => ({ ...f, kind: e.target.value as 'SUBJECT' | 'GENRE' }))
                }
              >
                <option value="SUBJECT">موضوع</option>
                <option value="GENRE">ژانر</option>
              </Select>
            </Field>

            <Field label="کد" hint="اختیاری — مثلاً رده دیویی" error={errors.code}>
              <Input
                ltr value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              />
            </Field>
          </div>

          <Field label="رنگ" hint="برای تشخیص سریع در برچسب‌ها و نمودارها" error={errors.colorHex}>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={form.colorHex || '#1e40af'}
                onChange={(e) => setForm((f) => ({ ...f, colorHex: e.target.value }))}
                aria-label="انتخاب رنگ دسته"
                className="h-input w-14 cursor-pointer rounded border border-border bg-surface p-1"
              />
              <Input
                ltr value={form.colorHex}
                onChange={(e) => setForm((f) => ({ ...f, colorHex: e.target.value }))}
                placeholder="#1e40af"
                className="flex-1"
              />
              {form.colorHex ? (
                <Button variant="ghost" size="sm" onClick={() => setForm((f) => ({ ...f, colorHex: '' }))}>
                  بدون رنگ
                </Button>
              ) : null}
            </div>
          </Field>

          <Field label="توضیح">
            <Textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
            />
          </Field>
        </div>
      </Modal>

      {/* ── جابه‌جایی در درخت ──────────────────────────────────────── */}
      <Modal
        open={!!moveTarget}
        onClose={() => setMoveTarget(null)}
        title="جابه‌جایی دسته"
        description={moveTarget?.name}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMoveTarget(null)}>انصراف</Button>
            <Button variant="primary" onClick={() => move.mutate()} loading={move.isPending}>
              جابه‌جا کن
            </Button>
          </>
        }
      >
        <Field
          label="والد جدید"
          hint="زیرشاخه‌های این دسته هم همراهش منتقل می‌شوند."
        >
          <Select value={moveParentId} onChange={(e) => setMoveParentId(e.target.value)}>
            <option value="">— دسته اصلی (بدون والد) —</option>
            {flat
              // نمی‌توان دسته را زیر خودش یا زیر یکی از نوادگانش برد
              .filter((node) => !descendantIds.has(node.id))
              .map((node) => (
                <option key={node.id} value={node.id}>
                  {'—'.repeat(node.depth)} {node.name}
                </option>
              ))}
          </Select>
        </Field>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title="حذف دسته"
        confirmLabel="حذف کن"
        message={
          <>
            <p>دسته «{deleteTarget?.name}» حذف می‌شود.</p>
            {deleteTarget && deleteTarget.bookCount > 0 ? (
              <p className="mt-2 rounded border border-warning/30 bg-warning-soft px-2.5 py-1.5 text-warning-content">
                {toPersianDigits(deleteTarget.bookCount)} کتاب زیر این دسته‌اند. کتاب‌ها
                حذف نمی‌شوند اما دسته‌بندی‌شان را از دست می‌دهند.
              </p>
            ) : null}
            {deleteTarget && deleteTarget.children.length > 0 ? (
              <p className="mt-2 rounded border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-danger-content">
                این دسته {toPersianDigits(deleteTarget.children.length)} زیرشاخه دارد.
                ابتدا آنها را جابه‌جا یا حذف کنید.
              </p>
            ) : null}
          </>
        }
      />
    </>
  );
}

function CategoryBranch({
  node, depth, expanded, canManage, onToggle, onAddChild, onEdit, onMove, onDelete,
}: {
  node: CategoryNode;
  depth: number;
  expanded: Set<string>;
  canManage: boolean;
  onToggle: (id: string) => void;
  onAddChild: (parent: CategoryNode) => void;
  onEdit: (node: CategoryNode) => void;
  onMove: (node: CategoryNode) => void;
  onDelete: (node: CategoryNode) => void;
}) {
  const isOpen = expanded.has(node.id);
  return (
    <li>
      <CategoryRow
        node={node}
        depth={depth}
        expandable={node.children.length > 0}
        expanded={isOpen}
        canManage={canManage}
        onToggleExpand={() => onToggle(node.id)}
        onAddChild={() => onAddChild(node)}
        onEdit={() => onEdit(node)}
        onMove={() => onMove(node)}
        onDelete={() => onDelete(node)}
      />
      {isOpen && node.children.length > 0 ? (
        <ul>
          {node.children.map((child) => (
            <CategoryBranch
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              canManage={canManage}
              onToggle={onToggle}
              onAddChild={onAddChild}
              onEdit={onEdit}
              onMove={onMove}
              onDelete={onDelete}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function CategoryRow({
  node, depth, expandable, expanded, canManage,
  onToggleExpand, onAddChild, onEdit, onMove, onDelete,
}: {
  node: CategoryNode;
  depth: number;
  expandable: boolean;
  expanded?: boolean;
  canManage: boolean;
  onToggleExpand?: () => void;
  onAddChild: () => void;
  onEdit: () => void;
  onMove: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="group flex items-center gap-2 border-b border-border py-2 pe-3 transition hover:bg-surface-sunken"
      style={{ paddingInlineStart: `${0.75 + depth * 1.1}rem` }}
    >
      {expandable ? (
        <button
          type="button"
          onClick={onToggleExpand}
          aria-label={expanded ? 'بستن زیرشاخه' : 'باز کردن زیرشاخه'}
          aria-expanded={expanded}
          className="rounded p-1 text-content-subtle hover:text-content"
        >
          <ChevronLeft className={cn('size-4 transition', expanded && '-rotate-90')} />
        </button>
      ) : (
        <span className="w-6" aria-hidden />
      )}

      {node.colorHex ? (
        <span
          className="size-2.5 shrink-0 rounded-sm"
          style={{ background: node.colorHex }}
          aria-hidden
        />
      ) : null}

      <Link
        to={`/books?categoryId=${node.id}`}
        className="min-w-0 flex-1 truncate text-sm text-content hover:text-primary hover:underline"
      >
        {node.name}
      </Link>

      {node.code ? (
        <span className="shrink-0 font-mono text-2xs text-content-subtle" dir="ltr">
          {node.code}
        </span>
      ) : null}

      {node.kind === 'GENRE' ? <Badge tone="info">ژانر</Badge> : null}

      <Badge tone={node.bookCount > 0 ? 'primary' : 'neutral'}>
        {toPersianDigits(node.bookCount)} کتاب
      </Badge>

      {canManage ? (
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
          <Button
            variant="ghost" size="icon" onClick={onAddChild}
            aria-label={`افزودن زیرشاخه به ${node.name}`}
            icon={<Plus className="size-3.5" />}
            className="size-7"
          />
          <Button
            variant="ghost" size="icon" onClick={onEdit}
            aria-label={`ویرایش ${node.name}`}
            icon={<Pencil className="size-3.5" />}
            className="size-7"
          />
          <Button
            variant="ghost" size="icon" onClick={onMove}
            aria-label={`جابه‌جایی ${node.name}`}
            icon={<MoveRight className="size-3.5" />}
            className="size-7"
          />
          <Button
            variant="ghost" size="icon" onClick={onDelete}
            aria-label={`حذف ${node.name}`}
            icon={<Trash2 className="size-3.5" />}
            className="size-7 text-content-subtle hover:text-danger"
          />
        </div>
      ) : null}
    </div>
  );
}
