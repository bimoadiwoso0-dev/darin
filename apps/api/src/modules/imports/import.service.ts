import { Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  currentJalaliMonth,
  currentJalaliYear,
  normalizeDigits,
  persianNormalize,
  toCanonicalIsbn13,
} from '@darin/shared';
import ExcelJS from 'exceljs';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { syncNumberingSequences } from '../numbering/sequence-sync';
import { Prisma } from '../../generated/prisma/client';
import type { AuthenticatedUser } from '../../common/decorators/auth.decorators';

/** فیلدی که می‌توان ستون Excel را به آن نگاشت. */
export interface ImportField {
  key: string;
  label: string;
  required: boolean;
  hint?: string;
  /** نام‌های متعارف ستون که برای نگاشت خودکار استفاده می‌شوند */
  aliases: string[];
}

export interface ImportPreview {
  jobId: string;
  headers: string[];
  /** چند ردیف اول برای اینکه کاربر ببیند فایل درست خوانده شده */
  sampleRows: Array<Record<string, string>>;
  totalRows: number;
  /** نگاشت خودکار پیشنهادی */
  suggestedMapping: Record<string, string>;
  availableFields: ImportField[];
}

export interface ValidationSummary {
  totalRows: number;
  validRows: number;
  errorRows: number;
  duplicateRows: number;
  errors: Array<{ rowNumber: number; column: string | null; message: string; sample?: string }>;
  duplicates: Array<{ rowNumber: number; title: string; reason: string; existingId: string }>;
}

/**
 * ورود اطلاعات از Excel/CSV (قوانین ۳۶، ۹۸).
 *
 * ── چرا این ماژول برای شما مهم‌ترین است ──────────────────────────────────
 * شما ۱۰٬۰۰۰ کتاب دارید که احتمالاً در یک فایل Excel ثبت شده‌اند. کیفیت
 * این ماژول تعیین می‌کند که مهاجرت به سامانه جدید یک بعدازظهر طول بکشد یا
 * چند هفته کار دستی.
 *
 * ── گردش کار چهار مرحله‌ای ────────────────────────────────────────────────
 *   ۱. **آپلود**   → سرستون‌ها خوانده و نمونه ردیف نمایش داده می‌شود
 *   ۲. **نگاشت**   → کاربر ستون‌ها را به فیلدهای سیستم وصل می‌کند
 *                    (سیستم بر اساس نام ستون، نگاشت خودکار پیشنهاد می‌دهد)
 *   ۳. **اعتبارسنجی** → کل فایل بدون نوشتن در دیتابیس بررسی می‌شود؛
 *                    خطاها و تکراری‌ها با شماره ردیف گزارش می‌شوند
 *   ۴. **اجرا**    → درج در دسته‌های ۲۰۰تایی داخل تراکنش
 *
 * مرحله ۳ حیاتی است: کاربر پیش از هر تغییری در دیتابیس می‌بیند چه اتفاقی
 * قرار است بیفتد و می‌تواند فایل را اصلاح کند.
 */
