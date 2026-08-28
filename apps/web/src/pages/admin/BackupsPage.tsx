import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArchiveRestore, Download, HardDrive, Plus, Trash2, TriangleAlert,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, Input,
  Modal, Skeleton, TableWrapper, Td, Th,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { formatDateTime, formatFileSize, toPersianDigits } from '@/lib/format';

interface BackupRecord {
  id: string;
  fileName: string | null;
  fileKey: string | null;
  kind: string;
  status: string;
  sizeBytes: number | null;
  sizeLabel: string | null;
  checksum: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  createdByLabel: string | null;
  fileExists: boolean;
}

/**
 * پشتیبان‌گیری و بازیابی (قوانین ۶۱، ۶۲، ۶۳).
 *
 * ── دکمه پشتیبان واقعاً پشتیبان می‌گیرد (قانون ۱۳۴) ─────────────────────
 * سرور `pg_dump` واقعی اجرا می‌کند، فایل فشرده می‌سازد، checksum می‌گیرد
 * و اندازه واقعی فایل روی دیسک را برمی‌گرداند. دکمه دانلود همان فایل را
 * می‌دهد.
 *
 * ── چرا بازیابی تأیید متنی می‌خواهد ─────────────────────────────────────
 * بازیابی، کل داده فعلی را بازنویسی می‌کند و برگشت‌پذیر نیست. یک دیالوگ
 * «مطمئنید؟» با کلیک ناخواسته رد می‌شود؛ تایپ کردن عبارت RESTORE نمی‌شود.
 * سرور هم مستقل از رابط کاربری همین عبارت را طلب می‌کند.
 *
 * ── پشتیبان ایمنی پیش از بازیابی ────────────────────────────────────────
 * سرور پیش از بازنویسی، خودکار از وضعیت فعلی پشتیبان می‌گیرد. اگر بازیابی
 * اشتباه بود، راه برگشت وجود دارد.
 */
