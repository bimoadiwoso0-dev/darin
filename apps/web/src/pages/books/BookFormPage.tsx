import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus, Save, Trash2, X } from 'lucide-react';
import {
  BINDING_TYPE, BOOK_FORMAT, CONTRIBUTOR_ROLE, LANGUAGES,
  currentJalaliYear, persianWordsToDigits, persianWordsToNumber, toCanonicalIsbn13,
  type DictatedBook,
} from '@darin/shared';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/lib/toast';
import {
  Badge, Button, Card, CardHeader, Field, Input, Select, Skeleton, Textarea, cn,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { EntityPicker } from '@/components/shared/EntityPicker';
import { CategoryPicker } from '@/components/shared/CategoryPicker';
import { MicButton } from '@/components/shared/MicButton';
import { VoiceEntryPanel } from '@/components/books/VoiceEntryPanel';
import { toPersianDigits } from '@/lib/format';

interface ContributorDraft {
  key: string;
  personId: string | null;
  fullName: string;
  role: string;
}

interface DuplicateCandidate {
  id: string; title: string; publisherName: string | null; publicationYear: number | null;
  isbn13: string | null; copyCount: number; reason: 'ISBN' | 'TITLE_AUTHOR' | 'TITLE';
  confidence: number;
}

const DUPLICATE_REASONS: Record<DuplicateCandidate['reason'], string> = {
  ISBN: 'شابک یکسان',
  TITLE_AUTHOR: 'عنوان و پدیدآورنده مشابه',
  TITLE: 'عنوان مشابه',
};

interface FormState {
  title: string; subtitle: string; titleEn: string; originalTitle: string;
  publisherId: string | null; publisherName: string | null; publisherLabel: string | null;
  publicationPlace: string; publicationYear: string; publicationCalendar: string;
  edition: string; editionNote: string;
  isbn: string; issn: string; nationalBibNumber: string;
  language: string; pageCount: string; format: string; bindingType: string;
  summary: string; description: string; keywords: string; ageRating: string;
  deweyCode: string; congressCode: string;
  seriesId: string | null; seriesLabel: string | null; seriesOrder: string;
  parentBookId: string | null; parentBookLabel: string | null;
  volumeNumber: string; volumeTitle: string; totalVolumes: string;
  internalNote: string;
  categoryIds: string[]; primaryCategoryId: string | null;
  tagNames: string;
}

const EMPTY: FormState = {
  title: '', subtitle: '', titleEn: '', originalTitle: '',
  publisherId: null, publisherName: null, publisherLabel: null,
  publicationPlace: '', publicationYear: '', publicationCalendar: 'SOLAR',
  edition: '', editionNote: '',
  isbn: '', issn: '', nationalBibNumber: '',
  language: 'fa', pageCount: '', format: '', bindingType: '',
  summary: '', description: '', keywords: '', ageRating: '',
  deweyCode: '', congressCode: '',
  seriesId: null, seriesLabel: null, seriesOrder: '',
  parentBookId: null, parentBookLabel: null,
  volumeNumber: '', volumeTitle: '', totalVolumes: '',
  internalNote: '',
  categoryIds: [], primaryCategoryId: null,
  tagNames: '',
};

/**
 * ثبت و ویرایش کتاب (قوانین ۱، ۲، ۴۱).
 *
 * ── تشخیص تکراری پیش از ثبت (قانون ۴۱) ──────────────────────────────────
 * وقتی کاربر عنوان یا شابک را وارد کرد، سیستم در پس‌زمینه کتاب‌های مشابه
 * را می‌آورد. این کار **مانع** ثبت نمی‌شود — گاهی واقعاً دو ویرایش مختلف
 * از یک اثر وجود دارد — اما کتابدار را از تکرار ناخواسته آگاه می‌کند و
 * پیشنهاد می‌دهد به‌جای رکورد جدید، نسخه را به رکورد موجود اضافه کند.
 *
 * ── چرا فقط «عنوان» الزامی است ──────────────────────────────────────────
 * کتابدار گاهی وسط کار است و همه اطلاعات را در دست ندارد. اجبار به پر
 * کردن ۲۰ فیلد باعث می‌شود داده‌های ساختگی وارد شود؛ فیلد خالی صادق‌تر از
 * داده جعلی است.
 */
export function BookFormPage() {
  const { id } = useParams();
  const isEdit = !!id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [contributors, setContributors] = React.useState<ContributorDraft[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [dismissedDuplicates, setDismissedDuplicates] = React.useState(false);

  const { data: existing, isLoading } = useQuery({
    queryKey: ['books', id],
    queryFn: () => api.get<Record<string, unknown>>(`/books/${id}`),
    enabled: isEdit,
  });

  // پر کردن فرم از رکورد موجود
  React.useEffect(() => {
    if (!existing) return;
    const b = existing as unknown as {
      title: string; subtitle: string | null; titleEn: string | null; originalTitle: string | null;
      publisher: { id: string; name: string } | null;
      publicationPlace: string | null; publicationYear: number | null; publicationCalendar: string;
      edition: number | null; editionNote: string | null;
      isbn13: string | null; issn: string | null; nationalBibNumber: string | null;
      language: string; pageCount: number | null; format: string | null; bindingType: string | null;
      summary: string | null; description: string | null; keywords: string[]; ageRating: string | null;
      deweyCode: string | null; congressCode: string | null;
      series: { id: string; title: string } | null; seriesOrder: number | null;
      parentBook: { id: string; title: string } | null;
      volumeNumber: number | null; volumeTitle: string | null; totalVolumes: number | null;
      internalNote: string | null;
      categories: Array<{ isPrimary: boolean; category: { id: string; name: string } }>;
      tags: Array<{ tag: { name: string } }>;
      contributors: Array<{ role: string; person: { id: string; fullName: string } }>;
    };

    setForm({
      title: b.title, subtitle: b.subtitle ?? '', titleEn: b.titleEn ?? '',
      originalTitle: b.originalTitle ?? '',
      publisherId: b.publisher?.id ?? null, publisherName: null,
      publisherLabel: b.publisher?.name ?? null,
      publicationPlace: b.publicationPlace ?? '',
      publicationYear: b.publicationYear?.toString() ?? '',
      publicationCalendar: b.publicationCalendar,
      edition: b.edition?.toString() ?? '', editionNote: b.editionNote ?? '',
      isbn: b.isbn13 ?? '', issn: b.issn ?? '', nationalBibNumber: b.nationalBibNumber ?? '',
      language: b.language, pageCount: b.pageCount?.toString() ?? '',
      format: b.format ?? '', bindingType: b.bindingType ?? '',
      summary: b.summary ?? '', description: b.description ?? '',
      keywords: b.keywords.join('، '), ageRating: b.ageRating ?? '',
      deweyCode: b.deweyCode ?? '', congressCode: b.congressCode ?? '',
      seriesId: b.series?.id ?? null, seriesLabel: b.series?.title ?? null,
      seriesOrder: b.seriesOrder?.toString() ?? '',
      parentBookId: b.parentBook?.id ?? null, parentBookLabel: b.parentBook?.title ?? null,
      volumeNumber: b.volumeNumber?.toString() ?? '', volumeTitle: b.volumeTitle ?? '',
      totalVolumes: b.totalVolumes?.toString() ?? '',
      internalNote: b.internalNote ?? '',
      categoryIds: b.categories.map((c) => c.category.id),
      primaryCategoryId: b.categories.find((c) => c.isPrimary)?.category.id ?? null,
      tagNames: b.tags.map((t) => t.tag.name).join('، '),
    });

    setContributors(
      b.contributors.map((c, i) => ({
        key: `existing-${i}`,
        personId: c.person.id,
        fullName: c.person.fullName,
        role: c.role,
      })),
    );
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

  /**
   * نتیجه دیکته را روی فرم می‌نشاند.
   *
   * ── چرا مقدار موجود پاک نمی‌شود ───────────────────────────────────────
   * کتابدار ممکن است چند فیلد را تایپ کرده و بقیه را بگوید. دیکته فقط
   * فیلدهایی را پر می‌کند که واقعاً گفته شده‌اند؛ بقیه دست‌نخورده می‌مانند.
   * پدیدآورندگان هم افزوده می‌شوند، نه جایگزین — مگر اینکه ردیف خالیِ
   * تازه‌ساخته باشند.
   */
  const applyDictation = (parsed: DictatedBook) => {
    setForm((f) => {
      const next = { ...f };
      for (const [field, value] of Object.entries(parsed.text)) {
        if (value) next[field as keyof FormState] = value as never;
      }
      for (const [field, value] of Object.entries(parsed.numbers)) {
        next[field as keyof FormState] = String(value) as never;
      }
      if (parsed.isbn) next.isbn = parsed.isbn;
      if (parsed.language) next.language = parsed.language;

      /*
       * نام ناشر به‌صورت متن می‌نشیند، نه شناسه: ممکن است ناشری با این نام
       * در پایگاه داده نباشد و سرور خودش بسازدش. اگر شناسه‌ای از قبل
       * انتخاب شده بود، کنار می‌رود تا نام گفته‌شده اثر کند.
       */
      if (parsed.text.publisherName) {
        next.publisherId = null;
        next.publisherLabel = parsed.text.publisherName;
        next.publisherName = parsed.text.publisherName;
      }
      return next;
    });

    if (parsed.contributors.length > 0) {
      setContributors((list) => {
        const kept = list.filter((c) => c.fullName.trim() || c.personId);
        return [
          ...kept,
          ...parsed.contributors.map((c, index) => ({
            key: `voice-${Date.now()}-${index}`,
            personId: null,
            fullName: c.fullName,
            role: c.role,
          })),
        ];
      });
    }

    setErrors({});
  };

  // ── تشخیص تکراری (قانون ۴۱) ─────────────────────────────────────────
  const firstAuthor = contributors.find((c) => c.role === 'AUTHOR')?.fullName ?? null;
  const [duplicateProbe, setDuplicateProbe] = React.useState<{
    title: string; isbn: string; author: string | null;
  } | null>(null);

  React.useEffect(() => {
    if (isEdit || form.title.trim().length < 3) { setDuplicateProbe(null); return; }
    const timer = setTimeout(
      () => setDuplicateProbe({ title: form.title.trim(), isbn: form.isbn.trim(), author: firstAuthor }),
      600,
    );
    return () => clearTimeout(timer);
  }, [form.title, form.isbn, firstAuthor, isEdit]);

  const { data: duplicates } = useQuery({
    queryKey: ['books', 'duplicates', duplicateProbe],
    queryFn: () =>
      api.post<DuplicateCandidate[]>('/books/check-duplicate', {
        title: duplicateProbe?.title ?? '',
        isbn: duplicateProbe?.isbn || null,
        authorName: duplicateProbe?.author ?? null,
      }),
    enabled: !!duplicateProbe && !isEdit,
    staleTime: 60_000,
  });

  const isbnCanonical = form.isbn.trim() ? toCanonicalIsbn13(form.isbn) : null;
  const isbnInvalid = form.isbn.trim().length >= 10 && !isbnCanonical;

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        title: form.title.trim(),
        subtitle: form.subtitle.trim() || null,
        titleEn: form.titleEn.trim() || null,
        originalTitle: form.originalTitle.trim() || null,
        publisherId: form.publisherId,
        publisherName: form.publisherId ? null : form.publisherName,
        publicationPlace: form.publicationPlace.trim() || null,
        publicationYear: form.publicationYear ? Number(form.publicationYear) : null,
        publicationCalendar: form.publicationCalendar,
        edition: form.edition ? Number(form.edition) : null,
        editionNote: form.editionNote.trim() || null,
        isbn: form.isbn.trim() || null,
        issn: form.issn.trim() || null,
        nationalBibNumber: form.nationalBibNumber.trim() || null,
        language: form.language,
        pageCount: form.pageCount ? Number(form.pageCount) : null,
        format: form.format || null,
        bindingType: form.bindingType || null,
        summary: form.summary.trim() || null,
        description: form.description.trim() || null,
        keywords: splitList(form.keywords),
        ageRating: form.ageRating.trim() || null,
        deweyCode: form.deweyCode.trim() || null,
        congressCode: form.congressCode.trim() || null,
        seriesId: form.seriesId,
        seriesOrder: form.seriesOrder ? Number(form.seriesOrder) : null,
        parentBookId: form.parentBookId,
        volumeNumber: form.volumeNumber ? Number(form.volumeNumber) : null,
        volumeTitle: form.volumeTitle.trim() || null,
        totalVolumes: form.totalVolumes ? Number(form.totalVolumes) : null,
        internalNote: form.internalNote.trim() || null,
        contributors: contributors
          .filter((c) => c.personId || c.fullName.trim())
          .map((c, position) =>
            c.personId
              ? { personId: c.personId, role: c.role, position }
              : { fullName: c.fullName.trim(), role: c.role, position },
          ),
        categoryIds: form.categoryIds,
        primaryCategoryId: form.primaryCategoryId,
        tagNames: splitList(form.tagNames),
      };

      return isEdit
        ? api.patch<{ id: string }>(`/books/${id}`, payload)
        : api.post<{ id: string }>('/books', payload);
    },
    onSuccess: (book) => {
      toast.success(isEdit ? 'کتاب ویرایش شد' : 'کتاب ثبت شد');
      void queryClient.invalidateQueries({ queryKey: ['books'] });
      navigate(`/books/${book.id}`);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.fieldErrors) setErrors(error.fieldErrors);
      toast.apiError(error, isEdit ? 'ویرایش انجام نشد' : 'ثبت کتاب انجام نشد');
    },
  });

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const next: Record<string, string[]> = {};
    if (form.title.trim().length < 1) next.title = ['عنوان کتاب الزامی است.'];
    if (isbnInvalid) next.isbn = ['شابک واردشده معتبر نیست. رقم کنترل مطابقت ندارد.'];
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

  const showDuplicates = !isEdit && !dismissedDuplicates && (duplicates?.length ?? 0) > 0;

  return (
    <form onSubmit={onSubmit}>
      <PageHeader
        breadcrumb={
          <nav className="flex items-center gap-1 text-xs text-content-muted" aria-label="مسیر">
            <Link to="/books" className="hover:text-primary hover:underline">کتاب‌ها</Link>
            <span aria-hidden>/</span>
            <span>{isEdit ? 'ویرایش' : 'ثبت جدید'}</span>
          </nav>
        }
        title={isEdit ? 'ویرایش کتاب' : 'ثبت کتاب جدید'}
        description="فقط «عنوان» الزامی است؛ بقیه فیلدها را بعداً هم می‌توان تکمیل کرد."
        actions={
          <>
            <Button variant="ghost" type="button" onClick={() => navigate(-1)}>انصراف</Button>
            <Button variant="primary" type="submit" loading={save.isPending} icon={<Save className="size-4" />}>
              {isEdit ? 'ذخیره تغییرات' : 'ثبت کتاب'}
            </Button>
          </>
        }
      />

      {showDuplicates ? (
        <Card className="mb-4 border-warning/40">
          <div className="flex items-start gap-3 p-4">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-content">کتاب‌های مشابهی در سامانه وجود دارد</p>
              <p className="mt-0.5 text-xs text-content-muted">
                اگر یکی از این‌ها همان کتاب شماست، به‌جای ثبت رکورد جدید، نسخه فیزیکی را
                به همان رکورد اضافه کنید تا آمار و تاریخچه یکپارچه بماند.
              </p>
              <ul className="mt-3 space-y-1.5">
                {(duplicates ?? []).map((d) => (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center gap-2 rounded border border-border bg-surface-sunken px-3 py-2"
                  >
                    <Link
                      to={`/books/${d.id}`}
                      target="_blank"
                      className="min-w-0 flex-1 truncate text-sm text-content hover:text-primary hover:underline"
                    >
                      {d.title}
                    </Link>
                    <span className="text-xs text-content-muted">
                      {[d.publisherName, d.publicationYear ? toPersianDigits(d.publicationYear) : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                    <Badge tone={d.reason === 'ISBN' ? 'danger' : 'warning'}>
                      {DUPLICATE_REASONS[d.reason]}
                    </Badge>
                    <Badge tone="neutral">{toPersianDigits(d.copyCount)} نسخه</Badge>
                  </li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              onClick={() => setDismissedDuplicates(true)}
              aria-label="بستن هشدار تکراری"
              className="rounded p-1 text-content-subtle hover:text-content"
            >
              <X className="size-4" />
            </button>
          </div>
        </Card>
      ) : null}

      {/* ثبت با گفتار — فقط در حالت ثبت جدید؛ هنگام ویرایش، جایگزینی گروهی
          مقادیر موجود بیش از آنکه کمک کند، خطرناک است. */}
      {!isEdit ? <VoiceEntryPanel onApply={applyDictation} /> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="اطلاعات اصلی" />
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label="عنوان" required error={errors.title} className="sm:col-span-2" htmlFor="title">
                <Input
                  id="title" value={form.title} autoFocus
                  onChange={(e) => set('title', e.target.value)}
                  invalid={!!errors.title}
                  suffix={
                    <MicButton
                      fieldLabel="عنوان"
                      // افزوده می‌شود، نه جایگزین: بخشی ممکن است تایپ شده باشد
                      onTranscript={(text) =>
                        set('title', form.title ? `${form.title} ${text}` : text)
                      }
                    />
                  }
                />
              </Field>

              <Field label="عنوان فرعی" error={errors.subtitle} className="sm:col-span-2">
                <Input value={form.subtitle} onChange={(e) => set('subtitle', e.target.value)} />
              </Field>

              <Field label="عنوان لاتین" error={errors.titleEn}>
                <Input ltr value={form.titleEn} onChange={(e) => set('titleEn', e.target.value)} />
              </Field>

              <Field label="عنوان اصلی (برای آثار ترجمه‌شده)" error={errors.originalTitle}>
                <Input value={form.originalTitle} onChange={(e) => set('originalTitle', e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="پدیدآورندگان"
              description="نویسنده، مترجم، ویراستار، گردآورنده و…"
              action={
                <Button
                  size="sm"
                  type="button"
                  onClick={() =>
                    setContributors((c) => [
                      ...c,
                      { key: `new-${Date.now()}`, personId: null, fullName: '', role: 'AUTHOR' },
                    ])
                  }
                  icon={<Plus className="size-3.5" />}
                >
                  افزودن
                </Button>
              }
            />
            <div className="space-y-2 p-4">
              {contributors.length === 0 ? (
                <p className="py-2 text-center text-xs text-content-muted">
                  هنوز پدیدآورنده‌ای افزوده نشده است.
                </p>
              ) : (
                contributors.map((contributor, index) => (
                  <div key={contributor.key} className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <EntityPicker
                        endpoint="/persons"
                        value={contributor.personId}
                        valueLabel={contributor.fullName || null}
                        onChange={(personId, label) =>
                          setContributors((list) =>
                            list.map((c, i) =>
                              i === index ? { ...c, personId, fullName: label ?? '' } : c,
                            ),
                          )
                        }
                        mapItem={(item: { id: string; fullName: string; bookCount: number }) => ({
                          id: item.id,
                          label: item.fullName,
                          hint: `${toPersianDigits(item.bookCount)} اثر`,
                        })}
                        allowCreate
                        createLabel="ثبت پدیدآورنده جدید"
                        placeholder="نام پدیدآورنده…"
                      />
                    </div>
                    <Select
                      value={contributor.role}
                      onChange={(e) =>
                        setContributors((list) =>
                          list.map((c, i) => (i === index ? { ...c, role: e.target.value } : c)),
                        )
                      }
                      aria-label="نقش پدیدآورنده"
                      className="w-36 shrink-0"
                    >
                      {Object.entries(CONTRIBUTOR_ROLE).map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label="حذف پدیدآورنده"
                      onClick={() => setContributors((list) => list.filter((_, i) => i !== index))}
                      icon={<Trash2 className="size-4" />}
                      className="shrink-0 text-content-subtle hover:text-danger"
                    />
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="نشر" />
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label="ناشر" error={errors.publisherId} className="sm:col-span-2">
                <EntityPicker
                  endpoint="/publishers"
                  value={form.publisherId}
                  valueLabel={form.publisherLabel ?? form.publisherName}
                  onChange={(publisherId, label, isNew) =>
                    setForm((f) => ({
                      ...f,
                      publisherId,
                      publisherLabel: isNew ? null : label,
                      publisherName: isNew ? label : null,
                    }))
                  }
                  mapItem={(item: { id: string; name: string; bookCount: number }) => ({
                    id: item.id,
                    label: item.name,
                    hint: `${toPersianDigits(item.bookCount)} کتاب`,
                  })}
                  allowCreate
                  createLabel="ثبت ناشر جدید"
                  placeholder="جستجوی ناشر…"
                />
              </Field>

              <Field label="محل نشر" error={errors.publicationPlace}>
                <Input value={form.publicationPlace} onChange={(e) => set('publicationPlace', e.target.value)} />
              </Field>

              <Field
                label="سال انتشار"
                error={errors.publicationYear}
                hint={`سال جاری شمسی: ${toPersianDigits(currentJalaliYear())}`}
              >
                <div className="flex gap-2">
                  <Input
                    type="number" ltr value={form.publicationYear}
                    onChange={(e) => set('publicationYear', e.target.value)}
                    invalid={!!errors.publicationYear}
                    suffix={
                      <MicButton
                        fieldLabel="سال انتشار"
                        // «هزار و سیصد و نود و نه» → «۱۳۹۹»
                        transform={(text) => {
                          const value = persianWordsToNumber(text);
                          return value === null ? '' : String(value);
                        }}
                        onTranscript={(text) => set('publicationYear', text)}
                      />
                    }
                  />
                  <Select
                    value={form.publicationCalendar}
                    onChange={(e) => set('publicationCalendar', e.target.value)}
                    aria-label="نوع تقویم سال انتشار"
                    className="w-28 shrink-0"
                  >
                    <option value="SOLAR">شمسی</option>
                    <option value="GREGORIAN">میلادی</option>
                    <option value="LUNAR">قمری</option>
                  </Select>
                </div>
              </Field>

              <Field label="نوبت چاپ" error={errors.edition}>
                <Input
                  type="number" min={1} ltr value={form.edition}
                  onChange={(e) => set('edition', e.target.value)}
                />
              </Field>

              <Field label="توضیح چاپ" hint="مثلاً: ویراست دوم، با تجدیدنظر">
                <Input value={form.editionNote} onChange={(e) => set('editionNote', e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="چکیده و توضیحات" />
            <div className="space-y-4 p-4">
              <Field label="چکیده" hint="یکی دو جمله درباره محتوای کتاب">
                <div className="relative">
                  <Textarea
                    value={form.summary}
                    onChange={(e) => set('summary', e.target.value)}
                    rows={3}
                    className="pe-10"
                  />
                  <span className="absolute end-2 top-2">
                    <MicButton
                      fieldLabel="چکیده"
                      onTranscript={(text) =>
                        set('summary', form.summary ? `${form.summary} ${text}` : text)
                      }
                    />
                  </span>
                </div>
              </Field>
              <Field label="توضیحات کامل">
                <Textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={5} />
              </Field>
              <Field label="یادداشت داخلی" hint="فقط برای کارکنان؛ در فهرست عمومی دیده نمی‌شود.">
                <Textarea value={form.internalNote} onChange={(e) => set('internalNote', e.target.value)} rows={2} />
              </Field>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="شناسه‌ها" />
            <div className="space-y-4 p-4">
              <Field
                label="شابک (ISBN)"
                error={errors.isbn ?? (isbnInvalid ? ['رقم کنترل شابک مطابقت ندارد.'] : undefined)}
                hint={
                  isbnCanonical && isbnCanonical !== form.isbn.replace(/[^0-9Xx]/g, '')
                    ? `به شکل استاندارد ذخیره می‌شود: ${isbnCanonical}`
                    : 'با یا بدون خط تیره — سیستم خودش استاندارد می‌کند.'
                }
              >
                <Input
                  ltr value={form.isbn}
                  onChange={(e) => set('isbn', e.target.value)}
                  invalid={isbnInvalid || !!errors.isbn}
                  placeholder="978-964-..."
                  suffix={
                    <MicButton
                      fieldLabel="شابک"
                      /*
                       * شابک را کسی به‌صورت عدد نمی‌خواند، رقم به رقم
                       * می‌گوید. `persianWordsToNumber` این را جمع می‌زد و
                       * عدد بی‌معنایی می‌ساخت.
                       */
                      transform={persianWordsToDigits}
                      onTranscript={(text) => set('isbn', form.isbn + text)}
                    />
                  }
                />
              </Field>

              <Field label="شاپا (ISSN)" error={errors.issn}>
                <Input ltr value={form.issn} onChange={(e) => set('issn', e.target.value)} />
              </Field>

              <Field label="شماره کتاب‌شناسی ملی" error={errors.nationalBibNumber}>
                <Input ltr value={form.nationalBibNumber} onChange={(e) => set('nationalBibNumber', e.target.value)} />
              </Field>

              <Field label="رده دیویی" error={errors.deweyCode}>
                <Input ltr value={form.deweyCode} onChange={(e) => set('deweyCode', e.target.value)} />
              </Field>

              <Field label="رده کنگره" error={errors.congressCode}>
                <Input ltr value={form.congressCode} onChange={(e) => set('congressCode', e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="مشخصات فیزیکی" />
            <div className="space-y-4 p-4">
              <Field label="زبان">
                <Select value={form.language} onChange={(e) => set('language', e.target.value)}>
                  {Object.entries(LANGUAGES).map(([code, label]) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </Select>
              </Field>

              <Field label="تعداد صفحه" error={errors.pageCount}>
                <Input
                  type="number" min={1} ltr value={form.pageCount}
                  onChange={(e) => set('pageCount', e.target.value)}
                  suffix={
                    <MicButton
                      fieldLabel="تعداد صفحه"
                      transform={(text) => {
                        const value = persianWordsToNumber(text);
                        return value === null ? '' : String(value);
                      }}
                      onTranscript={(text) => set('pageCount', text)}
                    />
                  }
                />
              </Field>

              <Field label="قالب">
                <Select value={form.format} onChange={(e) => set('format', e.target.value)}>
                  <option value="">نامشخص</option>
                  {Object.entries(BOOK_FORMAT).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </Select>
              </Field>

              <Field label="نوع جلد">
                <Select value={form.bindingType} onChange={(e) => set('bindingType', e.target.value)}>
                  <option value="">نامشخص</option>
                  {Object.entries(BINDING_TYPE).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </Select>
              </Field>

              <Field label="رده سنی" hint="مثلاً: نوجوان، بزرگسال">
                <Input value={form.ageRating} onChange={(e) => set('ageRating', e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="موضوع و برچسب" />
            <div className="space-y-4 p-4">
              <Field label="موضوع‌ها" error={errors.categoryIds}>
                <CategoryPicker
                  value={form.categoryIds}
                  primaryId={form.primaryCategoryId}
                  onChange={(ids) => set('categoryIds', ids)}
                  onPrimaryChange={(pid) => set('primaryCategoryId', pid)}
                />
              </Field>

              <Field label="برچسب‌ها" hint="با ویرگول جدا کنید.">
                <Input value={form.tagNames} onChange={(e) => set('tagNames', e.target.value)} />
              </Field>

              <Field label="کلیدواژه‌ها" hint="برای بهبود نتایج جستجو؛ با ویرگول جدا کنید.">
                <Input value={form.keywords} onChange={(e) => set('keywords', e.target.value)} />
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="مجموعه و مجلدات" description="برای آثار چندجلدی یا سری‌ها" />
            <div className="space-y-4 p-4">
              <Field label="مجموعه">
                <EntityPicker
                  endpoint="/series"
                  value={form.seriesId}
                  valueLabel={form.seriesLabel}
                  onChange={(seriesId, label) => setForm((f) => ({ ...f, seriesId, seriesLabel: label }))}
                  mapItem={(item: { id: string; title: string; bookCount: number }) => ({
                    id: item.id,
                    label: item.title,
                    hint: `${toPersianDigits(item.bookCount)} جلد`,
                  })}
                  placeholder="بدون مجموعه"
                />
              </Field>

              {form.seriesId ? (
                <Field label="شماره در مجموعه">
                  <Input
                    type="number" min={1} ltr value={form.seriesOrder}
                    onChange={(e) => set('seriesOrder', e.target.value)}
                  />
                </Field>
              ) : null}

              <Field label="اثر اصلی (والد)" hint="اگر این رکورد یک جلد از اثری چندجلدی است.">
                <EntityPicker
                  endpoint="/books"
                  value={form.parentBookId}
                  valueLabel={form.parentBookLabel}
                  onChange={(parentBookId, label) =>
                    setForm((f) => ({ ...f, parentBookId, parentBookLabel: label }))
                  }
                  mapItem={(item: { id: string; title: string; copyCount: number }) => ({
                    id: item.id,
                    label: item.title,
                    hint: `${toPersianDigits(item.copyCount)} نسخه`,
                  })}
                  placeholder="بدون اثر والد"
                />
              </Field>

              <div className={cn('grid gap-4', form.parentBookId ? 'grid-cols-2' : 'grid-cols-1')}>
                <Field label="شماره جلد">
                  <Input
                    type="number" min={1} ltr value={form.volumeNumber}
                    onChange={(e) => set('volumeNumber', e.target.value)}
                  />
                </Field>
                <Field label="تعداد کل مجلدات">
                  <Input
                    type="number" min={1} ltr value={form.totalVolumes}
                    onChange={(e) => set('totalVolumes', e.target.value)}
                  />
                </Field>
              </div>

              {form.volumeNumber ? (
                <Field label="عنوان این جلد">
                  <Input value={form.volumeTitle} onChange={(e) => set('volumeTitle', e.target.value)} />
                </Field>
              ) : null}
            </div>
          </Card>
        </div>
      </div>

      {/*
        دکمه ذخیره در پایین هم تکرار می‌شود — فرم بلند است و کاربر نباید
        برای ذخیره تا بالای صفحه اسکرول کند.
      */}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" type="button" onClick={() => navigate(-1)}>انصراف</Button>
        <Button variant="primary" type="submit" loading={save.isPending} icon={<Save className="size-4" />}>
          {isEdit ? 'ذخیره تغییرات' : 'ثبت کتاب'}
        </Button>
      </div>
    </form>
  );
}

/** جدا کردن فهرست واردشده با ویرگول فارسی یا لاتین. */
function splitList(value: string): string[] {
  return value
    .split(/[,،]/)
    .map((s) => s.trim())
    .filter(Boolean);
}