@Injectable()
export class ImportService {
  private readonly logger = new Logger(ImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  static readonly BOOK_FIELDS: ImportField[] = [
    { key: 'title', label: 'عنوان', required: true,
      aliases: ['عنوان', 'نام کتاب', 'title', 'book title', 'نام'] },
    { key: 'subtitle', label: 'عنوان فرعی', required: false,
      aliases: ['عنوان فرعی', 'زیرعنوان', 'subtitle'] },
    { key: 'author', label: 'نویسنده', required: false,
      hint: 'چند نویسنده را با کاما یا «،» جدا کنید',
      aliases: ['نویسنده', 'مؤلف', 'مولف', 'پدیدآور', 'author', 'authors'] },
    { key: 'translator', label: 'مترجم', required: false,
      aliases: ['مترجم', 'translator'] },
    { key: 'publisher', label: 'ناشر', required: false,
      aliases: ['ناشر', 'انتشارات', 'publisher'] },
    { key: 'publicationYear', label: 'سال انتشار', required: false,
      aliases: ['سال', 'سال انتشار', 'سال نشر', 'year', 'تاریخ انتشار'] },
    { key: 'edition', label: 'نوبت چاپ', required: false,
      aliases: ['نوبت چاپ', 'چاپ', 'edition'] },
    { key: 'isbn', label: 'شابک', required: false,
      aliases: ['شابک', 'isbn', 'شماره شابک'] },
    { key: 'pageCount', label: 'تعداد صفحات', required: false,
      aliases: ['صفحات', 'تعداد صفحه', 'تعداد صفحات', 'pages', 'page count'] },
    { key: 'language', label: 'زبان', required: false,
      aliases: ['زبان', 'language'] },
    { key: 'category', label: 'موضوع', required: false,
      hint: 'دسته‌بندی با «/» برای سطوح تودرتو: ادبیات/شعر/غزل',
      aliases: ['موضوع', 'دسته', 'دسته‌بندی', 'رده', 'category', 'subject'] },
    { key: 'keywords', label: 'کلیدواژه‌ها', required: false,
      aliases: ['کلیدواژه', 'کلیدواژه‌ها', 'برچسب', 'keywords', 'tags'] },
    { key: 'summary', label: 'خلاصه', required: false,
      aliases: ['خلاصه', 'چکیده', 'توضیحات', 'summary', 'description'] },
    { key: 'accessionNumber', label: 'شماره ثبت', required: false,
      hint: 'اگر خالی باشد، سیستم شماره تولید می‌کند',
      aliases: ['شماره ثبت', 'شماره', 'ثبت', 'accession', 'accession number', 'شماره کتاب'] },
    { key: 'barcode', label: 'بارکد', required: false,
      hint: 'اگر خالی باشد، سیستم بارکد تولید می‌کند',
      aliases: ['بارکد', 'barcode'] },
    { key: 'libraryCode', label: 'کد کتابخانه', required: false,
      aliases: ['کد کتابخانه', 'کد', 'library code'] },
    { key: 'assetNumber', label: 'شماره اموال', required: false,
      aliases: ['شماره اموال', 'اموال', 'asset', 'asset number'] },
    { key: 'copies', label: 'تعداد نسخه', required: false,
      hint: 'پیش‌فرض ۱ — اگر ۳ باشد، سه نسخه فیزیکی ساخته می‌شود',
      aliases: ['تعداد نسخه', 'تعداد', 'نسخه', 'copies', 'quantity'] },
    { key: 'locationCode', label: 'کد قفسه', required: false,
      hint: 'کد کامل مکان، مثل B1-F1-S1-A01-SH01-L01',
      aliases: ['قفسه', 'کد قفسه', 'محل', 'مکان', 'location', 'shelf'] },
    { key: 'price', label: 'قیمت', required: false,
      aliases: ['قیمت', 'بها', 'price', 'قیمت خرید'] },
    { key: 'donor', label: 'اهداکننده', required: false,
      aliases: ['اهداکننده', 'اهدا', 'donor'] },
    { key: 'note', label: 'یادداشت', required: false,
      aliases: ['یادداشت', 'ملاحظات', 'note', 'notes'] },
  ];

  // ═══ مرحله ۱: آپلود و پیش‌نمایش ════════════════════════════════════════

  async createJob(
    file: { buffer: Buffer; originalname: string; mimetype: string },
    type: 'BOOKS' | 'MEMBERS',
    user: AuthenticatedUser,
  ): Promise<ImportPreview> {
    const stored = await this.storage.save('imports', file.buffer, file.mimetype, file.originalname);

    const { headers, rows, totalRows } = await this.readWorkbook(file.buffer, file.originalname, 20);
    if (headers.length === 0) {
      throw new DomainError(
        ERROR_CODES.IMPORT_FILE_INVALID,
        'فایل سرستون ندارد. ردیف اول باید نام ستون‌ها باشد.',
      );
    }
    if (totalRows === 0) {
      throw new DomainError(ERROR_CODES.IMPORT_FILE_INVALID, 'فایل هیچ ردیف داده‌ای ندارد.');
    }

    const suggestedMapping = this.autoMap(headers);

    const job = await this.prisma.importJob.create({
      data: {
        type,
        status: 'UPLOADED',
        fileKey: stored.storageKey,
        originalName: file.originalname,
        headers,
        totalRows,
        mapping: suggestedMapping,
        createdById: user.sub,
      },
    });

    this.logger.log(
      `فایل ورود «${file.originalname}» با ${totalRows} ردیف و ${headers.length} ستون آپلود شد`,
    );

    return {
      jobId: job.id,
      headers,
      sampleRows: rows.slice(0, 10),
      totalRows,
      suggestedMapping,
      availableFields: ImportService.BOOK_FIELDS,
    };
  }

  /**
   * نگاشت خودکار ستون‌ها.
   *
   * ── چرا تطابق دقیق کافی نیست ─────────────────────────────────────────
   * فایل‌های واقعی کتابخانه‌ها سرستون‌های متنوعی دارند: «عنوان»، «عنوان
   * کتاب»، «نام اثر»، «Book Title». تطابق دقیق فقط اولی را می‌گیرد و
   * کاربر مجبور می‌شود بقیه را دستی نگاشت کند.
   *
   * راه‌حل: امتیازدهی. تطابق کامل بالاترین امتیاز را می‌گیرد؛ اگر سرستون
   * شامل نام مستعار باشد (یا برعکس)، امتیاز بر اساس نسبت طول محاسبه
   * می‌شود. فقط تطابق‌های بالای آستانه پذیرفته می‌شوند تا «شماره ردیف» به
   * «شماره ثبت» نگاشت نشود.
   */
  private autoMap(headers: string[]): Record<string, string> {
    const MIN_SCORE = 0.6;
    const candidates: Array<{ header: string; field: string; score: number }> = [];

    for (const header of headers) {
      const normalized = persianNormalize(header);
      if (!normalized) continue;

      for (const field of ImportService.BOOK_FIELDS) {
        let best = 0;
        for (const alias of field.aliases) {
          const a = persianNormalize(alias);
          if (!a) continue;

          if (a === normalized) {
            best = 1;
            break;
          }
          // یکی زیررشته دیگری باشد: «عنوان کتاب» ⊃ «عنوان»
          if (normalized.includes(a) || a.includes(normalized)) {
            const ratio = Math.min(a.length, normalized.length) / Math.max(a.length, normalized.length);
            // نام مستعار باید کلمه کاملی از سرستون باشد، نه بخشی از یک کلمه
            const isWordBoundary =
              new RegExp(`(^|\\s)${escapeRegex(a)}($|\\s)`).test(normalized) ||
              new RegExp(`(^|\\s)${escapeRegex(normalized)}($|\\s)`).test(a);
            if (isWordBoundary) best = Math.max(best, 0.6 + ratio * 0.35);
          }
        }
        if (best >= MIN_SCORE) candidates.push({ header, field: field.key, score: best });
      }
    }

    // بهترین تطابق‌ها اول؛ هر ستون و هر فیلد فقط یک بار استفاده می‌شود
    candidates.sort((a, b) => b.score - a.score);
    const mapping: Record<string, string> = {};
    const usedFields = new Set<string>();

    for (const c of candidates) {
      if (mapping[c.header] || usedFields.has(c.field)) continue;
      mapping[c.header] = c.field;
      usedFields.add(c.field);
    }
    return mapping;
  }

  async updateMapping(jobId: string, mapping: Record<string, string>) {
    const job = await this.prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job) throw DomainError.notFound('کار ورود اطلاعات');

    const titleMapped = Object.values(mapping).includes('title');
    if (!titleMapped) {
      throw DomainError.validation({
        mapping: ['ستون «عنوان» باید حتماً نگاشت شود؛ بدون آن کتاب قابل ثبت نیست.'],
      });
    }

    return this.prisma.importJob.update({
      where: { id: jobId },
      data: { mapping, status: 'MAPPING' },
    });
  }

