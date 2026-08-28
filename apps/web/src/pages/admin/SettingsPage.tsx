import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Hash, Info, Save, Settings as SettingsIcon } from 'lucide-react';
import { SETTING_GROUPS, SETTING_META, type SettingMeta } from '@darin/shared';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import {
  Badge, Button, Card, CardHeader, Field, Input, Select, Skeleton, cn,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { formatMoney, toPersianDigits } from '@/lib/format';

interface SettingsResponse {
  settings: Record<string, unknown>;
  groups: Record<string, { label: string; keys: string[] }>;
}

interface NumberingRule {
  key: string; label: string; pattern: string; prefix: string | null;
  currentValue: number; resetPolicy: string; isActive: boolean;
  target: string; preview?: string;
}

/**
 * تنظیمات کتابخانه (قوانین ۵۳، ۵۴، ۵۵).
 *
 * ── هیچ قانونی در کد نیست ───────────────────────────────────────────────
 * مدت امانت، سقف جریمه، مهلت رزرو و بقیه قوانین همه از اینجا خوانده
 * می‌شوند. تغییر آنها نیاز به تغییر کد یا راه‌اندازی مجدد ندارد.
 *
 * ── چرا فرم از داده ساخته می‌شود ────────────────────────────────────────
 * فهرست تنظیمات، گروه‌بندی و نوع هر فیلد در بسته مشترک تعریف شده و بین
 * سرور و رابط کاربری یکی است. افزودن یک تنظیم جدید فقط یک کلید در آن
 * فهرست است.
 *
 * ── ذخیره گروهی و اتمیک ─────────────────────────────────────────────────
 * همه تغییرات با یک درخواست و در یک تراکنش ذخیره می‌شوند تا سیستم با
 * ترکیبی نیمه‌کاره از قوانین مواجه نشود.
 */
export function SettingsPage() {
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();
  const canEdit = can('settings.manage');

  const [draft, setDraft] = React.useState<Record<string, unknown>>({});
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [activeGroup, setActiveGroup] = React.useState<string>('library');

  const { data, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<SettingsResponse>('/settings'),
  });

  const { data: numbering } = useQuery({
    queryKey: ['settings', 'numbering'],
    queryFn: () => api.get<NumberingRule[]>('/settings/numbering'),
    enabled: canEdit,
  });

  const save = useMutation({
    mutationFn: () => api.put<SettingsResponse>('/settings', draft),
    onSuccess: () => {
      toast.success('تنظیمات ذخیره شد', 'قوانین جدید بی‌درنگ اعمال می‌شوند.');
      setDraft({});
      setErrors({});
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      // قوانین امانت روی محاسبه صلاحیت اثر می‌گذارند
      void queryClient.invalidateQueries({ queryKey: ['loans'] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.fieldErrors) setErrors(error.fieldErrors);
      toast.apiError(error, 'ذخیره تنظیمات انجام نشد');
    },
  });

  const value = (key: string): unknown =>
    key in draft ? draft[key] : data?.settings[key];

  const setValue = (key: string, next: unknown) => {
    setDraft((d) => ({ ...d, [key]: next }));
    setErrors((e) => {
      if (!e[key]) return e;
      const copy = { ...e };
      delete copy[key];
      return copy;
    });
  };

  const dirtyCount = Object.keys(draft).length;
  const groups = Object.entries(SETTING_GROUPS).filter(([key]) => key !== 'system');

  if (isLoading) {
    return (
      <>
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-96" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="تنظیمات"
        description="قوانین امانت، جریمه، رزرو و اطلاعات کتابخانه"
        actions={
          canEdit ? (
            <>
              {dirtyCount > 0 ? (
                <>
                  <Badge tone="warning">
                    {toPersianDigits(dirtyCount)} تغییر ذخیره‌نشده
                  </Badge>
                  <Button variant="ghost" onClick={() => { setDraft({}); setErrors({}); }}>
                    لغو تغییرات
                  </Button>
                </>
              ) : null}
              <Button
                variant="primary"
                onClick={() => save.mutate()}
                loading={save.isPending}
                disabled={dirtyCount === 0}
                icon={<Save className="size-4" />}
              >
                ذخیره تغییرات
              </Button>
            </>
          ) : null
        }
      />

      {!canEdit ? (
        <div className="mb-4 flex items-start gap-2 rounded border border-info/30 bg-info-soft px-3 py-2 text-sm text-info-content">
          <Info className="mt-0.5 size-4 shrink-0" />
          شما فقط اجازه مشاهده تنظیمات را دارید. برای تغییر آنها به مجوز «مدیریت تنظیمات»
          نیاز است.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-4">
        {/* ── فهرست گروه‌ها ──────────────────────────────────────────── */}
        <Card className="lg:col-span-1">
          <CardHeader title="بخش‌ها" />
          <nav className="p-2">
            <ul className="space-y-0.5">
              {groups.map(([key, group]) => (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => setActiveGroup(key)}
                    className={cn(
                      'flex w-full items-center justify-between rounded px-2.5 py-2 text-start text-sm transition',
                      activeGroup === key
                        ? 'bg-primary-soft font-medium text-primary'
                        : 'text-content-muted hover:bg-surface-sunken hover:text-content',
                    )}
                  >
                    {group.label}
                    {group.keys.some((k) => k in draft) ? (
                      <span className="size-1.5 rounded-full bg-warning" aria-label="تغییر ذخیره‌نشده" />
                    ) : null}
                  </button>
                </li>
              ))}
              {canEdit ? (
                <li>
                  <button
                    type="button"
                    onClick={() => setActiveGroup('numbering')}
                    className={cn(
                      'flex w-full items-center gap-2 rounded px-2.5 py-2 text-start text-sm transition',
                      activeGroup === 'numbering'
                        ? 'bg-primary-soft font-medium text-primary'
                        : 'text-content-muted hover:bg-surface-sunken hover:text-content',
                    )}
                  >
                    <Hash className="size-3.5" /> الگوهای شماره‌گذاری
                  </button>
                </li>
              ) : null}
            </ul>
          </nav>
        </Card>

        {/* ── فیلدهای گروه فعال ─────────────────────────────────────── */}
        <div className="lg:col-span-3">
          {activeGroup === 'numbering' ? (
            <NumberingCard rules={numbering ?? []} />
          ) : (
            <Card>
              <CardHeader
                title={SETTING_GROUPS[activeGroup]?.label ?? 'تنظیمات'}
                action={<SettingsIcon className="size-4 text-content-subtle" />}
              />
              <div className="grid gap-4 p-4 sm:grid-cols-2">
                {(SETTING_GROUPS[activeGroup]?.keys ?? []).map((key) => {
                  const meta = SETTING_META[key];
                  if (!meta) return null;
                  return (
                    <SettingInput
                      key={key}
                      settingKey={key}
                      meta={meta}
                      value={value(key)}
                      onChange={(next) => setValue(key, next)}
                      error={errors[key]}
                      disabled={!canEdit}
                      dirty={key in draft}
                    />
                  );
                })}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function SettingInput({
  settingKey, meta, value, onChange, error, disabled, dirty,
}: {
  settingKey: string;
  meta: SettingMeta;
  value: unknown;
  onChange: (next: unknown) => void;
  error?: string[];
  disabled?: boolean;
  dirty?: boolean;
}) {
  const hint =
    meta.type === 'money' && typeof value === 'number' && value > 0
      ? `${meta.hint ? `${meta.hint} — ` : ''}${formatMoney(value)}`
      : meta.hint;

  if (meta.type === 'boolean') {
    return (
      <div className={cn('sm:col-span-2', dirty && 'rounded ring-2 ring-warning/30')}>
        <label className="flex cursor-pointer items-start gap-2.5 rounded border border-border bg-surface-sunken p-3">
          <input
            type="checkbox"
            checked={value === true}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
            className="mt-0.5 size-4 rounded border-border-strong text-primary focus:ring-primary/30"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium text-content">{meta.label}</span>
            {meta.hint ? (
              <span className="mt-0.5 block text-xs text-content-muted">{meta.hint}</span>
            ) : null}
          </span>
        </label>
      </div>
    );
  }

  if (meta.type === 'multiselect') {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <Field
        label={meta.label}
        hint={meta.hint}
        error={error}
        className={cn('sm:col-span-2', dirty && 'rounded ring-2 ring-warning/30')}
      >
        <div className="flex flex-wrap gap-3 rounded border border-border bg-surface p-3">
          {(meta.options ?? []).map((option) => (
            <label
              key={option.value}
              className="flex cursor-pointer items-center gap-2 text-sm text-content-muted"
            >
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                disabled={disabled}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...selected, option.value]
                      : selected.filter((v) => v !== option.value),
                  )
                }
                className="size-4 rounded border-border-strong text-primary focus:ring-primary/30"
              />
              {option.label}
            </label>
          ))}
        </div>
      </Field>
    );
  }

  if (meta.type === 'select') {
    return (
      <Field
        label={meta.label}
        hint={meta.hint}
        error={error}
        className={cn(dirty && 'rounded ring-2 ring-warning/30')}
      >
        <Select
          value={String(value ?? '')}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {(meta.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </Select>
      </Field>
    );
  }

  const numeric = meta.type === 'number' || meta.type === 'money';

  return (
    <Field
      label={meta.label}
      hint={hint}
      error={error}
      className={cn(dirty && 'rounded ring-2 ring-warning/30')}
    >
      <Input
        type={numeric ? 'number' : 'text'}
        ltr={numeric}
        min={meta.min}
        max={meta.max}
        value={String(value ?? '')}
        disabled={disabled}
        invalid={!!error}
        onChange={(e) => onChange(numeric ? Number(e.target.value) : e.target.value)}
        suffix={
          meta.unit ? (
            <span className="text-2xs text-content-subtle">{meta.unit}</span>
          ) : meta.type === 'money' ? (
            <span className="text-2xs text-content-subtle">تومان</span>
          ) : undefined
        }
        aria-describedby={`${settingKey}-hint`}
      />
    </Field>
  );
}

/**
 * الگوهای شماره‌گذاری (قوانین ۷، ۸، ۹).
 *
 * تغییر الگو فقط روی شماره‌های **بعدی** اثر دارد؛ شماره‌های تخصیص‌یافته
 * دست‌نخورده می‌مانند. این نکته صریحاً نوشته شده چون سوءتفاهم درباره‌اش
 * می‌تواند به تغییر بی‌محابای الگو و بی‌نظمی شماره‌ها منجر شود.
 */
function NumberingCard({ rules }: { rules: NumberingRule[] }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});

  const update = useMutation({
    mutationFn: ({ key, pattern }: { key: string; pattern: string }) =>
      api.put(`/settings/numbering/${key}`, { pattern }),
    onSuccess: (_, variables) => {
      toast.success('الگوی شماره‌گذاری به‌روز شد');
      setDrafts((d) => {
        const next = { ...d };
        delete next[variables.key];
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: ['settings', 'numbering'] });
      void queryClient.invalidateQueries({ queryKey: ['copies', 'next-numbers'] });
    },
    onError: (error) => toast.apiError(error, 'به‌روزرسانی الگو انجام نشد'),
  });

  return (
    <Card>
      <CardHeader
        title="الگوهای شماره‌گذاری"
        description="شماره ثبت، بارکد، کد عضویت و شماره امانت"
      />

      <div className="border-b border-border bg-info-soft px-4 py-3 text-xs leading-relaxed text-info-content">
        <p className="font-medium">نشانه‌های قابل استفاده در الگو</p>
        <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
          <li><code className="font-mono">{'{SEQ:6}'}</code> — شماره ترتیبی با ۶ رقم</li>
          <li><code className="font-mono">{'{YEAR}'}</code> — سال شمسی چهاررقمی</li>
          <li><code className="font-mono">{'{YY}'}</code> — دو رقم آخر سال شمسی</li>
          <li><code className="font-mono">{'{MONTH}'}</code> — ماه شمسی دو رقمی</li>
          <li><code className="font-mono">{'{PREFIX}'}</code> — پیشوند تعریف‌شده</li>
          <li><code className="font-mono">{'{EAN}'}</code> — رقم کنترل استاندارد EAN-13</li>
        </ul>
        <p className="mt-2 opacity-90">
          تغییر الگو فقط روی شماره‌های بعدی اثر می‌گذارد؛ شماره‌های تخصیص‌یافته
          تغییر نمی‌کنند.
        </p>
      </div>

      <ul className="divide-y divide-border">
        {rules.map((rule) => {
          const draft = drafts[rule.key];
          const changed = draft !== undefined && draft !== rule.pattern;
          return (
            <li key={rule.key} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-content">{rule.label}</p>
                  <p className="mt-0.5 text-xs text-content-muted">
                    شماره فعلی: {toPersianDigits(rule.currentValue)}
                    {rule.preview ? (
                      <>
                        {' · '}شماره بعدی:{' '}
                        <span className="font-mono text-content" dir="ltr">{rule.preview}</span>
                      </>
                    ) : null}
                  </p>
                </div>
                <Badge tone={rule.isActive ? 'success' : 'neutral'}>
                  {rule.isActive ? 'فعال' : 'غیرفعال'}
                </Badge>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <div className="min-w-[14rem] flex-1">
                  <Input
                    ltr
                    value={draft ?? rule.pattern}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [rule.key]: e.target.value }))
                    }
                    aria-label={`الگوی ${rule.label}`}
                    className="font-mono text-xs"
                  />
                </div>
                <Button
                  onClick={() => update.mutate({ key: rule.key, pattern: draft ?? rule.pattern })}
                  loading={update.isPending && update.variables?.key === rule.key}
                  disabled={!changed}
                >
                  ذخیره الگو
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