export function BackupsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [restoreTarget, setRestoreTarget] = React.useState<BackupRecord | null>(null);
  const [confirmation, setConfirmation] = React.useState('');
  const [deleteTarget, setDeleteTarget] = React.useState<BackupRecord | null>(null);
  const [downloading, setDownloading] = React.useState<string | null>(null);

  const { data: backups, isLoading } = useQuery({
    queryKey: ['backups'],
    queryFn: () => api.get<BackupRecord[]>('/backups'),
  });

  const create = useMutation({
    mutationFn: () => api.post<{ id: string; fileName: string; sizeBytes: number }>('/backups'),
    onSuccess: (result) => {
      toast.success(
        'نسخه پشتیبان ساخته شد',
        `${result.fileName} — ${formatFileSize(result.sizeBytes)}`,
      );
      void queryClient.invalidateQueries({ queryKey: ['backups'] });
    },
    onError: (error) => toast.apiError(error, 'ساخت پشتیبان انجام نشد'),
  });

  const restore = useMutation({
    mutationFn: () =>
      api.post<{ restored: boolean; safetyBackupId: string }>(
        `/backups/${restoreTarget?.id}/restore`,
        { confirmation },
      ),
    onSuccess: () => {
      toast.success(
        'بازیابی انجام شد',
        'پیش از بازیابی، یک پشتیبان ایمنی از وضعیت قبلی گرفته شد.',
      );
      setRestoreTarget(null);
      setConfirmation('');
      // کل داده عوض شده؛ هیچ چیزی در Cache معتبر نیست
      queryClient.clear();
      window.location.href = '/';
    },
    onError: (error) => {
      if (error instanceof ApiError) toast.error('بازیابی انجام نشد', error.message);
      else toast.apiError(error, 'بازیابی انجام نشد');
    },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/backups/${deleteTarget?.id}`),
    onSuccess: () => {
      toast.success('نسخه پشتیبان حذف شد');
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['backups'] });
    },
    onError: (error) => toast.apiError(error, 'حذف پشتیبان انجام نشد'),
  });

  const download = async (backup: BackupRecord) => {
    setDownloading(backup.id);
    try {
      await api.download(`/backups/${backup.id}/download`);
      toast.success('دانلود آغاز شد', 'فایل را در جایی خارج از این سرور نگه دارید.');
    } catch (error) {
      toast.apiError(error, 'دانلود پشتیبان انجام نشد');
    } finally {
      setDownloading(null);
    }
  };

  const totalSize = (backups ?? []).reduce((sum, b) => sum + (b.sizeBytes ?? 0), 0);

  return (
    <>
      <PageHeader
        title="پشتیبان‌گیری"
        description={
          backups
            ? `${toPersianDigits(backups.length)} نسخه — مجموعاً ${formatFileSize(totalSize)}`
            : 'در حال بارگذاری…'
        }
        actions={
          <Button
            variant="primary"
            onClick={() => create.mutate()}
            loading={create.isPending}
            icon={<Plus className="size-4" />}
          >
            ساخت پشتیبان جدید
          </Button>
        }
      />

      <div className="mb-4 flex items-start gap-2 rounded border border-warning/30 bg-warning-soft px-3 py-2 text-xs leading-relaxed text-warning-content">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <p>
          پشتیبانی که فقط روی همین سرور بماند، در برابر خرابی دیسک یا سرقت دستگاه بی‌فایده
          است. فایل‌ها را به‌طور منظم دانلود کنید و در جای دیگری (هارد خارجی یا فضای ابری)
          نگه دارید.
        </p>
      </div>

      <Card>
        <CardHeader
          title="نسخه‌های پشتیبان"
          description="جدیدترین ابتدا"
        />

        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-12" />)}
          </div>
        ) : backups && backups.length > 0 ? (
          <TableWrapper>
            <thead>
              <tr>
                <Th>نام فایل</Th>
                <Th className="w-32">نوع</Th>
                <Th className="w-28">حجم</Th>
                <Th className="w-44">تاریخ</Th>
                <Th className="w-28">وضعیت</Th>
                <Th className="w-48">عملیات</Th>
              </tr>
            </thead>
            <tbody>
              {backups.map((backup) => (
                <tr key={backup.id} className="transition hover:bg-surface-sunken">
                  <Td>
                    <p className="field-ltr truncate text-xs font-medium text-content">
                      {backup.fileName ?? '—'}
                    </p>
                    {backup.checksum ? (
                      <p
                        className="field-ltr mt-0.5 truncate font-mono text-2xs text-content-subtle"
                        title={backup.checksum}
                      >
                        {backup.checksum.slice(0, 16)}…
                      </p>
                    ) : null}
                    {backup.errorMessage ? (
                      <p className="mt-0.5 text-2xs text-danger">{backup.errorMessage}</p>
                    ) : null}
                  </Td>
                  <Td className="text-xs text-content-muted">
                    {backup.kind === 'MANUAL'
                      ? 'دستی'
                      : backup.kind === 'SCHEDULED'
                        ? 'خودکار'
                        : backup.kind === 'PRE_RESTORE'
                          ? 'ایمنی پیش از بازیابی'
                          : backup.kind}
                  </Td>
                  <Td className="text-xs text-content-muted">
                    {backup.sizeLabel ?? (backup.sizeBytes ? formatFileSize(backup.sizeBytes) : '—')}
                  </Td>
                  <Td className="text-xs text-content-muted">
                    {formatDateTime(backup.completedAt ?? backup.createdAt)}
                    {backup.createdByLabel ? (
                      <span className="block text-2xs text-content-subtle">
                        {backup.createdByLabel}
                      </span>
                    ) : null}
                  </Td>
                  <Td>
                    {backup.status === 'COMPLETED' && backup.fileExists ? (
                      <Badge tone="success">آماده</Badge>
                    ) : backup.status === 'COMPLETED' ? (
                      <Badge tone="danger">فایل موجود نیست</Badge>
                    ) : backup.status === 'RUNNING' ? (
                      <Badge tone="info">در حال اجرا</Badge>
                    ) : (
                      <Badge tone="danger">ناموفق</Badge>
                    )}
                  </Td>
                  <Td>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        onClick={() => void download(backup)}
                        loading={downloading === backup.id}
                        disabled={!backup.fileExists}
                        icon={<Download className="size-3.5" />}
                      >
                        دانلود
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setRestoreTarget(backup); setConfirmation(''); }}
                        disabled={!backup.fileExists}
                        icon={<ArchiveRestore className="size-3.5" />}
                        aria-label={`بازیابی از ${backup.fileName}`}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteTarget(backup)}
                        icon={<Trash2 className="size-3.5" />}
                        aria-label={`حذف ${backup.fileName}`}
                        className="text-content-subtle hover:text-danger"
                      />
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrapper>
        ) : (
          <EmptyState
            icon={<HardDrive className="size-6" />}
            title="هنوز پشتیبانی گرفته نشده"
            description="اولین نسخه پشتیبان را بسازید و برنامه‌ای منظم برای آن تعیین کنید."
            action={
              <Button variant="primary" onClick={() => create.mutate()} loading={create.isPending}>
                ساخت پشتیبان
              </Button>
            }
          />
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader title="پشتیبان‌گیری خودکار" />
        <div className="p-4 text-xs leading-relaxed text-content-muted">
          <p>
            زمان‌بندی پشتیبان‌گیری خودکار و تعداد نسخه‌های نگه‌داشته‌شده در{' '}
            <a href="/settings" className="text-primary hover:underline">
              تنظیمات ← پشتیبان‌گیری
            </a>{' '}
            تعیین می‌شود. نسخه‌های قدیمی‌تر از سقف تعیین‌شده خودکار حذف می‌شوند.
          </p>
        </div>
      </Card>

      {/* ── بازیابی ─────────────────────────────────────────────────── */}
      <Modal
        open={!!restoreTarget}
        onClose={() => setRestoreTarget(null)}
        title="بازیابی از نسخه پشتیبان"
        description={restoreTarget?.fileName ?? undefined}
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRestoreTarget(null)} disabled={restore.isPending}>
              انصراف
            </Button>
            <Button
              variant="danger"
              onClick={() => restore.mutate()}
              loading={restore.isPending}
              disabled={confirmation !== 'RESTORE'}
            >
              بازیابی و بازنویسی داده‌ها
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded border border-danger/30 bg-danger-soft p-3 text-sm leading-relaxed text-danger-content">
            <p className="font-medium">این عملیات برگشت‌پذیر نیست</p>
            <p className="mt-1">
              تمام داده‌های فعلی — کتاب‌ها، اعضا، امانت‌ها و جریمه‌ها — با محتوای این
              فایل جایگزین می‌شوند. هر چیزی که پس از{' '}
              {formatDateTime(restoreTarget?.completedAt ?? restoreTarget?.createdAt)} ثبت
              شده، از بین می‌رود.
            </p>
          </div>

          <div className="rounded border border-info/30 bg-info-soft p-3 text-xs text-info-content">
            پیش از بازنویسی، سامانه خودکار یک پشتیبان از وضعیت فعلی می‌گیرد تا اگر
            بازیابی اشتباه بود، راه برگشت وجود داشته باشد.
          </div>

          <Field
            label="برای تأیید، عبارت RESTORE را وارد کنید"
            required
            hint="با حروف بزرگ انگلیسی و دقیقاً همین عبارت."
          >
            <Input
              ltr
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder="RESTORE"
              autoFocus
              invalid={confirmation.length > 0 && confirmation !== 'RESTORE'}
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title="حذف نسخه پشتیبان"
        confirmLabel="حذف کن"
        message={
          <>
            <p>
              فایل «{deleteTarget?.fileName}» از دیسک حذف می‌شود و دیگر قابل بازیابی
              نخواهد بود.
            </p>
            <p className="mt-2 rounded border border-warning/30 bg-warning-soft px-2.5 py-1.5 text-warning-content">
              اگر نسخه دیگری از این پشتیبان جای دیگری ندارید، ابتدا آن را دانلود کنید.
            </p>
          </>
        }
      />
    </>
  );
}
