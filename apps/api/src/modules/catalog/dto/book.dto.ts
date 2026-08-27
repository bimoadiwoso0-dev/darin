import { z } from 'zod';
import { booleanQuery } from '../../../common/dto/query.schema';
import { CONTRIBUTOR_ROLE, BOOK_FORMAT, BINDING_TYPE, CALENDAR_TYPE } from '@darin/shared';

const contributorRoles = Object.keys(CONTRIBUTOR_ROLE) as [string, ...string[]];
const bookFormats = Object.keys(BOOK_FORMAT) as [string, ...string[]];
const bindingTypes = Object.keys(BINDING_TYPE) as [string, ...string[]];
const calendars = Object.keys(CALENDAR_TYPE) as [string, ...string[]];

/** پدیدآورنده: یا شناسه موجود، یا نامی که سیستم رکوردش را می‌سازد. */
export const ContributorSchema = z
  .object({
    personId: z.string().uuid().optional(),
    fullName: z.string().min(2, 'نام پدیدآورنده باید حداقل ۲ نویسه باشد.').max(200).optional(),
    role: z.enum(contributorRoles as [string, ...string[]]),
    position: z.number().int().min(0).max(50).optional(),
  })
  .refine((c) => c.personId || c.fullName, {
    message: 'برای هر پدیدآورنده باید شناسه یا نام مشخص شود.',
  });

/**
 * سال انتشار: بازه معقول برای هر دو تقویم.
 * شمسی ۱۲۰۰-۱۴۵۰ و میلادی ۱۴۵۰-۲۱۰۰ را پوشش می‌دهد؛ عدد خارج از این بازه
 * تقریباً همیشه خطای تایپی است.
 */
const publicationYear = z
  .number()
  .int()
  .min(1000, 'سال انتشار معتبر نیست.')
  .max(2200, 'سال انتشار معتبر نیست.')
  .nullable()
  .optional();

export const CreateBookSchema = z.object({
  title: z.string().min(1, 'عنوان کتاب الزامی است.').max(400),
  subtitle: z.string().max(400).nullable().optional(),
  titleEn: z.string().max(400).nullable().optional(),
  originalTitle: z.string().max(400).nullable().optional(),

  publisherId: z.string().uuid().nullable().optional(),
  publisherName: z.string().max(200).nullable().optional(),
  publicationPlace: z.string().max(120).nullable().optional(),
  publicationYear,
  publicationCalendar: z.enum(calendars as [string, ...string[]]).optional(),
  edition: z.number().int().min(1).max(500).nullable().optional(),
  editionNote: z.string().max(200).nullable().optional(),

  isbn: z.string().max(40).nullable().optional(),
  issn: z.string().max(20).nullable().optional(),
  nationalBibNumber: z.string().max(40).nullable().optional(),

  language: z.string().max(12).optional(),
  pageCount: z.number().int().min(1).max(50_000).nullable().optional(),
  format: z.enum(bookFormats as [string, ...string[]]).nullable().optional(),
  bindingType: z.enum(bindingTypes as [string, ...string[]]).nullable().optional(),

  summary: z.string().max(5000).nullable().optional(),
  description: z.string().max(20_000).nullable().optional(),
  keywords: z.array(z.string().max(80)).max(40).optional(),
  ageRating: z.string().max(40).nullable().optional(),
  deweyCode: z.string().max(40).nullable().optional(),
  congressCode: z.string().max(40).nullable().optional(),

  seriesId: z.string().uuid().nullable().optional(),
  seriesOrder: z.number().int().min(1).max(2000).nullable().optional(),

  parentBookId: z.string().uuid().nullable().optional(),
  volumeNumber: z.number().int().min(1).max(500).nullable().optional(),
  volumeTitle: z.string().max(300).nullable().optional(),
  totalVolumes: z.number().int().min(1).max(500).nullable().optional(),

  coverImageId: z.string().uuid().nullable().optional(),
  internalNote: z.string().max(4000).nullable().optional(),

  contributors: z.array(ContributorSchema).max(30).optional(),
  categoryIds: z.array(z.string().uuid()).max(20).optional(),
  primaryCategoryId: z.string().uuid().nullable().optional(),
  tagNames: z.array(z.string().min(1).max(80)).max(30).optional(),
});

export const UpdateBookSchema = CreateBookSchema.partial();

/** پارامترهای فهرست کتاب — همه از Query String می‌آیند و باید Coerce شوند. */
export const BookListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  q: z.string().max(200).optional(),
  publisherId: z.string().uuid().optional(),
  personId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  seriesId: z.string().uuid().optional(),
  language: z.string().max(12).optional(),
  yearFrom: z.coerce.number().int().optional(),
  yearTo: z.coerce.number().int().optional(),
  availableOnly: booleanQuery,
  hasCopies: booleanQuery,
  sort: z.enum(['title', 'createdAt', 'publicationYear', 'copies']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  includeDeleted: booleanQuery,
});

export const DuplicateCheckSchema = z.object({
  isbn: z.string().max(40).nullable().optional(),
  title: z.string().min(1, 'عنوان برای بررسی تکراری بودن الزامی است.').max(400),
  authorName: z.string().max(200).nullable().optional(),
  publisherId: z.string().uuid().nullable().optional(),
});

export const BulkUpdateBooksSchema = z.object({
  bookIds: z.array(z.string().uuid()).min(1, 'حداقل یک کتاب انتخاب کنید.').max(2000),
  changes: z
    .object({
      categoryId: z.string().uuid().optional(),
      addTagNames: z.array(z.string().min(1).max(80)).max(20).optional(),
      language: z.string().max(12).optional(),
    })
    .refine((c) => Object.keys(c).length > 0, { message: 'هیچ تغییری مشخص نشده است.' }),
});
