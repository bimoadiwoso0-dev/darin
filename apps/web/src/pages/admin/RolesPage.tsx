import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Pencil, Plus, Shield, ShieldCheck, Trash2, Users } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, Input,
  Modal, Skeleton, Textarea, cn,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { toPersianDigits } from '@/lib/format';

interface Role {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
  permissionKeys: string[];
}

interface PermissionGroup {
  group: string;
  label: string;
  permissions: Array<{ id: string; key: string; group: string; label: string }>;
}

const EMPTY_FORM = { key: '', name: '', description: '', permissionKeys: [] as string[] };

/**
 * نقش‌ها و دسترسی‌ها (قوانین ۵۶، ۵۷، ۷۳).
 *
 * ── چرا ماتریس تیک‌دار و نه فهرست متنی ──────────────────────────────────
 * مدیر باید در یک نگاه ببیند «کتابدار» چه کارهایی می‌تواند بکند و چه
 * کارهایی نه. فهرست ۵۲ کلید انگلیسی این را نمی‌گوید؛ گروه‌بندی موضوعی با
 * تیک، می‌گوید.
 *
 * ── نقش مدیر ارشد قفل است ───────────────────────────────────────────────
 * اگر کسی به‌اشتباه مجوز «مدیریت نقش‌ها» را از مدیر ارشد بردارد، دیگر
 * هیچ‌کس نمی‌تواند آن را برگرداند و سامانه برای همیشه قفل می‌شود. سرور هم
 * مستقل از این صفحه، چنین تغییری را رد می‌کند.
 */