  // ═══ مرحله ۳: اعتبارسنجی ═══════════════════════════════════════════════

  /**
   * بررسی کل فایل بدون نوشتن در دیتابیس.
   * خطاها با شماره ردیف برمی‌گردند تا کاربر بتواند فایل را اصلاح کند.
   */
  async validate(jobId: string): Promise<ValidationSummary> {
    const job = await this.prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job) throw DomainError.notFound('کار ورود اطلاعات');

    const mapping = job.mapping as Record<string, string>;
    const buffer = await this.readStoredFile(job.fileKey);
    const { rows } = await this.readWorkbook(buffer, job.originalName);

    const errors: ValidationSummary['errors'] = [];
    const duplicates: ValidationSummary['duplicates'] = [];
    const seenBarcodes = new Map<string, number>();
    const seenAccessions = new Map<string, number>();
    let validRows = 0;

    // شناسه‌های موجود در دیتابیس — یک بار خوانده می‌شوند تا برای هر ردیف
    // یک کوئری جدا نزنیم (۱۰٬۰۰۰ ردیف × ۲ کوئری = غیرقابل قبول)
    const [existingBarcodes, existingAccessions] = await Promise.all([
      this.prisma.bookCopy.findMany({
        where: { deletedAt: null }, select: { barcode: true },
      }).then((r) => new Set(r.map((x) => x.barcode))),
      this.prisma.bookCopy.findMany({
        where: { deletedAt: null }, select: { accessionNumber: true },
      }).then((r) => new Set(r.map((x) => x.accessionNumber))),
    ]);

    for (const [index, raw] of rows.entries()) {
      const rowNumber = index + 2; // ردیف ۱ سرستون است
      const row = this.mapRow(raw, mapping);
      let rowValid = true;

      // ── عنوان الزامی ──────────────────────────────────────────────────
      if (!row['title']?.trim()) {
        errors.push({ rowNumber, column: 'عنوان', message: 'عنوان کتاب خالی است.' });
        rowValid = false;
      }

      // ── شابک ──────────────────────────────────────────────────────────
      if (row['isbn']?.trim()) {
        const canonical = toCanonicalIsbn13(row['isbn']);
        if (!canonical) {
          // شابک نامعتبر ردیف را باطل نمی‌کند — فقط نادیده گرفته می‌شود،
          // چون در فایل‌های قدیمی شابک اغلب ناقص وارد شده.
          errors.push({
            rowNumber, column: 'شابک',
            message: 'شابک نامعتبر است و نادیده گرفته می‌شود.',
            sample: row['isbn'],
          });
        }
      }

      // ── سال انتشار ────────────────────────────────────────────────────
      if (row['publicationYear']?.trim()) {
        const year = Number(normalizeDigits(row['publicationYear']).replace(/\D/g, ''));
        if (!year || year < 1000 || year > 2200) {
          errors.push({
            rowNumber, column: 'سال انتشار',
            message: 'سال انتشار نامعتبر است.',
            sample: row['publicationYear'],
          });
        }
      }

      // ── بارکد تکراری ──────────────────────────────────────────────────
      const barcode = row['barcode'] ? normalizeDigits(row['barcode']).trim() : '';
      if (barcode) {
        if (existingBarcodes.has(barcode)) {
          errors.push({
            rowNumber, column: 'بارکد',
            message: 'این بارکد قبلاً در سیستم ثبت شده است.', sample: barcode,
          });
          rowValid = false;
        } else if (seenBarcodes.has(barcode)) {
          errors.push({
            rowNumber, column: 'بارکد',
            message: `بارکد تکراری — در ردیف ${seenBarcodes.get(barcode)} هم آمده است.`,
            sample: barcode,
          });
          rowValid = false;
        } else {
          seenBarcodes.set(barcode, rowNumber);
        }
      }

      // ── شماره ثبت تکراری ──────────────────────────────────────────────
      const accession = row['accessionNumber']?.trim() ?? '';
      if (accession) {
        if (existingAccessions.has(accession)) {
          errors.push({
            rowNumber, column: 'شماره ثبت',
            message: 'این شماره ثبت قبلاً استفاده شده است.', sample: accession,
          });
          rowValid = false;
        } else if (seenAccessions.has(accession)) {
          errors.push({
            rowNumber, column: 'شماره ثبت',
            message: `شماره ثبت تکراری — در ردیف ${seenAccessions.get(accession)} هم آمده است.`,
            sample: accession,
          });
          rowValid = false;
        } else {
          seenAccessions.set(accession, rowNumber);
        }
      }

      // ── تعداد نسخه ────────────────────────────────────────────────────
      if (row['copies']?.trim()) {
        const count = Number(normalizeDigits(row['copies']).replace(/\D/g, ''));
        if (!count || count < 1 || count > 500) {
          errors.push({
            rowNumber, column: 'تعداد نسخه',
            message: 'تعداد نسخه باید عددی بین ۱ تا ۵۰۰ باشد.', sample: row['copies'],
          });
        }
      }

      if (rowValid) validRows++;
    }

