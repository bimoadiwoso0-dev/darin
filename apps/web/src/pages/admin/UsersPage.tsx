import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KeyRound, LogOut, Pencil, Plus, ShieldAlert, Trash2, Unlock, UserCog,
} from 'lucide-react';
import { api, ApiError, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal, Select,
  TableSkeleton, TableWrapper, Td, Th,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { FilterBar } from '@/components/shared/FilterBar';
import { Pagination } from '@/components/shared/Pagination';
import { useDebounced, useUrlFilters } from '@/hooks/useUrlFilters';
import { formatDateTime, formatNumber, formatRelative, toPersianDigits } from '@/lib/format';

interface RoleSummary {
  id: string; key: string; name: string; isSystem: boolean;
}

interface UserRow {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  failedLoginCount: number;
  lockedUntil: string | null;
  createdAt: string;
  deletedAt: string | null;
  branch: { id: string; name: string } | null;
  roles: RoleSummary[];
}

interface RoleWithPermissions extends RoleSummary {
  description: string | null;
  userCount: number;
  permissionKeys: string[];
}

const DEFAULTS = {
  q: '',
  page: 1,
  pageSize: 20,
  roleId: '',
  isActive: '',
  includeDeleted: '',
};

const EMPTY_FORM = {
  username: '',
  fullName: '',
  email: '',
  phone: '',
  password: '',
  isActive: true,
  roleIds: [] as string[],
};

/**
 * مدیریت کاربران سامانه (قوانین ۵۶، ۵۷).
 *
 * ── کاربر ≠ عضو ──────────────────────────────────────────────────────────
 * این صفحه درباره کسانی است که **وارد سامانه می‌شوند** — کتابدار، مسئول
 * بخش، مدیر. اعضای کتابخانه صفحه جداگانه‌ای دارند و حساب ورود نمی‌گیرند.
 *
 * ── رمز عبور فقط تعیین می‌شود، هرگز نمایش داده نمی‌شود ───────────────────
 * سرور هیچ مسیری برای خواندن رمز ندارد. مدیر می‌تواند رمز جدیدی بگذارد،
 * و کاربر موظف است در اولین ورود عوضش کند.
 */
export function UsersPage() {
  const queryClient = useQueryClient();
  const { user: currentUser, can } = useAuth();
  const toast = useToast();
  const { values, setFilters, reset, hasActiveFilters } = useUrlFilters(DEFAULTS);

  const [searchInput, setSearchInput] = React.useState(values.q);
  const debouncedSearch = useDebounced(searchInput, 300);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<UserRow | null>(null);
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});

  const [passwordTarget, setPasswordTarget] = React.useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = React.useState('');
  const [deleteTarget, setDeleteTarget] = React.useState<UserRow | null>(null);

  React.useEffect(() => {
    if (debouncedSearch !== values.q) setFilters({ q: debouncedSearch });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const { data: roles } = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<RoleWithPermissions[]>('/roles'),
    enabled: can('roles.manage'),
    staleTime: 5 * 60_000,
  });

  const query = {
    q: values.q || undefined,
    page: values.page,
    pageSize: values.pageSize,
    roleId: values.roleId || undefined,
    isActive: values.isActive || undefined,
    includeDeleted: values.includeDeleted || undefined,
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['users', query],
    queryFn: () => api.get<Paginated<UserRow>>('/users', query),
    placeholderData: (previous) => previous,
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['users'] });

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        username: form.username.trim(),
        fullName: form.fullName.trim(),
        email: form.email.trim() || '',
        phone: form.phone.trim() || null,
        isActive: form.isActive,
        roleIds: form.roleIds,
        ...(editing ? {} : { password: form.password }),
      };
      return editing
        ? api.patch<UserRow>(`/users/${editing.id}`, payload)
        : api.post<UserRow>('/users', payload);
    },
    onSuccess: () => {
      toast.success(
        editing ? 'کاربر ویرایش شد' : 'کاربر ساخته شد',
        editing ? 'نشست‌های باز کاربر بسته شدند تا دسترسی جدید اعمال شود.' : undefined,
      );
      setFormOpen(false);
      setForm(EMPTY_FORM);
      setEditing(null);
      setErrors({});
      invalidate();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.fieldErrors) setErrors(error.fieldErrors);
      toast.apiError(error, editing ? 'ویرایش انجام نشد' : 'ساخت کاربر انجام نشد');
    },
  });

  const resetPassword = useMutation({
    mutationFn: () =>
      api.post(`/users/${passwordTarget?.id}/reset-password`, { password: newPassword }),
    onSuccess: () => {
      toast.success(
        'رمز عبور تغییر کرد',
        'کاربر در اولین ورود موظف به تعیین رمز جدید است و نشست‌های بازش بسته شدند.',
      );
      setPasswordTarget(null);
      setNewPassword('');
      invalidate();
    },
    onError: (error) => toast.apiError(error, 'تغییر رمز عبور انجام نشد'),
  });

  const unlock = useMutation({
    mutationFn: (id: string) => api.post(`/users/${id}/unlock`),
    onSuccess: () => { toast.success('قفل حساب باز شد'); invalidate(); },
    onError: (error) => toast.apiError(error, 'باز کردن قفل انجام نشد'),
  });

  const revokeSessions = useMutation({
    mutationFn: (id: string) => api.post<{ revoked: number }>(`/users/${id}/revoke-sessions`),
    onSuccess: (result) => {
      toast.success(`${toPersianDigits(result.revoked)} نشست بسته شد`);
      invalidate();
    },
    onError: (error) => toast.apiError(error, 'بستن نشست‌ها انجام نشد'),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/users/${deleteTarget?.id}`),
    onSuccess: () => {
      toast.success('کاربر بایگانی شد', 'فعالیت‌های ثبت‌شده او در گزارش‌ها باقی می‌ماند.');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (error) => toast.apiError(error, 'حذف کاربر انجام نشد'),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setFormOpen(true);
  };

  const openEdit = (user: UserRow) => {
    setEditing(user);
    setForm({
      username: user.username,
      fullName: user.fullName,
      email: user.email ?? '',
      phone: user.phone ?? '',
      password: '',
      isActive: user.isActive,
      roleIds: user.roles.map((r) => r.id),
    });
    setErrors({});
    setFormOpen(true);
  };

  const canManage = can('users.manage');

  return (
    <>
      <PageHeader
        title="کاربران"
        description={data ? `${formatNumber(data.meta.total)} کاربر سامانه` : 'در حال بارگذاری…'}
        actions={
          canManage ? (
            <Button variant="primary" onClick={openCreate} icon={<Plus className="size-4" />}>
              ساخت کاربر جدید
            </Button>
          ) : null
        }
      />

      <Card>
        <FilterBar
          search={searchInput}
          onSearchChange={setSearchInput}
          placeholder="نام، نام کاربری یا ایمیل…"
          activeCount={[values.roleId, values.isActive, values.includeDeleted].filter(Boolean).length}
          onReset={hasActiveFilters ? () => { reset(); setSearchInput(''); } : undefined}
        >
          <Field label="نقش">
            <Select
              value={values.roleId}
              onChange={(e) => setFilters({ roleId: e.target.value })}
              aria-label="فیلتر نقش"
            >
              <option value="">همه نقش‌ها</option>
              {roles?.map((role) => (
                <option key={role.id} value={role.id}>{role.name}</option>
              ))}
            </Select>
          </Field>

          <Field label="وضعیت حساب">
            <Select
              value={values.isActive}
              onChange={(e) => setFilters({ isActive: e.target.value })}
              aria-label="فیلتر وضعیت"
            >
              <option value="">همه</option>
              <option value="true">فعال</option>
              <option value="false">غیرفعال</option>
            </Select>
          </Field>

          <Field label="حساب‌های بایگانی‌شده">
            <Select
              value={values.includeDeleted}
              onChange={(e) => setFilters({ includeDeleted: e.target.value })}
              aria-label="نمایش بایگانی‌شده‌ها"
            >
              <option value="">فقط حساب‌های فعلی</option>
              <option value="true">شامل بایگانی‌شده‌ها</option>
            </Select>
          </Field>
        </FilterBar>

        {isLoading ? (
          <TableSkeleton columns={5} />
        ) : data && data.data.length > 0 ? (
          <>
            <TableWrapper className={isFetching ? 'opacity-60 transition-opacity' : undefined}>
              <thead>
                <tr>
                  <Th>کاربر</Th>
                  <Th>نقش‌ها</Th>
                  <Th className="w-44">آخرین ورود</Th>
                  <Th className="w-32">وضعیت</Th>
                  <Th className="w-44">عملیات</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((user) => {
                  const locked = !!user.lockedUntil && new Date(user.lockedUntil) > new Date();
                  const isSelf = user.id === currentUser?.sub;
                  return (
                    <tr key={user.id} className="transition hover:bg-surface-sunken">
                      <Td>
                        <p className="text-sm font-medium text-content">
                          {user.fullName}
                          {isSelf ? (
                            <Badge tone="primary" className="ms-1.5">شما</Badge>
                          ) : null}
                        </p>
                        <p className="field-ltr mt-0.5 text-xs text-content-muted">
                          {user.username}
                          {user.email ? ` · ${user.email}` : ''}
                        </p>
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {user.roles.length > 0 ? (
                            user.roles.map((role) => (
                              <Badge
                                key={role.id}
                                tone={role.key === 'SUPER_ADMIN' ? 'danger' : 'neutral'}
                              >
                                {role.name}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-xs text-content-subtle">بدون نقش</span>
                          )}
                        </div>
                      </Td>
                      <Td className="text-xs text-content-muted">
                        {user.lastLoginAt ? (
                          <>
                            {formatDateTime(user.lastLoginAt)}
                            <span className="block text-2xs text-content-subtle">
                              {formatRelative(user.lastLoginAt)}
                            </span>
                          </>
                        ) : (
                          'هرگز وارد نشده'
                        )}
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {user.deletedAt ? (
                            <Badge tone="neutral">بایگانی‌شده</Badge>
                          ) : user.isActive ? (
                            <Badge tone="success">فعال</Badge>
                          ) : (
                            <Badge tone="warning">غیرفعال</Badge>
                          )}
                          {locked ? <Badge tone="danger">قفل‌شده</Badge> : null}
                          {user.mustChangePassword ? (
                            <Badge tone="info">باید رمز عوض کند</Badge>
                          ) : null}
                        </div>
                      </Td>
                      <Td>
                        {canManage && !user.deletedAt ? (
                          <div className="flex gap-0.5">
                            <Button
                              size="sm" variant="ghost" onClick={() => openEdit(user)}
                              icon={<Pencil className="size-3.5" />}
                              aria-label={`ویرایش ${user.fullName}`}
                            />
                            <Button
                              size="sm" variant="ghost"
                              onClick={() => { setPasswordTarget(user); setNewPassword(''); }}
                              icon={<KeyRound className="size-3.5" />}
                              aria-label={`تعیین رمز جدید برای ${user.fullName}`}
                            />
                            {locked ? (
                              <Button
                                size="sm" variant="ghost"
                                onClick={() => unlock.mutate(user.id)}
                                loading={unlock.isPending && unlock.variables === user.id}
                                icon={<Unlock className="size-3.5" />}
                                aria-label={`باز کردن قفل ${user.fullName}`}
                              />
                            ) : (
                              <Button
                                size="sm" variant="ghost"
                                onClick={() => revokeSessions.mutate(user.id)}
                                loading={revokeSessions.isPending && revokeSessions.variables === user.id}
                                icon={<LogOut className="size-3.5" />}
                                aria-label={`خروج اجباری ${user.fullName} از همه دستگاه‌ها`}
                              />
                            )}
                            {!isSelf ? (
                              <Button
                                size="sm" variant="ghost"
                                onClick={() => setDeleteTarget(user)}
                                icon={<Trash2 className="size-3.5" />}
                                aria-label={`حذف ${user.fullName}`}
                                className="text-content-subtle hover:text-danger"
                              />
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-xs text-content-subtle">—</span>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrapper>

            <Pagination
              meta={data.meta}
              onPageChange={(page) => setFilters({ page }, { resetPage: false })}
              onPageSizeChange={(pageSize) => setFilters({ pageSize })}
            />
          </>
        ) : (
          <EmptyState
            icon={<UserCog className="size-6" />}
            title="کاربری یافت نشد"
            action={
              canManage ? (
                <Button variant="primary" onClick={openCreate}>ساخت کاربر جدید</Button>
              ) : null
            }
          />
        )}
      </Card>

      {/* ── فرم ساخت/ویرایش ────────────────────────────────────────── */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'ویرایش کاربر' : 'ساخت کاربر جدید'}
        description={editing ? editing.username : 'حساب ورود برای یکی از کارکنان کتابخانه'}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>انصراف</Button>
            <Button
              variant="primary"
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={!form.username.trim() || !form.fullName.trim() || (!editing && !form.password)}
            >
              {editing ? 'ذخیره تغییرات' : 'ساخت کاربر'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="نام کاربری" required error={errors.username}>
              <Input
                ltr value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                invalid={!!errors.username}
                autoFocus={!editing}
              />
            </Field>

            <Field label="نام و نام خانوادگی" required error={errors.fullName}>
              <Input
                value={form.fullName}
                onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
                invalid={!!errors.fullName}
              />
            </Field>

            <Field label="ایمیل" error={errors.email}>
              <Input
                type="email" ltr value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                invalid={!!errors.email}
              />
            </Field>

            <Field label="تلفن" error={errors.phone}>
              <Input
                ltr value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              />
            </Field>
          </div>

          {!editing ? (
            <Field
              label="رمز عبور اولیه"
              required
              error={errors.password}
              hint="حداقل ۱۰ نویسه شامل حرف و عدد. کاربر در اولین ورود موظف به تغییر آن است."
            >
              <Input
                type="password" ltr value={form.password} autoComplete="new-password"
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                invalid={!!errors.password}
              />
            </Field>
          ) : null}

          <Field label="نقش‌ها" error={errors.roleIds} hint="دسترسی کاربر از مجموع نقش‌هایش می‌آید.">
            <div className="space-y-1.5 rounded border border-border bg-surface p-3">
              {roles?.map((role) => (
                <label
                  key={role.id}
                  className="flex cursor-pointer items-start gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={form.roleIds.includes(role.id)}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        roleIds: e.target.checked
                          ? [...f.roleIds, role.id]
                          : f.roleIds.filter((id) => id !== role.id),
                      }))
                    }
                    className="mt-0.5 size-4 rounded border-border-strong text-primary focus:ring-primary/30"
                  />
                  <span className="min-w-0">
                    <span className="block text-content">
                      {role.name}
                      {role.key === 'SUPER_ADMIN' ? (
                        <Badge tone="danger" className="ms-1.5">دسترسی کامل</Badge>
                      ) : null}
                    </span>
                    <span className="block text-2xs text-content-muted">
                      {role.description ??
                        `${toPersianDigits(role.permissionKeys.length)} مجوز`}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </Field>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-content-muted">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              className="size-4 rounded border-border-strong text-primary focus:ring-primary/30"
            />
            حساب فعال باشد (بتواند وارد سامانه شود)
          </label>

          {editing ? (
            <p className="rounded border border-info/30 bg-info-soft px-3 py-2 text-xs text-info-content">
              با تغییر نقش‌ها یا غیرفعال کردن حساب، نشست‌های باز این کاربر روی همه
              دستگاه‌ها بسته می‌شوند تا با دسترسی قدیمی کار نکند.
            </p>
          ) : null}
        </div>
      </Modal>

      {/* ── تعیین رمز جدید ─────────────────────────────────────────── */}
      <Modal
        open={!!passwordTarget}
        onClose={() => setPasswordTarget(null)}
        title="تعیین رمز عبور جدید"
        description={passwordTarget ? `${passwordTarget.fullName} (${passwordTarget.username})` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPasswordTarget(null)}>انصراف</Button>
            <Button
              variant="primary"
              onClick={() => resetPassword.mutate()}
              loading={resetPassword.isPending}
              disabled={newPassword.length < 10}
            >
              تغییر رمز
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded border border-warning/30 bg-warning-soft p-3 text-xs text-warning-content">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" />
            <p>
              رمز فعلی کاربر قابل مشاهده نیست و سامانه آن را در هیچ‌جا نگه نمی‌دارد.
              رمز جدیدی که اینجا می‌گذارید را به کاربر بگویید؛ او موظف است در اولین
              ورود آن را عوض کند.
            </p>
          </div>

          <Field label="رمز عبور جدید" required hint="حداقل ۱۰ نویسه شامل حرف و عدد.">
            <Input
              type="password" ltr value={newPassword} autoComplete="new-password" autoFocus
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title="حذف کاربر"
        confirmLabel="بایگانی کن"
        message={
          <>
            <p>
              حساب «{deleteTarget?.fullName}» بایگانی می‌شود و دیگر نمی‌تواند وارد
              سامانه شود.
            </p>
            <p className="mt-2 rounded border border-info/30 bg-info-soft px-2.5 py-1.5 text-info-content">
              رکورد کاربر پاک نمی‌شود تا فعالیت‌های ثبت‌شده او در گزارش فعالیت‌ها
              بی‌صاحب نماند. نام کاربری‌اش هم دیگر قابل استفاده مجدد نخواهد بود.
            </p>
          </>
        }
      />
    </>
  );
}
