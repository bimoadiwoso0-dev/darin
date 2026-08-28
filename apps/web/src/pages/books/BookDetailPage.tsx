import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive, ArchiveRestore, BookOpen, Boxes, Copy, Layers, Pencil, Plus,
  Printer, Tag,
} from 'lucide-react';
import {
  CONTRIBUTOR_ROLE, COPY_STATUS, BOOK_FORMAT, BINDING_TYPE, languageLabel,
} from '@darin/shared';
import { api, type Paginated } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/lib/toast';
import {
  Badge, Button, Card, CardHeader, ConfirmDialog, DataRow, EmptyState,
  Skeleton, TableWrapper, Td, Th, cn,
} from '@/components/ui';
import { PageHeader } from '@/components/layout/AppShell';
import { CopyCreateModal } from '@/components/books/CopyCreateModal';
import { LabelPrintModal } from '@/components/books/LabelPrintModal';
import {
  formatDate, formatIdentifier, formatNumber, formatRelative, toPersianDigits,
} from '@/lib/format';

interface BookDetail {
  id: string;
  title: string; subtitle: string | null; titleEn: string | null; originalTitle: string | null;
  publicationYear: number | null; publicationPlace: string | null; publicationCalendar: string;
  edition: number | null; editionNote: string | null;
  isbn13: string | null; issn: string | null; nationalBibNumber: string | null;
  language: string; pageCount: number | null; format: string | null; bindingType: string | null;
  summary: string | null; description: string | null; keywords: string[];
  deweyCode: string | null; congressCode: string | null; ageRating: string | null;
  seriesOrder: number | null; volumeNumber: number | null; volumeTitle: string | null;
  totalVolumes: number | null; internalNote: string | null;
  createdAt: string; updatedAt: string; deletedAt: string | null;
  publisher: { id: string; name: string; city: string | null } | null;
  series: { id: string; title: string } | null;
  parentBook: { id: string; title: string; totalVolumes: number | null } | null;
  volumes: Array<{
    id: string; volumeNumber: number | null; volumeTitle: string | null;
    isbn13: string | null; pageCount: number | null; _count: { copies: number };
  }>;
  contributors: Array<{
    id: string; role: string; position: number;
    person: { id: string; fullName: string; latinName: string | null };
  }>;
  categories: Array<{ isPrimary: boolean; category: { id: string; name: string; path: string } }>;
  tags: Array<{ tag: { id: string; name: string; colorHex: string | null } }>;
  statusBreakdown: Record<string, number>;
  totalCopies: number;
  availableCopies: number;
  activeLoans: number;
}

interface CopyRow {
  id: string; copyNumber: number; accessionNumber: string; barcode: string;
  libraryCode: string | null; status: string; condition: string; isLoanable: boolean;
  positionCode: string | null; deletedAt: string | null;
  location: { id: string; name: string; fullCode: string } | null;
  currentLoan: {
    id: string; dueAt: string; status: string;
    member: { id: string; firstName: string; lastName: string; memberCode: string };
  } | null;
}

interface RelatedBook {
  id: string; title: string; score: number; availableCount: number;
  contributors?: Array<{ person: { fullName: string } }>;
}

/**
 * جزئیات کتاب (قوانین ۳۶، ۳۷، ۳۹).
 *
 * ── تفکیک «عنوان» از «نسخه» ─────────────────────────────────────────────
 * بالای صفحه اطلاعات کتاب‌شناختی است (یک بار برای همه نسخه‌ها) و پایین آن
 * فهرست نسخه‌های فیزیکی با بارکد، قفسه و وضعیت هرکدام. این تفکیک، هستهٔ
 * مدل داده است (ADR-01) و رابط کاربری باید همان را منعکس کند.
 */