    // ── تشخیص کتاب تکراری بر اساس شابک ────────────────────────────────
    const isbnList = rows
      .map((r) => toCanonicalIsbn13(this.mapRow(r, mapping)['isbn'] ?? ''))
      .filter((x): x is string => Boolean(x));

    if (isbnList.length > 0) {
      const existingBooks = await this.prisma.book.findMany({
        where: { isbn13: { in: isbnList }, deletedAt: null },
        select: { id: true, isbn13: true, title: true },
      });
      const byIsbn = new Map(existingBooks.map((b) => [b.isbn13!, b]));

      for (const [index, raw] of rows.entries()) {
        const row = this.mapRow(raw, mapping);
        const isbn = toCanonicalIsbn13(row['isbn'] ?? '');
        const match = isbn ? byIsbn.get(isbn) : undefined;
        if (match) {
          duplicates.push({
            rowNumber: index + 2,
            title: row['title'] ?? '',
            reason: `کتابی با همین شابک از قبل ثبت شده: «${match.title}»`,
            existingId: match.id,
          });
        }
      }
    }

    // خطاها در دیتابیس ذخیره می‌شوند تا کاربر بتواند بعداً هم ببیندشان
    await this.prisma.$transaction([
      this.prisma.importError.deleteMany({ where: { jobId } }),
      this.prisma.importError.createMany({
        data: errors.slice(0, 2000).map((e) => ({
          jobId,
          rowNumber: e.rowNumber,
          column: e.column,
          message: e.message,
        })),
      }),
      this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: 'VALIDATED',
          totalRows: rows.length,
          errorRows: errors.length,
          duplicateRows: duplicates.length,
        },
      }),
    ]);

    return {
      totalRows: rows.length,
      validRows,
      errorRows: errors.length,
      duplicateRows: duplicates.length,
      errors: errors.slice(0, 200),
      duplicates: duplicates.slice(0, 200),
    };
  }

  // ═══ مرحله ۴: اجرا ═════════════════════════════════════════════════════

  /**
   * اجرای ورود اطلاعات به‌صورت دسته‌ای (قانون ۹۸).
   *
   * ── چرا دسته‌ای ────────────────────────────────────────────────────────
   * درج ۱۰٬۰۰۰ ردیف در یک تراکنش، قفل طولانی روی جدول‌ها می‌گذارد و اگر
   * ردیف ۹٬۹۹۹ خطا بدهد، همه‌چیز برمی‌گردد. دسته‌های ۲۰۰تایی یعنی:
   * قفل کوتاه، پیشرفت قابل مشاهده، و شکست محدود به یک دسته.
   */
  async execute(
    jobId: string,
    options: { skipDuplicates?: boolean; defaultLocationId?: string | null },
    user: AuthenticatedUser,
    ip?: string,
  ): Promise<{ imported: number; skipped: number; failed: number }> {
    const job = await this.prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job) throw DomainError.notFound('کار ورود اطلاعات');
    if (job.status === 'RUNNING') {
      throw DomainError.conflict(ERROR_CODES.CONFLICT, 'این ورود اطلاعات در حال اجراست.');
    }
    if (job.status === 'COMPLETED') {
      throw DomainError.conflict(ERROR_CODES.CONFLICT, 'این ورود اطلاعات قبلاً انجام شده است.');
    }

    const mapping = job.mapping as Record<string, string>;
    const buffer = await this.readStoredFile(job.fileKey);
    const { rows } = await this.readWorkbook(buffer, job.originalName);

    await this.prisma.importJob.update({
      where: { id: jobId },
      data: { status: 'RUNNING', startedAt: new Date(), processedRows: 0, successRows: 0 },
    });

    const branchId = user.branchId ?? (await this.defaultBranchId());
    const PROGRESS_EVERY = 100;
    let imported = 0;
    let skipped = 0;
    let failed = 0;

    // Cache برای ناشر/پدیدآور/دسته — بدون آن، هر ردیف چند کوئری جستجو می‌زند
    const cache = {
      publishers: new Map<string, string>(),
      persons: new Map<string, string>(),
      categories: new Map<string, string>(),
      locations: new Map<string, string>(),
      donors: new Map<string, string>(),
    };

    // خطاها در حافظه جمع و **پس از** پایان کار یکجا نوشته می‌شوند.
    // نمی‌توان آنها را داخل تراکنش نوشت: در PostgreSQL به‌محض خطای یک
    // دستور، کل تراکنش وارد وضعیت abort می‌شود و هر دستور بعدی — از جمله
    // درج خودِ رکورد خطا — با کد 25P02 رد می‌شود.
    const rowErrors: Array<{ rowNumber: number; message: string; rawRow: unknown }> = [];

    try {
      for (const [index, raw] of rows.entries()) {
        const rowNumber = index + 2;
        const row = this.mapRow(raw, mapping);

        try {
          // ── هر ردیف، یک تراکنش مستقل ──────────────────────────────────
          // واحد اتمی واقعی «یک کتاب با پدیدآورندگان و نسخه‌هایش» است، نه
          // دسته‌ای از ردیف‌های بی‌ارتباط. با تراکنش جداگانه، یک ردیف خراب
          // فقط خودش را برمی‌گرداند و ۹٬۹۹۹ ردیف سالم دست‌نخورده می‌مانند.
          const result = await this.prisma.$transaction(
            (tx) => this.importRow(tx, row, { branchId, ...options }, cache, user.sub),
            { timeout: 20_000 },
          );
          if (result === 'skipped') skipped++;
          else imported++;
        } catch (err) {
          failed++;
          rowErrors.push({
            rowNumber,
            message: this.humanizeRowError(err),
            rawRow: raw,
          });
          // Cache ممکن است شناسه‌هایی داشته باشد که با Rollback از بین رفته‌اند
          this.invalidateCacheAfterRollback(cache);
        }

        if ((index + 1) % PROGRESS_EVERY === 0) {
          await this.prisma.importJob.update({
            where: { id: jobId },
            data: { processedRows: index + 1, successRows: imported, errorRows: failed },
          });
        }
      }

      if (rowErrors.length > 0) {
        await this.prisma.importError.createMany({
          data: rowErrors.slice(0, 5000).map((e) => ({
            jobId,
            rowNumber: e.rowNumber,
            column: null,
            message: e.message.slice(0, 500),
            rawRow: e.rawRow as never,
          })),
        });
      }

      // شمارنده‌ها باید با شماره‌های واردشده همگام شوند، وگرنه اولین کتابی
      // که بعداً ثبت شود شماره تکراری می‌گیرد.
      await syncNumberingSequences(this.prisma, {
        solarYear: currentJalaliYear(),
        solarMonth: currentJalaliMonth(),
      });

      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: 'COMPLETED',
          finishedAt: new Date(),
          processedRows: rows.length,
          successRows: imported,
          errorRows: failed,
          duplicateRows: skipped,
        },
      });
    } catch (err) {
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', finishedAt: new Date() },
      });
      throw err;
    }

    await this.audit.record({
      action: 'import_books',
      entityType: 'ImportJob',
      entityId: jobId,
      entityLabel: `${job.originalName} — ${imported} کتاب وارد شد`,
      newData: { imported, skipped, failed, totalRows: rows.length },
      user, ip,
    });

    this.logger.log(
      `ورود اطلاعات «${job.originalName}» تمام شد: ${imported} موفق، ${skipped} رد شده، ${failed} ناموفق`,
    );

    return { imported, skipped, failed };
  }

  /**
   * تبدیل خطای فنی ردیف به پیامی که کتابدار بفهمد.
   * پیام خام Prisma («Unique constraint failed on the fields: (`barcode`)»)
   * برای کاربر بی‌معناست.
   */
  private humanizeRowError(err: unknown): string {
    if (err instanceof DomainError) return err.message;

    if (typeof err === 'object' && err !== null && 'code' in err) {
      const code = (err as { code: string }).code;
      const meta = (err as { meta?: { target?: unknown } }).meta;
      // `meta.target` در پریزما رشته یا آرایه رشته است، ولی نوعش تضمینی
      // نیست؛ شکل غیرمنتظره باید به رشته خالی برسد نه «[object Object]»
      const rawTarget = meta?.target;
      const target = Array.isArray(rawTarget)
        ? rawTarget.map((t) => String(t)).join(',')
        : typeof rawTarget === 'string'
          ? rawTarget
          : '';

      if (code === 'P2002') {
        if (/barcode/i.test(target)) return 'بارکد تکراری است.';
        if (/accession/i.test(target)) return 'شماره ثبت تکراری است.';
        if (/asset/i.test(target)) return 'شماره اموال تکراری است.';
        if (/libraryCode/i.test(target)) return 'کد کتابخانه تکراری است.';
        return 'یکی از شناسه‌های این ردیف تکراری است.';
      }
      if (code === 'P2003') return 'یکی از ارجاع‌های این ردیف (مکان یا دسته) نامعتبر است.';
      if (code === 'P2025') return 'رکورد مرتبطی که این ردیف به آن اشاره می‌کند یافت نشد.';
    }

    return err instanceof Error ? err.message : 'خطای نامشخص در پردازش این ردیف.';
  }

  /**
   * پاک کردن Cache پس از Rollback.
   *
   * Cache شناسه ناشر/پدیدآور/دسته‌ای را نگه می‌دارد که ممکن است در همان
   * تراکنش شکست‌خورده ساخته شده باشند. آن شناسه‌ها دیگر در دیتابیس وجود
   * ندارند و استفاده مجددشان در ردیف بعدی، خطای کلید خارجی می‌دهد.
   */
  private invalidateCacheAfterRollback(cache: {
    publishers: Map<string, string>; persons: Map<string, string>;
    categories: Map<string, string>; locations: Map<string, string>;
    donors: Map<string, string>;
  }): void {
    cache.publishers.clear();
    cache.persons.clear();
    cache.categories.clear();
    cache.donors.clear();
    // مکان‌ها هرگز در Import ساخته نمی‌شوند (فقط جستجو می‌شوند)، پس امن‌اند
  }

  // ── درج یک ردیف ────────────────────────────────────────────────────────

  private async importRow(
    tx: Prisma.TransactionClient,
    row: Record<string, string>,
    options: { branchId: string; skipDuplicates?: boolean; defaultLocationId?: string | null },
    cache: {
      publishers: Map<string, string>; persons: Map<string, string>;
      categories: Map<string, string>; locations: Map<string, string>;
      donors: Map<string, string>;
    },
    userId: string,
  ): Promise<'imported' | 'skipped'> {
    const title = row['title']?.trim();
    if (!title) throw new Error('عنوان خالی است.');

    const isbn13 = toCanonicalIsbn13(row['isbn'] ?? '');

    // تشخیص تکراری بر اساس شابک
    if (isbn13 && options.skipDuplicates) {
      const existing = await tx.book.findFirst({
        where: { isbn13, deletedAt: null }, select: { id: true },
      });
      if (existing) return 'skipped';
    }

    const publisherId = row['publisher']
      ? await this.resolveCached(cache.publishers, row['publisher'], async (name) => {
          const normalized = persianNormalize(name);
          const found = await tx.publisher.findFirst({
            where: { nameNormalized: normalized, deletedAt: null }, select: { id: true },
          });
          return found?.id ?? (await tx.publisher.create({ data: { name } })).id;
        })
      : null;

    const categoryId = row['category']
      ? await this.resolveCategoryPath(tx, row['category'], cache.categories)
      : null;

    const book = await tx.book.create({
      data: {
        title,
        subtitle: row['subtitle']?.trim() || null,
        publisherId,
        publicationYear: this.parseYear(row['publicationYear']),
        edition: this.parseInt(row['edition'], 1, 500),
        isbn13,
        isbnRaw: row['isbn']?.trim() || null,
        pageCount: this.parseInt(row['pageCount'], 1, 50_000),
        language: row['language']?.trim() || 'fa',
        summary: row['summary']?.trim() || null,
        keywords: this.parseList(row['keywords']),
        internalNote: row['note']?.trim() || null,
        createdById: userId,
        ...(categoryId ? { categories: { create: [{ categoryId, isPrimary: true }] } } : {}),
      },
      select: { id: true },
    });

    // ── پدیدآورندگان ────────────────────────────────────────────────────
    const contributors: Array<{ personId: string; role: 'AUTHOR' | 'TRANSLATOR'; position: number }> = [];
    for (const [i, name] of this.parseList(row['author']).entries()) {
      const personId = await this.resolveCached(cache.persons, name, async (n) => {
        const normalized = persianNormalize(n);
        const found = await tx.person.findFirst({
          where: { nameNormalized: normalized, deletedAt: null }, select: { id: true },
        });
        return found?.id ?? (await tx.person.create({ data: { fullName: n } })).id;
      });
      contributors.push({ personId, role: 'AUTHOR', position: i });
    }
    for (const [i, name] of this.parseList(row['translator']).entries()) {
      const personId = await this.resolveCached(cache.persons, name, async (n) => {
        const normalized = persianNormalize(n);
        const found = await tx.person.findFirst({
          where: { nameNormalized: normalized, deletedAt: null }, select: { id: true },
        });
        return found?.id ?? (await tx.person.create({ data: { fullName: n } })).id;
      });
      contributors.push({ personId, role: 'TRANSLATOR', position: i });
    }
    if (contributors.length > 0) {
      await tx.bookContributor.createMany({
        data: contributors.map((c) => ({ ...c, bookId: book.id })),
        skipDuplicates: true,
      });
    }

    // ── نسخه‌های فیزیکی ─────────────────────────────────────────────────
    const copyCount = this.parseInt(row['copies'], 1, 500) ?? 1;
    const locationId = row['locationCode']
      ? await this.resolveCached(cache.locations, row['locationCode'], async (code) => {
          const loc = await tx.location.findFirst({
            where: { fullCode: code.trim().toUpperCase(), deletedAt: null },
            select: { id: true },
          });
          // کد قفسه ناموجود ردیف را باطل نمی‌کند؛ کتاب بدون مکان ثبت می‌شود
          return loc?.id ?? '';
        })
      : (options.defaultLocationId ?? null);

    const donorId = row['donor']
      ? await this.resolveCached(cache.donors, row['donor'], async (name) => {
          const found = await tx.donor.findFirst({
            where: { fullName: name, deletedAt: null }, select: { id: true },
          });
          return found?.id ?? (await tx.donor.create({ data: { fullName: name } })).id;
        })
      : null;

    // شماره‌های دستی فایل مقدم‌اند؛ فقط برای نسخه اول استفاده می‌شوند
    // (اگر ردیف ۳ نسخه دارد، دو نسخه بعدی شماره خودکار می‌گیرند)
    const manualAccession = row['accessionNumber']?.trim();
    const manualBarcode = row['barcode'] ? normalizeDigits(row['barcode']).trim() : '';

    const autoAccessions = await this.numbering.nextBatch(
      tx, 'accession', manualAccession ? copyCount - 1 : copyCount,
    );
    const autoBarcodes = await this.numbering.nextBatch(
      tx, 'barcode', manualBarcode ? copyCount - 1 : copyCount,
    );

    const copies: Prisma.BookCopyCreateManyInput[] = [];
    for (let i = 0; i < copyCount; i++) {
      const useManualAccession = i === 0 && manualAccession;
      const useManualBarcode = i === 0 && manualBarcode;
      copies.push({
        bookId: book.id,
        branchId: options.branchId,
        copyNumber: i + 1,
        accessionNumber: useManualAccession
          ? manualAccession
          : autoAccessions[manualAccession ? i - 1 : i],
        barcode: useManualBarcode
          ? manualBarcode
          : autoBarcodes[manualBarcode ? i - 1 : i],
        libraryCode: i === 0 ? (row['libraryCode']?.trim() || null) : null,
        assetNumber: i === 0 ? (row['assetNumber']?.trim() || null) : null,
        locationId: locationId || null,
        donorId,
        acquisitionSource: donorId ? 'DONATION' : 'PURCHASE',
        purchasePrice: this.parseDecimal(row['price']),
        createdById: userId,
      });
    }
    await tx.bookCopy.createMany({ data: copies });

    return 'imported';
  }

  // ── کمکی‌ها ────────────────────────────────────────────────────────────

  /** خواندن فایل Excel یا CSV به آرایه‌ای از اشیاء کلید-مقدار. */
  private async readWorkbook(
    buffer: Buffer,
    fileName: string,
    limit?: number,
  ): Promise<{ headers: string[]; rows: Array<Record<string, string>>; totalRows: number }> {
    const workbook = new ExcelJS.Workbook();

    try {
      if (fileName.toLowerCase().endsWith('.csv')) {
        // ExcelJS با Buffer خام CSV مشکل دارد؛ از Stream استفاده می‌کنیم
        const { Readable } = await import('node:stream');
        // حذف BOM — وگرنه نام اولین ستون با نویسه نامرئی شروع می‌شود
        const text = buffer.toString('utf8').replace(/^﻿/, '');
        await workbook.csv.read(Readable.from([text]));
      } else {
        await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
      }
    } catch (err) {
      throw new DomainError(
        ERROR_CODES.IMPORT_FILE_INVALID,
        'فایل قابل خواندن نیست. مطمئن شوید فرمت آن xlsx یا csv معتبر است.',
        { detail: err instanceof Error ? err.message : String(err) },
      );
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new DomainError(ERROR_CODES.IMPORT_FILE_INVALID, 'فایل هیچ برگه‌ای ندارد.');
    }

    const headerRow = sheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      /*
       * سرصفحه هم باید از همان مسیر ردیف‌های داده بگذرد.
       *
       * `String(cell.value)` روی سلول ساده کار می‌کند، ولی سرصفحه فایل‌های
       * واقعی معمولاً قالب‌بندی دارد و ExcelJS آن را به‌جای رشته، شیء
       * `richText` می‌دهد؛ نتیجه‌اش نام ستون `[object Object]` می‌شد و آن
       * ستون دیگر قابل نگاشت نبود. `cellToString` هر سه حالت richText،
       * فرمول و لینک را باز می‌کند.
       */
      headers[colNumber - 1] = cellToString(cell.value);
    });

    const rows: Array<Record<string, string>> = [];
    let totalRows = 0;

    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;

      const record: Record<string, string> = {};
      let hasValue = false;
      for (const [index, header] of headers.entries()) {
        if (!header) continue;
        const cell = row.getCell(index + 1);
        const value = cellToString(cell.value);
        record[header] = value;
        if (value) hasValue = true;
      }

      // ردیف‌های کاملاً خالی (که در انتهای فایل‌های Excel فراوان‌اند) رد می‌شوند
      if (!hasValue) return;

      totalRows++;
      if (!limit || rows.length < limit) rows.push(record);
    });

    return { headers: headers.filter(Boolean), rows, totalRows };
  }

  private mapRow(
    raw: Record<string, string>,
    mapping: Record<string, string>,
  ): Record<string, string> {
    const mapped: Record<string, string> = {};
    for (const [column, field] of Object.entries(mapping)) {
      if (!field) continue;
      const value = raw[column];
      if (value !== undefined && value !== '') mapped[field] = value;
    }
    return mapped;
  }

  private async resolveCached(
    cache: Map<string, string>,
    key: string,
    resolver: (key: string) => Promise<string>,
  ): Promise<string> {
    const trimmed = key.trim();
    const cached = cache.get(trimmed);
    if (cached !== undefined) return cached;
    const value = await resolver(trimmed);
    cache.set(trimmed, value);
    return value;
  }

  /** دسته‌بندی تودرتو از رشته «ادبیات/شعر/غزل» می‌سازد. */
  private async resolveCategoryPath(
    tx: Prisma.TransactionClient,
    pathString: string,
    cache: Map<string, string>,
  ): Promise<string | null> {
    const cached = cache.get(pathString);
    if (cached !== undefined) return cached || null;

    const parts = pathString.split(/[/>\\]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return null;

    let parentId: string | null = null;
    let parentPath = '.';
    let depth = 0;
    let lastId: string | null = null;

    for (const name of parts) {
      const existing: { id: string; path: string } | null = await tx.category.findFirst({
        where: { name, parentId, kind: 'SUBJECT', deletedAt: null },
        select: { id: true, path: true },
      });

      if (existing) {
        lastId = existing.id;
        parentPath = existing.path;
      } else {
        // نوع صریح لازم است: `parentId` در حلقه بازتعریف می‌شود و TypeScript
        // بدون آن نمی‌تواند نوع را استنتاج کند (ارجاع حلقوی در استنتاج).
        const created: { id: string } = await tx.category.create({
          data: { name, parentId, kind: 'SUBJECT', depth, path: parentPath },
          select: { id: true },
        });
        const newPath = `${parentPath}${created.id}.`;
        await tx.category.update({ where: { id: created.id }, data: { path: newPath } });
        lastId = created.id;
        parentPath = newPath;
      }
      parentId = lastId;
      depth++;
    }

    cache.set(pathString, lastId ?? '');
    return lastId;
  }

  private parseYear(value?: string): number | null {
    if (!value) return null;
    const n = Number(normalizeDigits(value).replace(/\D/g, '').slice(0, 4));
    return n >= 1000 && n <= 2200 ? n : null;
  }

  private parseInt(value: string | undefined, min: number, max: number): number | null {
    if (!value) return null;
    const n = Number(normalizeDigits(value).replace(/\D/g, ''));
    return Number.isFinite(n) && n >= min && n <= max ? n : null;
  }

  private parseDecimal(value?: string): Prisma.Decimal | null {
    if (!value) return null;
    const cleaned = normalizeDigits(value).replace(/[^\d.]/g, '');
    if (!cleaned) return null;
    try {
      return new Prisma.Decimal(cleaned);
    } catch {
      return null;
    }
  }

  /** «حافظ، سعدی» یا «حافظ,سعدی» یا «حافظ؛ سعدی» → ['حافظ','سعدی'] */
  private parseList(value?: string): string[] {
    if (!value) return [];
    return value
      .split(/[,،;؛|]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 20);
  }

  private async readStoredFile(key: string): Promise<Buffer> {
    const { readFile } = await import('node:fs/promises');
    return readFile(this.storage.absolutePath(key));
  }

  private async defaultBranchId(): Promise<string> {
    const branch = await this.prisma.branch.findFirst({
      where: { isDefault: true }, select: { id: true },
    });
    if (!branch) throw new DomainError(ERROR_CODES.SETUP_REQUIRED, 'شعبه پیش‌فرض تعریف نشده است.');
    return branch.id;
  }

  async getJob(id: string) {
    const job = await this.prisma.importJob.findUnique({
      where: { id },
      include: { errors: { take: 200, orderBy: { rowNumber: 'asc' } } },
    });
    if (!job) throw DomainError.notFound('کار ورود اطلاعات');
    return job;
  }

  async listJobs(limit = 20) {
    return this.prisma.importJob.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, type: true, status: true, originalName: true, totalRows: true,
        successRows: true, errorRows: true, duplicateRows: true,
        createdAt: true, finishedAt: true,
      },
    });
  }
}

/** فرار دادن نویسه‌های ویژه Regex در نام مستعار ستون. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** تبدیل مقدار سلول Excel به رشته — سلول می‌تواند فرمول، لینک یا متن غنی باشد. */
function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  if (typeof value === 'object') {
    // سلول فرمول: نتیجه محاسبه‌شده مهم است نه خود فرمول
    if ('result' in value) return cellToString(value.result);
    if ('text' in value) return String(value.text).trim();
    if ('richText' in value) {
      return (value.richText as Array<{ text: string }>).map((r) => r.text).join('').trim();
    }
    if ('hyperlink' in value) return String(value.hyperlink);

    /*
     * شکل ناشناخته. `String(value)` اینجا «[object Object]» می‌دهد و آن
     * رشته مستقیم داخل عنوان کتاب می‌نشست. رشته خالی بهتر است: سلول
     * خالی در گزارش اعتبارسنجی دیده و اصلاح می‌شود، ولی «[object Object]»
     * یک مقدارِ به‌ظاهر معتبر است که از اعتبارسنجی رد می‌شود.
     */
    return '';
  }
  return '';
}
