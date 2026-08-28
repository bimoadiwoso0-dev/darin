import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, Merge, Pencil, Plus, Tags, Trash2, Users } from 'lucide-react';
import { api, ApiError, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Modal,
  TableSkeleton, TableWrapper, Td, Textarea, Th,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { FilterBar } from '@/components/shared/FilterBar';
import { Pagination } from '@/components/shared/Pagination';
import { EntityPicker } from '@/components/shared/EntityPicker';
import { useDebounced, useUrlFilters } from '@/hooks/useUrlFilters';
import { formatNumber, toPersianDigits } from '@/lib/format';

/**
 * صفحات داده مرجع: پدیدآورندگان، ناشران و مجموعه‌ها.
 *
 * ── چرا یک کامپوننت برای هر سه ──────────────────────────────────────────
 * ساختار این سه یکی است: فهرست، جستجو، ثبت، ویرایش، حذف با محافظت در
 * برابر حذف رکورد دارای کتاب. سه صفحه تقریباً یکسان یعنی سه برابر کد و
 * سه جا برای فراموش کردن یک اصلاح.
 *
 * ── ادغام رکوردهای تکراری (قانون ۴۲) ────────────────────────────────────
 * پس از ورود اطلاعات از Excel، معمولاً یک نویسنده با چند املا ثبت شده:
 * «صادق هدایت» و «هدایت، صادق». ادغام، کتاب‌های هر دو را زیر یک رکورد
 * جمع می‌کند بدون آنکه چیزی از دست برود.
 */

interface Person {
  id: string; fullName: string; latinName: string | null; nationality: string | null;
  birthDate: string | null; deathDate: string | null; bookCount: number;
}

interface Publisher {
  id: string; name: string; latinName: string | null; city: string | null;
  phone: string | null; bookCount: number;
}

interface Series {
  id: string; title: string; description: string | null;
  totalPlanned: number | null; bookCount: number;
}

const DEFAULTS = { q: '', page: 1, pageSize: 50 };

// ═══════════════════════════════════════════════════════════════════════════
//  پدیدآورندگان
// ═══════════════════════════════════════════════════════════════════════════

export function PersonsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();
  const { values, setFilters, reset, hasActiveFilters } = useUrlFilters(DEFAULTS);

  const [searchInput, setSearchInput] = React.useState(values.q);
  const debounced = useDebounced(searchInput, 300);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Person | null>(null);
  const [form, setForm] = React.useState({ fullName: '', latinName: '', nationality: '', biography: '' });
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [deleteTarget, setDeleteTarget] = React.useState<Person | null>(null);
  const [mergeSource, setMergeSource] = React.useState<Person | null>(null);
  const [mergeTargetId, setMergeTargetId] = React.useState<string | null>(null);
  const [mergeTargetLabel, setMergeTargetLabel] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (debounced !== values.q) setFilters({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['persons', values],
    queryFn: () =>
      api.get<Paginated<Person>>('/persons', {
        q: values.q || undefined,
        page: values.page,
        pageSize: values.pageSize,
      }),
    placeholderData: (previous) => previous,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['persons'] });
    void queryClient.invalidateQueries({ queryKey: ['books'] });
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        fullName: form.fullName.trim(),
        latinName: form.latinName.trim() || null,
        nationality: form.nationality.trim() || null,
        biography: form.biography.trim() || null,
      };
      return editing
        ? api.patch(`/persons/${editing.id}`, payload)
        : api.post('/persons', payload);
    },
    onSuccess: () => {
      toast.success(editing ? 'پدیدآورنده ویرایش شد' : 'پدیدآورنده ثبت شد');
      setFormOpen(false);
      setErrors({});
      invalidate();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.fieldErrors) setErrors(error.fieldErrors);
      toast.apiError(error, 'ذخیره انجام نشد');
    },
  });

  const merge = useMutation({
    mutationFn: () => api.post(`/persons/${mergeSource?.id}/merge`, { targetId: mergeTargetId }),
    onSuccess: () => {
      toast.success(
        'رکوردها ادغام شدند',
        'همه آثار به رکورد مقصد منتقل شد و رکورد تکراری حذف گردید.',
      );
      setMergeSource(null);
      setMergeTargetId(null);
      setMergeTargetLabel(null);
      invalidate();
    },
    onError: (error) => toast.apiError(error, 'ادغام انجام نشد'),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/persons/${deleteTarget?.id}`),
    onSuccess: () => {
      toast.success('پدیدآورنده حذف شد');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (error) => toast.apiError(error, 'حذف انجام نشد'),
  });

  const canManage = can('authors.manage');

  return (
    <>
      <PageHeader
        title="پدیدآورندگان"
        description={data ? `${formatNumber(data.meta.total)} نفر` : 'در حال بارگذاری…'}
        actions={
          canManage ? (
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null);
                setForm({ fullName: '', latinName: '', nationality: '', biography: '' });
                setErrors({});
                setFormOpen(true);
              }}
              icon={<Plus className="size-4" />}
            >
              ثبت پدیدآورنده
            </Button>
          ) : null
        }
      />

      <Card>
        <FilterBar
          search={searchInput}
          onSearchChange={setSearchInput}
          placeholder="نام پدیدآورنده…"
          onReset={hasActiveFilters ? () => { reset(); setSearchInput(''); } : undefined}
        />

        {isLoading ? (
          <TableSkeleton columns={4} />
        ) : data && data.data.length > 0 ? (
          <>
            <TableWrapper className={isFetching ? 'opacity-60 transition-opacity' : undefined}>
              <thead>
                <tr>
                  <Th>نام</Th>
                  <Th>نام لاتین</Th>
                  <Th>ملیت</Th>
                  <Th numeric className="w-24">آثار</Th>
                  <Th className="w-32">عملیات</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((person) => (
                  <tr key={person.id} className="transition hover:bg-surface-sunken">
                    <Td>
                      <Link
                        to={`/books?personId=${person.id}`}
                        className="text-sm text-content hover:text-primary hover:underline"
                      >
                        {person.fullName}
                      </Link>
                    </Td>
                    <Td className="field-ltr text-xs text-content-muted">
                      {person.latinName ?? '—'}
                    </Td>
                    <Td className="text-xs text-content-muted">{person.nationality ?? '—'}</Td>
                    <Td numeric className="text-xs">
                      <Badge tone={person.bookCount > 0 ? 'primary' : 'neutral'}>
                        {toPersianDigits(person.bookCount)}
                      </Badge>
                    </Td>
                    <Td>
                      {canManage ? (
                        <div className="flex gap-0.5">
                          <Button
                            size="sm" variant="ghost"
                            onClick={() => {
                              setEditing(person);
                              setForm({
                                fullName: person.fullName,
                                latinName: person.latinName ?? '',
                                nationality: person.nationality ?? '',
                                biography: '',
                              });
                              setErrors({});
                              setFormOpen(true);
                            }}
                            icon={<Pencil className="size-3.5" />}
                            aria-label={`ویرایش ${person.fullName}`}
                          />
                          <Button
                            size="sm" variant="ghost"
                            onClick={() => { setMergeSource(person); setMergeTargetId(null); }}
                            icon={<Merge className="size-3.5" />}
                            aria-label={`ادغام ${person.fullName} با رکورد دیگر`}
                          />
                          <Button
                            size="sm" variant="ghost"
                            onClick={() => setDeleteTarget(person)}
                            icon={<Trash2 className="size-3.5" />}
                            aria-label={`حذف ${person.fullName}`}
                            className="text-content-subtle hover:text-danger"
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-content-subtle">—</span>
                      )}
                    </Td>
                  </tr>
                ))}
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
            icon={<Users className="size-6" />}
            title="پدیدآورنده‌ای یافت نشد"
            description="پدیدآورندگان معمولاً هنگام ثبت کتاب خودکار ساخته می‌شوند."
            action={
              <Button variant="primary" onClick={() => navigate('/books/new')}>
                ثبت کتاب جدید
              </Button>
            }
          />
        )}
      </Card>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'ویرایش پدیدآورنده' : 'ثبت پدیدآورنده'}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>انصراف</Button>
            <Button
              variant="primary"
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={form.fullName.trim().length < 2}
            >
              ذخیره
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="نام و نام خانوادگی" required error={errors.fullName}>
            <Input
              value={form.fullName} autoFocus
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              invalid={!!errors.fullName}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="نام لاتین" hint="برای جستجوی منابع خارجی">
              <Input
                ltr value={form.latinName}
                onChange={(e) => setForm((f) => ({ ...f, latinName: e.target.value }))}
              />
            </Field>
            <Field label="ملیت">
              <Input
                value={form.nationality}
                onChange={(e) => setForm((f) => ({ ...f, nationality: e.target.value }))}
              />
            </Field>
          </div>
          <Field label="زندگی‌نامه">
            <Textarea
              value={form.biography}
              onChange={(e) => setForm((f) => ({ ...f, biography: e.target.value }))}
              rows={4}
            />
          </Field>
        </div>
      </Modal>

      {/* ── ادغام رکورد تکراری (قانون ۴۲) ──────────────────────────── */}
      <Modal
        open={!!mergeSource}
        onClose={() => setMergeSource(null)}
        title="ادغام پدیدآورنده تکراری"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setMergeSource(null)}>انصراف</Button>
            <Button
              variant="danger"
              onClick={() => merge.mutate()}
              loading={merge.isPending}
              disabled={!mergeTargetId}
            >
              ادغام کن
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-content-muted">
            همه آثار «{mergeSource?.fullName}» ({toPersianDigits(mergeSource?.bookCount ?? 0)} اثر)
            به رکورد مقصد منتقل می‌شوند و این رکورد حذف می‌گردد.
          </p>

          <Field label="رکورد مقصد (رکوردی که باقی می‌ماند)" required>
            <EntityPicker
              endpoint="/persons"
              value={mergeTargetId}
              valueLabel={mergeTargetLabel}
              onChange={(id, label) => { setMergeTargetId(id); setMergeTargetLabel(label); }}
              mapItem={(item: { id: string; fullName: string; bookCount: number }) => ({
                id: item.id,
                label: item.fullName,
                hint: `${toPersianDigits(item.bookCount)} اثر`,
              })}
              placeholder="جستجوی پدیدآورنده مقصد…"
            />
          </Field>

          <p className="rounded border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning-content">
            این عملیات برگشت‌پذیر نیست. پیش از ادغام مطمئن شوید هر دو رکورد واقعاً یک
            نفرند.
          </p>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title="حذف پدیدآورنده"
        confirmLabel="حذف کن"
        message={
          <>
            <p>«{deleteTarget?.fullName}» حذف می‌شود.</p>
            {deleteTarget && deleteTarget.bookCount > 0 ? (
              <p className="mt-2 rounded border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-danger-content">
                این پدیدآورنده {toPersianDigits(deleteTarget.bookCount)} اثر دارد. سرور
                اجازه حذفش را نمی‌دهد؛ به‌جای حذف، آن را با رکورد درست ادغام کنید.
              </p>
            ) : null}
          </>
        }
      />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  ناشران
// ═══════════════════════════════════════════════════════════════════════════

export function PublishersPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();
  const { values, setFilters, reset, hasActiveFilters } = useUrlFilters(DEFAULTS);

  const [searchInput, setSearchInput] = React.useState(values.q);
  const debounced = useDebounced(searchInput, 300);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Publisher | null>(null);
  const [form, setForm] = React.useState({ name: '', latinName: '', city: '', phone: '', email: '' });
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [deleteTarget, setDeleteTarget] = React.useState<Publisher | null>(null);

  React.useEffect(() => {
    if (debounced !== values.q) setFilters({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['publishers', values],
    queryFn: () =>
      api.get<Paginated<Publisher>>('/publishers', {
        q: values.q || undefined,
        page: values.page,
        pageSize: values.pageSize,
      }),
    placeholderData: (previous) => previous,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['publishers'] });
    void queryClient.invalidateQueries({ queryKey: ['books'] });
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        latinName: form.latinName.trim() || null,
        city: form.city.trim() || null,
        phone: form.phone.trim() || null,
        email: form.email.trim() || '',
      };
      return editing
        ? api.patch(`/publishers/${editing.id}`, payload)
        : api.post('/publishers', payload);
    },
    onSuccess: () => {
      toast.success(editing ? 'ناشر ویرایش شد' : 'ناشر ثبت شد');
      setFormOpen(false);
      setErrors({});
      invalidate();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.fieldErrors) setErrors(error.fieldErrors);
      toast.apiError(error, 'ذخیره انجام نشد');
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/publishers/${deleteTarget?.id}`),
    onSuccess: () => {
      toast.success('ناشر حذف شد');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (error) => toast.apiError(error, 'حذف انجام نشد'),
  });

  const canManage = can('publishers.manage');

  return (
    <>
      <PageHeader
        title="ناشران"
        description={data ? `${formatNumber(data.meta.total)} ناشر` : 'در حال بارگذاری…'}
        actions={
          canManage ? (
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null);
                setForm({ name: '', latinName: '', city: '', phone: '', email: '' });
                setErrors({});
                setFormOpen(true);
              }}
              icon={<Plus className="size-4" />}
            >
              ثبت ناشر
            </Button>
          ) : null
        }
      />

      <Card>
        <FilterBar
          search={searchInput}
          onSearchChange={setSearchInput}
          placeholder="نام ناشر…"
          onReset={hasActiveFilters ? () => { reset(); setSearchInput(''); } : undefined}
        />

        {isLoading ? (
          <TableSkeleton columns={4} />
        ) : data && data.data.length > 0 ? (
          <>
            <TableWrapper className={isFetching ? 'opacity-60 transition-opacity' : undefined}>
              <thead>
                <tr>
                  <Th>نام</Th>
                  <Th>شهر</Th>
                  <Th>تلفن</Th>
                  <Th numeric className="w-24">کتاب‌ها</Th>
                  <Th className="w-24">عملیات</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((publisher) => (
                  <tr key={publisher.id} className="transition hover:bg-surface-sunken">
                    <Td>
                      <Link
                        to={`/books?publisherId=${publisher.id}`}
                        className="text-sm text-content hover:text-primary hover:underline"
                      >
                        {publisher.name}
                      </Link>
                      {publisher.latinName ? (
                        <p className="field-ltr mt-0.5 text-xs text-content-muted">
                          {publisher.latinName}
                        </p>
                      ) : null}
                    </Td>
                    <Td className="text-xs text-content-muted">{publisher.city ?? '—'}</Td>
                    <Td className="field-ltr text-xs text-content-muted">
                      {publisher.phone ?? '—'}
                    </Td>
                    <Td numeric className="text-xs">
                      <Badge tone={publisher.bookCount > 0 ? 'primary' : 'neutral'}>
                        {toPersianDigits(publisher.bookCount)}
                      </Badge>
                    </Td>
                    <Td>
                      {canManage ? (
                        <div className="flex gap-0.5">
                          <Button
                            size="sm" variant="ghost"
                            onClick={() => {
                              setEditing(publisher);
                              setForm({
                                name: publisher.name,
                                latinName: publisher.latinName ?? '',
                                city: publisher.city ?? '',
                                phone: publisher.phone ?? '',
                                email: '',
                              });
                              setErrors({});
                              setFormOpen(true);
                            }}
                            icon={<Pencil className="size-3.5" />}
                            aria-label={`ویرایش ${publisher.name}`}
                          />
                          <Button
                            size="sm" variant="ghost"
                            onClick={() => setDeleteTarget(publisher)}
                            icon={<Trash2 className="size-3.5" />}
                            aria-label={`حذف ${publisher.name}`}
                            className="text-content-subtle hover:text-danger"
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-content-subtle">—</span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableWrapper>

            <Pagination
              meta={data.meta}
              onPageChange={(page) => setFilters({ page }, { resetPage: false })}
              onPageSizeChange={(pageSize) => setFilters({ pageSize })}
            />
          </>
        ) : (
          <EmptyState icon={<Landmark className="size-6" />} title="ناشری یافت نشد" />
        )}
      </Card>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'ویرایش ناشر' : 'ثبت ناشر'}
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="نام ناشر" required error={errors.name} className="sm:col-span-2">
            <Input
              value={form.name} autoFocus
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              invalid={!!errors.name}
            />
          </Field>
          <Field label="نام لاتین">
            <Input
              ltr value={form.latinName}
              onChange={(e) => setForm((f) => ({ ...f, latinName: e.target.value }))}
            />
          </Field>
          <Field label="شهر">
            <Input
              value={form.city}
              onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
            />
          </Field>
          <Field label="تلفن">
            <Input
              ltr value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </Field>
          <Field label="ایمیل" error={errors.email}>
            <Input
              type="email" ltr value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              invalid={!!errors.email}
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title="حذف ناشر"
        confirmLabel="حذف کن"
        message={
          <>
            <p>«{deleteTarget?.name}» حذف می‌شود.</p>
            {deleteTarget && deleteTarget.bookCount > 0 ? (
              <p className="mt-2 rounded border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-danger-content">
                این ناشر {toPersianDigits(deleteTarget.bookCount)} کتاب دارد و سرور اجازه
                حذفش را نمی‌دهد.
              </p>
            ) : null}
          </>
        }
      />
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  مجموعه‌ها
// ═══════════════════════════════════════════════════════════════════════════

export function SeriesPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();
  const { values, setFilters, reset, hasActiveFilters } = useUrlFilters(DEFAULTS);

  const [searchInput, setSearchInput] = React.useState(values.q);
  const debounced = useDebounced(searchInput, 300);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Series | null>(null);
  const [form, setForm] = React.useState({ title: '', description: '', totalPlanned: '' });
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [deleteTarget, setDeleteTarget] = React.useState<Series | null>(null);

  React.useEffect(() => {
    if (debounced !== values.q) setFilters({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['series', values],
    queryFn: () =>
      api.get<Paginated<Series>>('/series', {
        q: values.q || undefined,
        page: values.page,
        pageSize: values.pageSize,
      }),
    placeholderData: (previous) => previous,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['series'] });
    void queryClient.invalidateQueries({ queryKey: ['books'] });
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        totalPlanned: form.totalPlanned ? Number(form.totalPlanned) : null,
      };
      return editing ? api.patch(`/series/${editing.id}`, payload) : api.post('/series', payload);
    },
    onSuccess: () => {
      toast.success(editing ? 'مجموعه ویرایش شد' : 'مجموعه ثبت شد');
      setFormOpen(false);
      setErrors({});
      invalidate();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.fieldErrors) setErrors(error.fieldErrors);
      toast.apiError(error, 'ذخیره انجام نشد');
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/series/${deleteTarget?.id}`),
    onSuccess: () => {
      toast.success('مجموعه حذف شد');
      setDeleteTarget(null);
      invalidate();
    },
    onError: (error) => toast.apiError(error, 'حذف انجام نشد'),
  });

  const canManage = can('books.edit');

  return (
    <>
      <PageHeader
        title="مجموعه‌ها"
        description={data ? `${formatNumber(data.meta.total)} مجموعه` : 'در حال بارگذاری…'}
        actions={
          canManage ? (
            <Button
              variant="primary"
              onClick={() => {
                setEditing(null);
                setForm({ title: '', description: '', totalPlanned: '' });
                setErrors({});
                setFormOpen(true);
              }}
              icon={<Plus className="size-4" />}
            >
              ثبت مجموعه
            </Button>
          ) : null
        }
      />

      <Card>
        <FilterBar
          search={searchInput}
          onSearchChange={setSearchInput}
          placeholder="عنوان مجموعه…"
          onReset={hasActiveFilters ? () => { reset(); setSearchInput(''); } : undefined}
        />

        {isLoading ? (
          <TableSkeleton columns={4} />
        ) : data && data.data.length > 0 ? (
          <>
            <TableWrapper className={isFetching ? 'opacity-60 transition-opacity' : undefined}>
              <thead>
                <tr>
                  <Th>عنوان</Th>
                  <Th>توضیح</Th>
                  <Th numeric className="w-32">جلدها</Th>
                  <Th className="w-24">عملیات</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((series) => (
                  <tr key={series.id} className="transition hover:bg-surface-sunken">
                    <Td>
                      <Link
                        to={`/books?seriesId=${series.id}`}
                        className="text-sm text-content hover:text-primary hover:underline"
                      >
                        {series.title}
                      </Link>
                    </Td>
                    <Td className="text-xs text-content-muted">
                      {series.description ? (
                        <span className="line-clamp-1">{series.description}</span>
                      ) : (
                        '—'
                      )}
                    </Td>
                    <Td numeric className="text-xs">
                      <Badge tone={series.bookCount > 0 ? 'primary' : 'neutral'}>
                        {toPersianDigits(series.bookCount)}
                        {series.totalPlanned
                          ? ` از ${toPersianDigits(series.totalPlanned)}`
                          : ''}
                      </Badge>
                    </Td>
                    <Td>
                      {canManage ? (
                        <div className="flex gap-0.5">
                          <Button
                            size="sm" variant="ghost"
                            onClick={() => {
                              setEditing(series);
                              setForm({
                                title: series.title,
                                description: series.description ?? '',
                                totalPlanned: series.totalPlanned?.toString() ?? '',
                              });
                              setErrors({});
                              setFormOpen(true);
                            }}
                            icon={<Pencil className="size-3.5" />}
                            aria-label={`ویرایش ${series.title}`}
                          />
                          <Button
                            size="sm" variant="ghost"
                            onClick={() => setDeleteTarget(series)}
                            icon={<Trash2 className="size-3.5" />}
                            aria-label={`حذف ${series.title}`}
                            className="text-content-subtle hover:text-danger"
                          />
                        </div>
                      ) : (
                        <span className="text-xs text-content-subtle">—</span>
                      )}
                    </Td>
                  </tr>
                ))}
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
            icon={<Tags className="size-6" />}
            title="مجموعه‌ای تعریف نشده"
            description="مجموعه برای گروه‌بندی کتاب‌های یک سری است؛ مثل «هری پاتر» یا «تاریخ ایران»."
          />
        )}
      </Card>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'ویرایش مجموعه' : 'ثبت مجموعه'}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)}>انصراف</Button>
            <Button
              variant="primary"
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={!form.title.trim()}
            >
              ذخیره
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="عنوان مجموعه" required error={errors.title}>
            <Input
              value={form.title} autoFocus
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              invalid={!!errors.title}
            />
          </Field>
          <Field label="توضیح">
            <Textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
            />
          </Field>
          <Field
            label="تعداد کل جلدهای برنامه‌ریزی‌شده"
            hint="اگر می‌دانید مجموعه چند جلد خواهد بود، اینجا بنویسید تا کمبودها معلوم شود."
          >
            <Input
              type="number" min={1} ltr value={form.totalPlanned}
              onChange={(e) => setForm((f) => ({ ...f, totalPlanned: e.target.value }))}
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title="حذف مجموعه"
        confirmLabel="حذف کن"
        message={
          <>
            <p>«{deleteTarget?.title}» حذف می‌شود.</p>
            {deleteTarget && deleteTarget.bookCount > 0 ? (
              <p className="mt-2 rounded border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-danger-content">
                {toPersianDigits(deleteTarget.bookCount)} کتاب به این مجموعه وصل‌اند.
              </p>
            ) : null}
          </>
        }
      />
    </>
  );
}