export function BookDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const toast = useToast();

  const [copyModalOpen, setCopyModalOpen] = React.useState(false);
  const [labelModalOpen, setLabelModalOpen] = React.useState(false);
  const [archiveOpen, setArchiveOpen] = React.useState(false);
  const [selectedCopies, setSelectedCopies] = React.useState<string[]>([]);

  const { data: book, isLoading, isError } = useQuery({
    queryKey: ['books', id],
    queryFn: () => api.get<BookDetail>(`/books/${id}`),
    enabled: !!id,
  });

  const { data: copies, isLoading: copiesLoading } = useQuery({
    queryKey: ['copies', { bookId: id, includeDeleted: true }],
    queryFn: () =>
      api.get<Paginated<CopyRow>>('/copies', {
        bookId: id, pageSize: 200, sort: 'accessionNumber', order: 'asc',
      }),
    enabled: !!id && can('copies.view'),
  });

  const { data: related } = useQuery({
    queryKey: ['books', id, 'related'],
    queryFn: () => api.get<RelatedBook[]>(`/books/${id}/related`),
    enabled: !!id,
    staleTime: 5 * 60_000,
  });

  const archive = useMutation({
    mutationFn: () => api.delete(`/books/${id}`),
    onSuccess: () => {
      toast.success('کتاب بایگانی شد', 'رکورد حذف نشد؛ در فیلتر «شامل بایگانی‌شده‌ها» قابل دیدن است.');
      setArchiveOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['books'] });
    },
    onError: (error) => toast.apiError(error, 'بایگانی انجام نشد'),
  });

  const restore = useMutation({
    mutationFn: () => api.post(`/books/${id}/restore`),
    onSuccess: () => {
      toast.success('کتاب بازگردانده شد');
      void queryClient.invalidateQueries({ queryKey: ['books'] });
    },
    onError: (error) => toast.apiError(error, 'بازگرداندن انجام نشد'),
  });

  if (isError) {
    return (
      <Card className="mx-auto max-w-lg">
        <EmptyState
          icon={<BookOpen className="size-6" />}
          title="کتاب یافت نشد"
          description="ممکن است حذف شده باشد یا نشانی اشتباه باشد."
          action={<Button onClick={() => navigate('/books')}>بازگشت به فهرست کتاب‌ها</Button>}
        />
      </Card>
    );
  }

  if (isLoading || !book) {
    return (
      <>
        <Skeleton className="mb-4 h-8 w-64" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </>
    );
  }

  const authors = book.contributors.filter((c) => c.role === 'AUTHOR');
  const others = book.contributors.filter((c) => c.role !== 'AUTHOR');
  const activeCopies = copies?.data.filter((c) => !c.deletedAt) ?? [];

  return (
    <>
      <PageHeader
        breadcrumb={
          <nav className="flex items-center gap-1 text-xs text-content-muted" aria-label="مسیر">
            <Link to="/books" className="hover:text-primary hover:underline">کتاب‌ها</Link>
            <span aria-hidden>/</span>
            <span className="truncate">{book.title}</span>
          </nav>
        }
        title={book.title}
        description={
          [
            authors.map((a) => a.person.fullName).join('، '),
            book.publisher?.name,
            book.publicationYear ? toPersianDigits(book.publicationYear) : null,
          ]
            .filter(Boolean)
            .join(' · ') || undefined
        }
        actions={
          <>
            {book.deletedAt ? (
              can('books.delete') ? (
                <Button
                  variant="success"
                  onClick={() => restore.mutate()}
                  loading={restore.isPending}
                  icon={<ArchiveRestore className="size-4" />}
                >
                  بازگرداندن از بایگانی
                </Button>
              ) : null
            ) : (
              <>
                {can('labels.print') && activeCopies.length > 0 ? (
                  <Button onClick={() => setLabelModalOpen(true)} icon={<Printer className="size-4" />}>
                    چاپ برچسب
                  </Button>
                ) : null}
                {can('copies.create') ? (
                  <Button onClick={() => setCopyModalOpen(true)} icon={<Plus className="size-4" />}>
                    افزودن نسخه
                  </Button>
                ) : null}
                {can('books.edit') ? (
                  <Button
                    variant="primary"
                    onClick={() => navigate(`/books/${id}/edit`)}
                    icon={<Pencil className="size-4" />}
                  >
                    ویرایش
                  </Button>
                ) : null}
                {can('books.delete') ? (
                  <Button
                    variant="ghost"
                    onClick={() => setArchiveOpen(true)}
                    icon={<Archive className="size-4" />}
                    aria-label="بایگانی کتاب"
                  />
                ) : null}
              </>
            )}
          </>
        }
      />

      {book.deletedAt ? (
        <div className="mb-4 flex items-center gap-2 rounded border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning-content">
          <Archive className="size-4 shrink-0" />
          این کتاب در تاریخ {formatDate(book.deletedAt)} بایگانی شده است. تاریخچه امانت‌های آن حفظ شده و از بین نرفته است.
        </div>
      ) : null}

      {/* ── خلاصه موجودی ─────────────────────────────────────────────── */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryTile label="کل نسخه‌ها" value={formatNumber(book.totalCopies)} tone="neutral" />
        <SummaryTile label="موجود در قفسه" value={formatNumber(book.availableCopies)} tone="success" />
        <SummaryTile label="در امانت" value={formatNumber(book.activeLoans)} tone="warning" />
        <SummaryTile
          label="مفقود یا آسیب‌دیده"
          value={formatNumber((book.statusBreakdown.LOST ?? 0) + (book.statusBreakdown.DAMAGED ?? 0))}
          tone="danger"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* ── نسخه‌های فیزیکی ─────────────────────────────────────── */}
          {can('copies.view') ? (
            <Card>
              <CardHeader
                title="نسخه‌های فیزیکی"
                description={`${formatNumber(activeCopies.length)} نسخه ثبت‌شده`}
                action={
                  selectedCopies.length > 0 && can('labels.print') ? (
                    <Button size="sm" onClick={() => setLabelModalOpen(true)} icon={<Printer className="size-3.5" />}>
                      چاپ برچسب {toPersianDigits(selectedCopies.length)} نسخه
                    </Button>
                  ) : null
                }
              />
              {copiesLoading ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-10" />)}
                </div>
              ) : activeCopies.length > 0 ? (
                <TableWrapper>
                  <thead>
                    <tr>
                      <Th className="w-10">
                        <input
                          type="checkbox"
                          aria-label="انتخاب همه نسخه‌ها"
                          checked={selectedCopies.length === activeCopies.length && activeCopies.length > 0}
                          onChange={(e) =>
                            setSelectedCopies(e.target.checked ? activeCopies.map((c) => c.id) : [])
                          }
                          className="size-4 rounded border-border-strong text-primary focus:ring-primary/30"
                        />
                      </Th>
                      <Th>شماره ثبت</Th>
                      <Th>بارکد</Th>
                      <Th>مکان</Th>
                      <Th>وضعیت</Th>
                      <Th>نزد</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeCopies.map((copy) => (
                      <tr key={copy.id} className="transition hover:bg-surface-sunken">
                        <Td>
                          <input
                            type="checkbox"
                            aria-label={`انتخاب نسخه ${copy.accessionNumber}`}
                            checked={selectedCopies.includes(copy.id)}
                            onChange={(e) =>
                              setSelectedCopies((s) =>
                                e.target.checked ? [...s, copy.id] : s.filter((x) => x !== copy.id),
                              )
                            }
                            className="size-4 rounded border-border-strong text-primary focus:ring-primary/30"
                          />
                        </Td>
                        <Td>
                          <Link
                            to={`/copies/${copy.id}`}
                            className="field-ltr text-xs font-medium text-content hover:text-primary hover:underline"
                          >
                            {formatIdentifier(copy.accessionNumber)}
                          </Link>
                        </Td>
                        <Td className="field-ltr text-xs text-content-muted">
                          {formatIdentifier(copy.barcode)}
                        </Td>
                        <Td className="text-xs">
                          {copy.location ? (
                            <Link
                              to={`/locations/${copy.location.id}`}
                              className="text-content-muted hover:text-primary hover:underline"
                            >
                              {copy.location.name}
                              {copy.positionCode ? ` · ${copy.positionCode}` : ''}
                            </Link>
                          ) : (
                            <span className="text-content-subtle">بدون مکان</span>
                          )}
                        </Td>
                        <Td>
                          <Badge tone={copyStatusTone(copy.status)}>
                            {COPY_STATUS[copy.status as keyof typeof COPY_STATUS] ?? copy.status}
                          </Badge>
                        </Td>
                        <Td className="text-xs">
                          {copy.currentLoan ? (
                            <Link
                              to={`/members/${copy.currentLoan.member.id}`}
                              className="text-content-muted hover:text-primary hover:underline"
                            >
                              {copy.currentLoan.member.firstName} {copy.currentLoan.member.lastName}
                              <span className="block text-2xs text-content-subtle">
                                موعد: {formatRelative(copy.currentLoan.dueAt)}
                              </span>
                            </Link>
                          ) : (
                            <span className="text-content-subtle">—</span>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrapper>
              ) : (
                <EmptyState
                  icon={<Boxes className="size-6" />}
                  title="هنوز نسخه فیزیکی ثبت نشده"
                  description="این عنوان در فهرست ثبت شده اما هیچ جلدی از آن در قفسه‌ها ثبت نشده است."
                  action={
                    can('copies.create') ? (
                      <Button variant="primary" onClick={() => setCopyModalOpen(true)}>
                        افزودن نسخه
                      </Button>
                    ) : null
                  }
                />
              )}
            </Card>
          ) : null}

          {/* ── چکیده و توضیحات ─────────────────────────────────────── */}
          {book.summary || book.description ? (
            <Card>
              <CardHeader title="چکیده" />
              <div className="space-y-3 p-4 text-sm leading-relaxed text-content-muted">
                {book.summary ? <p>{book.summary}</p> : null}
                {book.description ? (
                  <p className="whitespace-pre-line border-t border-border pt-3">{book.description}</p>
                ) : null}
              </div>
            </Card>
          ) : null}

          {/* ── مجلدات اثر چندجلدی ─────────────────────────────────── */}
          {book.volumes.length > 0 ? (
            <Card>
              <CardHeader
                title="مجلدات این اثر"
                description={
                  book.totalVolumes
                    ? `${toPersianDigits(book.volumes.length)} از ${toPersianDigits(book.totalVolumes)} جلد ثبت شده`
                    : undefined
                }
              />
              <ul className="divide-y divide-border">
                {book.volumes.map((volume) => (
                  <li key={volume.id}>
                    <Link
                      to={`/books/${volume.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-surface-sunken"
                    >
                      <Layers className="size-4 shrink-0 text-content-subtle" />
                      <span className="min-w-0 flex-1 truncate text-sm text-content">
                        جلد {volume.volumeNumber ? toPersianDigits(volume.volumeNumber) : '؟'}
                        {volume.volumeTitle ? ` — ${volume.volumeTitle}` : ''}
                      </span>
                      <Badge tone="neutral">{toPersianDigits(volume._count.copies)} نسخه</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        {/* ── ستون کناری: اطلاعات کتاب‌شناختی ───────────────────────── */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="اطلاعات کتاب‌شناختی" />
            <dl className="px-4 py-3">
              {book.subtitle ? <DataRow label="عنوان فرعی" value={book.subtitle} /> : null}
              {book.titleEn ? <DataRow label="عنوان لاتین" value={book.titleEn} ltr /> : null}
              {book.originalTitle ? <DataRow label="عنوان اصلی" value={book.originalTitle} /> : null}
              <DataRow
                label="ناشر"
                value={
                  book.publisher ? (
                    <Link to={`/books?publisherId=${book.publisher.id}`} className="hover:text-primary hover:underline">
                      {book.publisher.name}
                      {book.publisher.city ? ` — ${book.publisher.city}` : ''}
                    </Link>
                  ) : null
                }
              />
              <DataRow
                label="سال انتشار"
                value={book.publicationYear ? toPersianDigits(book.publicationYear) : null}
              />
              {book.publicationPlace ? <DataRow label="محل نشر" value={book.publicationPlace} /> : null}
              <DataRow
                label="نوبت چاپ"
                value={
                  book.edition
                    ? `${toPersianDigits(book.edition)}${book.editionNote ? ` — ${book.editionNote}` : ''}`
                    : null
                }
              />
              <DataRow label="شابک" value={book.isbn13} ltr />
              {book.issn ? <DataRow label="شاپا" value={book.issn} ltr /> : null}
              {book.nationalBibNumber ? (
                <DataRow label="شماره کتاب‌شناسی ملی" value={book.nationalBibNumber} ltr />
              ) : null}
              <DataRow label="زبان" value={languageLabel(book.language)} />
              <DataRow
                label="تعداد صفحه"
                value={book.pageCount ? toPersianDigits(book.pageCount) : null}
              />
              <DataRow
                label="قالب"
                value={book.format ? BOOK_FORMAT[book.format as keyof typeof BOOK_FORMAT] : null}
              />
              <DataRow
                label="نوع جلد"
                value={book.bindingType ? BINDING_TYPE[book.bindingType as keyof typeof BINDING_TYPE] : null}
              />
              {book.deweyCode ? <DataRow label="رده دیویی" value={book.deweyCode} ltr /> : null}
              {book.congressCode ? <DataRow label="رده کنگره" value={book.congressCode} ltr /> : null}
              {book.ageRating ? <DataRow label="رده سنی" value={book.ageRating} /> : null}
              {book.series ? (
                <DataRow
                  label="مجموعه"
                  value={
                    <Link to={`/books?seriesId=${book.series.id}`} className="hover:text-primary hover:underline">
                      {book.series.title}
                      {book.seriesOrder ? ` (${toPersianDigits(book.seriesOrder)})` : ''}
                    </Link>
                  }
                />
              ) : null}
              {book.parentBook ? (
                <DataRow
                  label="اثر اصلی"
                  value={
                    <Link to={`/books/${book.parentBook.id}`} className="hover:text-primary hover:underline">
                      {book.parentBook.title}
                    </Link>
                  }
                />
              ) : null}
              <DataRow label="تاریخ ثبت" value={formatDate(book.createdAt)} />
            </dl>
          </Card>

          {others.length > 0 ? (
            <Card>
              <CardHeader title="سایر پدیدآورندگان" />
              <ul className="divide-y divide-border">
                {others.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2">
                    <Link
                      to={`/books?personId=${c.person.id}`}
                      className="min-w-0 truncate text-sm text-content hover:text-primary hover:underline"
                    >
                      {c.person.fullName}
                    </Link>
                    <Badge tone="neutral">
                      {CONTRIBUTOR_ROLE[c.role as keyof typeof CONTRIBUTOR_ROLE] ?? c.role}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {book.categories.length > 0 || book.tags.length > 0 || book.keywords.length > 0 ? (
            <Card>
              <CardHeader title="موضوع و برچسب" />
              <div className="space-y-3 p-4">
                {book.categories.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {book.categories.map((c) => (
                      <Link key={c.category.id} to={`/books?categoryId=${c.category.id}`}>
                        <Badge tone={c.isPrimary ? 'primary' : 'neutral'}>{c.category.name}</Badge>
                      </Link>
                    ))}
                  </div>
                ) : null}
                {book.tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {book.tags.map((t) => (
                      <Badge key={t.tag.id} tone="info" icon={<Tag className="size-3" />}>
                        {t.tag.name}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {book.keywords.length > 0 ? (
                  <p className="text-xs text-content-muted">
                    کلیدواژه‌ها: {book.keywords.join('، ')}
                  </p>
                ) : null}
              </div>
            </Card>
          ) : null}

          {related && related.length > 0 ? (
            <Card>
              <CardHeader title="کتاب‌های مرتبط" description="بر پایه موضوع، پدیدآورنده و مجموعه" />
              <ul className="divide-y divide-border">
                {related.slice(0, 6).map((r) => (
                  <li key={r.id}>
                    <Link
                      to={`/books/${r.id}`}
                      className="flex items-center gap-2 px-4 py-2 transition hover:bg-surface-sunken"
                    >
                      <Copy className="size-3.5 shrink-0 text-content-subtle" />
                      <span className="min-w-0 flex-1 truncate text-sm text-content">{r.title}</span>
                      {r.availableCount > 0 ? (
                        <Badge tone="success">موجود</Badge>
                      ) : (
                        <Badge tone="neutral">ناموجود</Badge>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {book.internalNote && can('books.edit') ? (
            <Card>
              <CardHeader title="یادداشت داخلی" description="فقط برای کارکنان کتابخانه" />
              <p className="whitespace-pre-line p-4 text-xs leading-relaxed text-content-muted">
                {book.internalNote}
              </p>
            </Card>
          ) : null}
        </div>
      </div>

      <CopyCreateModal
        open={copyModalOpen}
        onClose={() => setCopyModalOpen(false)}
        bookId={book.id}
        bookTitle={book.title}
      />

      <LabelPrintModal
        open={labelModalOpen}
        onClose={() => setLabelModalOpen(false)}
        copyIds={selectedCopies.length > 0 ? selectedCopies : activeCopies.map((c) => c.id)}
      />

      <ConfirmDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        onConfirm={() => archive.mutate()}
        loading={archive.isPending}
        title="بایگانی کتاب"
        confirmLabel="بایگانی کن"
        message={
          <>
            <p>
              «{book.title}» بایگانی می‌شود. رکورد از دیتابیس پاک نمی‌شود و تاریخچه
              امانت‌های آن دست‌نخورده می‌ماند؛ فقط از فهرست‌های عادی کنار می‌رود.
            </p>
            {book.totalCopies > 0 ? (
              <p className="mt-2 rounded border border-danger/30 bg-danger-soft px-2.5 py-1.5 text-danger-content">
                این کتاب {toPersianDigits(book.totalCopies)} نسخه فیزیکی ثبت‌شده دارد و تا
                زمانی که نسخه‌ها بایگانی نشوند، قابل بایگانی نیست. ابتدا نسخه‌ها را از
                فهرست بالا بایگانی کنید.
              </p>
            ) : null}
            {book.activeLoans > 0 ? (
              <p className="mt-2 rounded border border-warning/30 bg-warning-soft px-2.5 py-1.5 text-warning-content">
                توجه: {toPersianDigits(book.activeLoans)} نسخه از این کتاب هم‌اکنون در امانت است.
              </p>
            ) : null}
          </>
        }
      />
    </>
  );
}

function copyStatusTone(status: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (status) {
    case 'AVAILABLE': return 'success';
    case 'ON_LOAN': return 'warning';
    case 'RESERVED_HOLD': return 'info';
    case 'LOST':
    case 'DAMAGED': return 'danger';
    default: return 'neutral';
  }
}

const TILE_TONES = {
  neutral: 'border-border',
  success: 'border-success/30 bg-success-soft',
  warning: 'border-warning/30 bg-warning-soft',
  danger: 'border-danger/30 bg-danger-soft',
} as const;

function SummaryTile({
  label, value, tone,
}: {
  label: string;
  value: string;
  tone: keyof typeof TILE_TONES;
}) {
  return (
    <div className={cn('rounded-lg border bg-surface px-3 py-2.5', TILE_TONES[tone])}>
      <p className="text-xs text-content-muted">{label}</p>
      <p className="mt-0.5 text-xl font-bold text-content">{value}</p>
    </div>
  );
}