export function RolesPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Role | null>(null);
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [deleteTarget, setDeleteTarget] = React.useState<Role | null>(null);

  const { data: roles, isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<Role[]>('/roles'),
  });

  const { data: groups } = useQuery({
    queryKey: ['roles', 'permissions'],
    queryFn: () => api.get<PermissionGroup[]>('/roles/permissions'),
    staleTime: Infinity,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['roles'] });
    void queryClient.invalidateQueries({ queryKey: ['users'] });
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        permissionKeys: form.permissionKeys,
      };
      return editing
        ? api.patch(`/roles/${editing.id}`, payload)
        : api.post('/roles', { ...payload, key: form.key.trim().toUpperCase() });
    },
    onSuccess: () => {
      toast.success(
        editing ? 'نقش به‌روز شد' : 'نقش ساخته شد',
        editing
          ? 'کاربران دارای این نقش از سامانه خارج شدند تا دسترسی جدید اعمال شود.'
          : undefined,
      );
      setFormOpen(false);
      setForm(EMPTY_FORM);
      setEditing(null);
      setErrors({});
      invalidate();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.fieldErrors) setErrors(error.fieldErrors);
      toast.apiError(error, editing ? 'به‌روزرسانی نقش انجام نشد' : 'ساخت نقش انجام نشد');
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/roles/${deleteTarget?.id}`),
    onSuccess: () => {
      toast.success('نقش حذف شد');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (error) => toast.apiError(error, 'حذف نقش انجام نشد'),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setFormOpen(true);
  };

  const openEdit = (role: Role) => {
    setEditing(role);
    setForm({
      key: role.key,
      name: role.name,
      description: role.description ?? '',
      permissionKeys: role.permissionKeys,
    });
    setErrors({});
    setFormOpen(true);
  };

  const totalPermissions = groups?.reduce((sum, g) => sum + g.permissions.length, 0) ?? 0;
  const isSuperAdmin = editing?.key === 'SUPER_ADMIN';

  const toggleGroup = (group: PermissionGroup, checked: boolean) => {
    const keys = group.permissions.map((p) => p.key);
    setForm((f) => ({
      ...f,
      permissionKeys: checked
        ? [...new Set([...f.permissionKeys, ...keys])]
        : f.permissionKeys.filter((k) => !keys.includes(k)),
    }));
  };

  return (
    <>
      <PageHeader
        title="نقش‌ها و دسترسی‌ها"
        description={
          roles
            ? `${toPersianDigits(roles.length)} نقش · ${toPersianDigits(totalPermissions)} مجوز`
            : 'در حال بارگذاری…'
        }
        actions={
          <Button variant="primary" onClick={openCreate} icon={<Plus className="size-4" />}>
            ساخت نقش سفارشی
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-52" />)}
        </div>
      ) : roles && roles.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {roles.map((role) => (
            <Card key={role.id} className={role.key === 'SUPER_ADMIN' ? 'border-danger/30' : undefined}>
              <CardHeader
                title={
                  <span className="flex items-center gap-1.5">
                    {role.key === 'SUPER_ADMIN' ? (
                      <ShieldCheck className="size-4 text-danger" />
                    ) : (
                      <Shield className="size-4 text-content-subtle" />
                    )}
                    {role.name}
                  </span>
                }
                description={role.description ?? undefined}
                action={
                  role.isSystem ? (
                    <Badge tone="neutral" icon={<Lock className="size-3" />}>سیستمی</Badge>
                  ) : (
                    <Badge tone="primary">سفارشی</Badge>
                  )
                }
              />

              <div className="space-y-3 p-4">
                <div className="flex items-center gap-3 text-xs text-content-muted">
                  <span className="flex items-center gap-1">
                    <Users className="size-3.5" />
                    {toPersianDigits(role.userCount)} کاربر
                  </span>
                  <span className="font-mono text-2xs text-content-subtle" dir="ltr">
                    {role.key}
                  </span>
                </div>

                {role.key === 'SUPER_ADMIN' ? (
                  <p className="rounded border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-xs text-danger-content">
                    دسترسی کامل و غیرقابل تغییر به همه بخش‌های سامانه.
                  </p>
                ) : (
                  <>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${totalPermissions > 0 ? (role.permissionKeys.length / totalPermissions) * 100 : 0}%`,
                        }}
                      />
                    </div>
                    <p className="text-xs text-content-muted">
                      {toPersianDigits(role.permissionKeys.length)} مجوز از{' '}
                      {toPersianDigits(totalPermissions)}
                    </p>
                  </>
                )}

                <div className="flex gap-2 border-t border-border pt-3">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => openEdit(role)}
                    icon={<Pencil className="size-3.5" />}
                    disabled={role.key === 'SUPER_ADMIN'}
                  >
                    {role.key === 'SUPER_ADMIN' ? 'قفل‌شده' : 'ویرایش دسترسی‌ها'}
                  </Button>
                  {!role.isSystem ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDeleteTarget(role)}
                      icon={<Trash2 className="size-3.5" />}
                      aria-label={`حذف نقش ${role.name}`}
                      className="text-content-subtle hover:text-danger"
                    />
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState icon={<Shield className="size-6" />} title="نقشی تعریف نشده" />
        </Card>
      )}

      {/* ── ماتریس دسترسی ──────────────────────────────────────────── */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `ویرایش نقش «${editing.name}»` : 'ساخت نقش سفارشی'}
        description="مجوزهایی که این نقش به کاربران می‌دهد"
        size="xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>انصراف</Button>
            <Button
              variant="primary"
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={!form.name.trim() || (!editing && !form.key.trim()) || isSuperAdmin}
            >
              {editing ? 'ذخیره تغییرات' : 'ساخت نقش'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {!editing ? (
              <Field
                label="کلید نقش"
                required
                error={errors.key}
                hint="فقط حروف انگلیسی بزرگ و زیرخط — پس از ساخت تغییر نمی‌کند."
              >
                <Input
                  ltr value={form.key}
                  onChange={(e) => setForm((f) => ({ ...f, key: e.target.value.toUpperCase() }))}
                  invalid={!!errors.key}
                  placeholder="ARCHIVE_STAFF"
                />
              </Field>
            ) : null}

            <Field label="نام نمایشی" required error={errors.name}>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                invalid={!!errors.name}
                placeholder="مسئول آرشیو"
                autoFocus
              />
            </Field>
          </div>

          <Field label="توضیح" hint="در فهرست نقش‌ها و فرم کاربران نمایش داده می‌شود.">
            <Textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
            />
          </Field>

          {isSuperAdmin ? (
            <div className="rounded border border-danger/30 bg-danger-soft p-3 text-sm text-danger-content">
              مجوزهای نقش «مدیر ارشد» قابل تغییر نیستند. این نقش پشتوانه بازگشت سامانه
              است: اگر دسترسی‌اش محدود شود، ممکن است هیچ‌کس نتواند آن را برگرداند.
            </div>
          ) : (
            <Field label="مجوزها" error={errors.permissionKeys}>
              <div className="max-h-[26rem] space-y-3 overflow-y-auto rounded border border-border bg-surface p-3">
                {groups?.map((group) => {
                  const keys = group.permissions.map((p) => p.key);
                  const selected = keys.filter((k) => form.permissionKeys.includes(k)).length;
                  const all = selected === keys.length;

                  return (
                    <div key={group.group} className="rounded border border-border">
                      <label className="flex cursor-pointer items-center gap-2 border-b border-border bg-surface-sunken px-3 py-2">
                        <input
                          type="checkbox"
                          checked={all}
                          ref={(el) => {
                            // حالت میانی: بعضی از مجوزهای گروه انتخاب شده‌اند
                            if (el) el.indeterminate = selected > 0 && !all;
                          }}
                          onChange={(e) => toggleGroup(group, e.target.checked)}
                          className="size-4 rounded border-border-strong text-primary focus:ring-primary/30"
                        />
                        <span className="flex-1 text-sm font-medium text-content">
                          {group.label}
                        </span>
                        <span className="text-2xs text-content-subtle">
                          {toPersianDigits(selected)} از {toPersianDigits(keys.length)}
                        </span>
                      </label>

                      <div className="grid gap-1 p-2 sm:grid-cols-2 lg:grid-cols-3">
                        {group.permissions.map((permission) => (
                          <label
                            key={permission.key}
                            className={cn(
                              'flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 text-xs transition',
                              form.permissionKeys.includes(permission.key)
                                ? 'bg-primary-soft'
                                : 'hover:bg-surface-sunken',
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={form.permissionKeys.includes(permission.key)}
                              onChange={(e) =>
                                setForm((f) => ({
                                  ...f,
                                  permissionKeys: e.target.checked
                                    ? [...f.permissionKeys, permission.key]
                                    : f.permissionKeys.filter((k) => k !== permission.key),
                                }))
                              }
                              className="mt-0.5 size-3.5 shrink-0 rounded border-border-strong text-primary focus:ring-primary/30"
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-content">{permission.label}</span>
                              <span
                                className="block truncate font-mono text-2xs text-content-subtle"
                                dir="ltr"
                              >
                                {permission.key}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Field>
          )}

          {editing && !isSuperAdmin ? (
            <p className="rounded border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-content">
              با ذخیره تغییرات، {toPersianDigits(editing.userCount)} کاربر دارای این نقش از
              سامانه خارج می‌شوند تا با دسترسی قدیمی کار نکنند.
            </p>
          ) : null}
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title="حذف نقش"
        confirmLabel="حذف کن"
        message={
          <>
            <p>نقش «{deleteTarget?.name}» حذف می‌شود.</p>
            {deleteTarget && deleteTarget.userCount > 0 ? (
              <p className="mt-2 rounded border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-danger-content">
                {toPersianDigits(deleteTarget.userCount)} کاربر این نقش را دارند. ابتدا
                نقش دیگری برایشان تعیین کنید؛ سرور اجازه حذف نقشِ دارای کاربر را نمی‌دهد.
              </p>
            ) : null}
          </>
        }
      />
    </>
  );
}
