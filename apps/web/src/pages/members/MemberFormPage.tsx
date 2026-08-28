import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, Save } from 'lucide-react';
import { MEMBER_STATUS } from '@darin/shared';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import {
  Button, Card, CardHeader, Field, Input, Select, Skeleton, Textarea,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { toDateInputValue, toPersianDigits } from '@/lib/format';

interface MembershipType {
  id: string; name: string; maxLoans: number | null; loanDays: number | null;
  durationMonths: number | null; membershipFee: string | null;
}

interface FormState {
  memberCode: string;
  firstName: string; lastName: string;
  nationalId: string; phone: string; mobile: string; email: string;
  address: string; postalCode: string; birthDate: string; gender: string;
  membershipTypeId: string; status: string; expiresAt: string;
  referrerName: string; emergencyContactName: string; emergencyContactPhone: string;
  note: string;
}

const EMPTY: FormState = {
  memberCode: '',
  firstName: '', lastName: '',
  nationalId: '', phone: '', mobile: '', email: '',
  address: '', postalCode: '', birthDate: '', gender: 'UNSPECIFIED',
  membershipTypeId: '', status: 'ACTIVE', expiresAt: '',
  referrerName: '', emergencyContactName: '', emergencyContactPhone: '',
  note: '',
};

/**
 * ثبت و ویرایش عضو (قوانین ۱۳، ۱۴).
 *
 * ── کد عضویت خودکار است ─────────────────────────────────────────────────
 * خالی گذاشتن فیلد یعنی سیستم شماره بعدی را با قفل ردیف تخصیص دهد. کتابدار
 * فقط وقتی دستی وارد می‌کند که کارت‌های چاپ‌شده قبلی را ادامه می‌دهد.
 *
 * ── اعتبارسنجی کد ملی ────────────────────────────────────────────────────
 * سرور رقم کنترل کد ملی ایرانی را بررسی می‌کند. اینجا هم همان بررسی تکرار
 * می‌شود تا کاربر پیش از ارسال فرم متوجه اشتباه تایپی شود.
 */
export function MemberFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});

  const { data: types } = useQuery({
    queryKey: ['members', 'membership-types'],
    queryFn: () => api.get<MembershipType[]>('/members/membership-types'),
    staleTime: 5 * 60_000,
  });

  const { data: existing, isLoading } = useQuery({
    queryKey: ['members', id],
    queryFn: () => api.get<Record<string, unknown>>(`/members/${id}`),
    enabled: isEdit,
  });

  React.useEffect(() => {
    if (!existing) return;
    const m = existing as unknown as {
      memberCode: string; firstName: string; lastName: string;
      nationalId: string | null; phone: string | null; mobile: string | null; email: string | null;
      address: string | null; postalCode: string | null; birthDate: string | null; gender: string;
      status: string; expiresAt: string | null;
      referrerName: string | null; emergencyContactName: string | null;
      emergencyContactPhone: string | null; note: string | null;
      membershipType: { id: string } | null;
    };
    setForm({
      memberCode: m.memberCode,
      firstName: m.firstName, lastName: m.lastName,
      nationalId: m.nationalId ?? '', phone: m.phone ?? '', mobile: m.mobile ?? '',
      email: m.email ?? '', address: m.address ?? '', postalCode: m.postalCode ?? '',
      birthDate: toDateInputValue(m.birthDate), gender: m.gender,
      membershipTypeId: m.membershipType?.id ?? '', status: m.status,
      expiresAt: toDateInputValue(m.expiresAt),
      referrerName: m.referrerName ?? '',
      emergencyContactName: m.emergencyContactName ?? '',
      emergencyContactPhone: m.emergencyContactPhone ?? '',
      note: m.note ?? '',
    });
  }, [existing]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => {
      if (!e[key as string]) return e;
      const next = { ...e };
      delete next[key as string];
      return next;
    });
  };

  const selectedType = types?.find((t) => t.id === form.membershipTypeId);
  const nationalIdInvalid =
    form.nationalId.trim().length > 0 && !isValidIranianNationalId(form.nationalId);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        // کد خالی یعنی «خودکار تخصیص بده»
        memberCode: form.memberCode.trim() || undefined,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        nationalId: form.nationalId.trim() || null,
        phone: form.phone.trim() || null,
        mobile: form.mobile.trim() || null,
        email: form.email.trim() || '',
        address: form.address.trim() || null,
        postalCode: form.postalCode.trim() || null,
        // تاریخ به شکل ISO میلادی ارسال می‌شود؛ نمایش شمسی فقط در رابط است
        birthDate: form.birthDate ? new Date(form.birthDate).toISOString() : null,
        gender: form.gender,
        membershipTypeId: form.membershipTypeId || null,
        status: form.status,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
        referrerName: form.referrerName.trim() || null,
        emergencyContactName: form.emergencyContactName.trim() || null,
        emergencyContactPhone: form.emergencyContactPhone.trim() || null,
        note: form.note.trim() || null,
      };

      return isEdit
        ? api.patch<{ id: string }>(`/members/${id}`, payload)
        : api.post<{ id: string }>('/members', payload);
    },
    onSuccess: (member) => {
      toast.success(isEdit ? 'اطلاعات عضو ویرایش شد' : 'عضو ثبت شد');
      void queryClient.invalidateQueries({ queryKey: ['members'] });
      navigate(`/members/${member.id}`);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.fieldErrors) setErrors(error.fieldErrors);
      toast.apiError(error, isEdit ? 'ویرایش انجام نشد' : 'ثبت عضو انجام نشد');
    },
  });

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const next: Record<string, string[]> = {};
    if (!form.firstName.trim()) next.firstName = ['نام الزامی است.'];
    if (!form.lastName.trim()) next.lastName = ['نام خانوادگی الزامی است.'];
    if (nationalIdInvalid) next.nationalId = ['کد ملی معتبر نیست. رقم کنترل مطابقت ندارد.'];
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      next.email = ['ایمیل معتبر نیست.'];
    }
    setErrors(next);
    if (Object.keys(next).length > 0) {
      toast.error('فرم کامل نیست', 'فیلدهای مشخص‌شده را بررسی کنید.');
      return;
    }
    save.mutate();
  };

  if (isEdit && isLoading) {
    return (
      <>
        <Skeleton className="mb-4 h-8 w-64" />
        <Skeleton className="h-96" />
      </>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <PageHeader
        breadcrumb={
          <nav className="flex items-center gap-1 text-xs text-content-muted" aria-label="مسیر">
            <Link to="/members" className="hover:text-primary hover:underline">اعضا</Link>
            <span aria-hidden>/</span>
            <span>{isEdit ? 'ویرایش' : 'ثبت جدید'}</span>
          </nav>
        }
        title={isEdit ? 'ویرایش عضو' : 'ثبت عضو جدید'}
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => navigate(-1)}>انصراف</Button>
            <Button variant="primary" type="submit" loading={save.isPending} icon={<Save className="size-4" />}>
              {isEdit ? 'ذخیره تغییرات' : 'ثبت عضو'}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="اطلاعات هویتی" />
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label="نام" required error={errors.firstName} htmlFor="firstName">
                <Input
                  id="firstName" value={form.firstName} autoFocus
                  onChange={(e) => set('firstName', e.target.value)}
                  invalid={!!errors.firstName}
                />
              </Field>

              <Field label="نام خانوادگی" required error={errors.lastName} htmlFor="lastName">
                <Input
                  id="lastName" value={form.lastName}
                  onChange={(e) => set('lastName', e.target.value)}
                  invalid={!!errors.lastName}
                />
              </Field>

              <Field
                label="کد ملی"
                error={errors.nationalId ?? (nationalIdInvalid ? ['رقم کنترل کد ملی مطابقت ندارد.'] : undefined)}
                hint="اختیاری — برای تشخیص عضو تکراری کمک می‌کند."
              >
                <Input
                  ltr value={form.nationalId} maxLength={10}
                  onChange={(e) => set('nationalId', e.target.value.replace(/\D/g, ''))}
                  invalid={nationalIdInvalid || !!errors.nationalId}
                />
              </Field>

              <Field label="تاریخ تولد" error={errors.birthDate} hint="با تقویم میلادی وارد می‌شود و شمسی نمایش داده خواهد شد.">
                <Input
                  type="date" ltr value={form.birthDate}
                  onChange={(e) => set('birthDate', e.target.value)}
                />
              </Field>

              <Field label="جنسیت">
                <Select value={form.gender} onChange={(e) => set('gender', e.target.value)}>
                  <option value="UNSPECIFIED">نامشخص</option>
                  <option value="FEMALE">زن</option>
                  <option value="MALE">مرد</option>
                </Select>
              </Field>

              <Field label="نام معرف">
                <Input value={form.referrerName} onChange={(e) => set('referrerName', e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="راه‌های تماس" description="برای اطلاع‌رسانی موعد بازگشت و رزرو آماده" />
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label="تلفن همراه" error={errors.mobile}>
                <Input
                  ltr value={form.mobile} placeholder="09121234567"
                  onChange={(e) => set('mobile', e.target.value)}
                  invalid={!!errors.mobile}
                />
              </Field>

              <Field label="تلفن ثابت" error={errors.phone}>
                <Input ltr value={form.phone} onChange={(e) => set('phone', e.target.value)} />
              </Field>

              <Field label="ایمیل" error={errors.email}>
                <Input
                  type="email" ltr value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                  invalid={!!errors.email}
                />
              </Field>

              <Field label="کد پستی" error={errors.postalCode}>
                <Input ltr value={form.postalCode} onChange={(e) => set('postalCode', e.target.value)} />
              </Field>

              <Field label="نشانی" className="sm:col-span-2">
                <Textarea value={form.address} onChange={(e) => set('address', e.target.value)} rows={2} />
              </Field>

              <Field label="نام تماس اضطراری">
                <Input
                  value={form.emergencyContactName}
                  onChange={(e) => set('emergencyContactName', e.target.value)}
                />
              </Field>

              <Field label="تلفن تماس اضطراری">
                <Input
                  ltr value={form.emergencyContactPhone}
                  onChange={(e) => set('emergencyContactPhone', e.target.value)}
                />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="یادداشت" description="فقط برای کارکنان کتابخانه" />
            <div className="p-4">
              <Field label="یادداشت داخلی">
                <Textarea value={form.note} onChange={(e) => set('note', e.target.value)} rows={3} />
              </Field>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="عضویت" />
            <div className="space-y-4 p-4">
              <Field
                label="کد عضویت"
                error={errors.memberCode}
                hint={isEdit ? undefined : 'خالی بگذارید تا خودکار تخصیص یابد.'}
              >
                <Input
                  ltr value={form.memberCode}
                  onChange={(e) => set('memberCode', e.target.value)}
                  invalid={!!errors.memberCode}
                  placeholder={isEdit ? undefined : 'خودکار'}
                />
              </Field>

              <Field label="نوع عضویت" error={errors.membershipTypeId}>
                <Select
                  value={form.membershipTypeId}
                  onChange={(e) => set('membershipTypeId', e.target.value)}
                >
                  <option value="">بدون نوع (قوانین عمومی)</option>
                  {types?.map((type) => (
                    <option key={type.id} value={type.id}>{type.name}</option>
                  ))}
                </Select>
              </Field>

              {selectedType ? (
                <div className="flex items-start gap-2 rounded border border-info/30 bg-info-soft p-3 text-xs text-info-content">
                  <Info className="mt-0.5 size-4 shrink-0" />
                  <div>
                    <p className="font-medium">قوانین «{selectedType.name}»</p>
                    <ul className="mt-1 space-y-0.5 opacity-90">
                      {selectedType.maxLoans !== null ? (
                        <li>حداکثر {toPersianDigits(selectedType.maxLoans)} کتاب هم‌زمان</li>
                      ) : null}
                      {selectedType.loanDays !== null ? (
                        <li>مدت امانت {toPersianDigits(selectedType.loanDays)} روز</li>
                      ) : null}
                      {selectedType.durationMonths !== null ? (
                        <li>مدت عضویت {toPersianDigits(selectedType.durationMonths)} ماه</li>
                      ) : null}
                    </ul>
                    <p className="mt-1 opacity-75">
                      مقادیر تعیین‌نشده از تنظیمات عمومی کتابخانه گرفته می‌شوند.
                    </p>
                  </div>
                </div>
              ) : null}

              <Field label="وضعیت عضویت">
                <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
                  {Object.entries(MEMBER_STATUS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </Select>
              </Field>

              <Field
                label="تاریخ انقضای عضویت"
                error={errors.expiresAt}
                hint={
                  isEdit
                    ? undefined
                    : 'خالی بگذارید تا از روی مدت نوع عضویت محاسبه شود.'
                }
              >
                <Input
                  type="date" ltr value={form.expiresAt}
                  onChange={(e) => set('expiresAt', e.target.value)}
                />
              </Field>
            </div>
          </Card>
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" type="button" onClick={() => navigate(-1)}>انصراف</Button>
        <Button variant="primary" type="submit" loading={save.isPending} icon={<Save className="size-4" />}>
          {isEdit ? 'ذخیره تغییرات' : 'ثبت عضو'}
        </Button>
      </div>
    </form>
  );
}

/**
 * اعتبارسنجی کد ملی ایرانی.
 *
 * همان الگوریتمی که سرور استفاده می‌کند؛ اینجا تکرار شده تا کاربر بلافاصله
 * و بدون رفت‌وبرگشت شبکه از اشتباه تایپی آگاه شود. مرجع نهایی همچنان سرور
 * است.
 */
function isValidIranianNationalId(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 10) return false;
  // کدهای تک‌رقمی تکراری (۰۰۰۰۰۰۰۰۰۰ تا ۹۹۹۹۹۹۹۹۹۹) از نظر ریاضی معتبرند
  // اما در عمل صادر نشده‌اند
  if (/^(\d)\1{9}$/.test(digits)) return false;

  const check = Number(digits[9]);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits[i]) * (10 - i);
  const remainder = sum % 11;

  return remainder < 2 ? check === remainder : check === 11 - remainder;
}
