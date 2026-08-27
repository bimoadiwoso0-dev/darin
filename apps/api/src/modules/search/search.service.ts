import { Injectable } from '@nestjs/common';
import { normalizeDigits, persianNormalize, toCanonicalIsbn13 } from '@darin/shared';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';

export interface SearchFilters {
  publisherId?: string;
  personId?: string;
  categoryId?: string;
  seriesId?: string;
  language?: string;
  yearFrom?: number;
  yearTo?: number;
  locationId?: string;
  /** فقط عنوان‌هایی که حداقل یک نسخه در این وضعیت‌ها دارند */
  copyStatus?: string[];
  availableOnly?: boolean;
  overdueOnly?: boolean;
  reservedOnly?: boolean;
  donorId?: string;
}

export interface BookSearchHit {
  id: string;
  title: string;
  subtitle: string | null;
  volumeTitle: string | null;
  volumeNumber: number | null;
  publicationYear: number | null;
  isbn13: string | null;
  coverImageId: string | null;
  publisherName: string | null;
  authors: string[];
  totalCopies: number;
  availableCopies: number;
  /** نمونه‌ای از محل نگهداری — کتابدار باید بداند کجا برود */
  sampleLocation: string | null;
  score: number;
  /** اگر تطابق دقیق روی شناسه بود، اینجا مشخص می‌شود */
  exactMatch: 'BARCODE' | 'ACCESSION' | 'ISBN' | 'LIBRARY_CODE' | null;
}

export interface GlobalSearchResult {
  books: BookSearchHit[];
  members: Array<{
    id: string; memberCode: string; fullName: string; mobile: string | null;
    status: string; activeLoans: number;
  }>;
  copies: Array<{
    id: string; barcode: string; accessionNumber: string; status: string;
    bookTitle: string; locationCode: string | null;
  }>;
  locations: Array<{ id: string; name: string; fullCode: string; kind: string }>;
  totalBooks: number;
}

/**
 * موتور جستجو (قوانین ۱۳، ۱۴، ۴۴، ۶۴، ۱۰۶).
 *
 * ── راهبرد ────────────────────────────────────────────────────────────────
 * جستجو سه لایه دارد که به‌ترتیب امتیاز می‌دهند:
 *
 *  ۱. **تطابق دقیق شناسه** (بارکد، شماره ثبت، ISBN، کد کتابخانه)
 *     کتابدار بارکد را اسکن می‌کند و انتظار دارد همان کتاب اول بیاید.
 *     این مورد امتیاز ۱۰۰۰ می‌گیرد تا همیشه بالای فهرست باشد.
 *
 *  ۲. **جستجوی کلمه‌ای روی `searchVector`** با وزن‌های A/B/C/D
 *     عنوان > پدیدآور > ناشر > کلیدواژه. با `ts_rank_cd` رتبه‌بندی می‌شود.
 *
 *  ۳. **تشابه سه‌نویسه‌ای (trigram)** برای غلط املایی و اشتباه تایپی.
 *     «حافض» را به «حافظ» می‌رساند بدون اینکه آنها را یکسان بداند.
 *
 * ── چرا PostgreSQL و نه Elasticsearch (ADR-04) ──────────────────────────
 * برای ۱۰۰٬۰۰۰ عنوان، ایندکس GIN پاسخ را زیر ۳۰ms می‌دهد. Elasticsearch
 * در این مقیاس فقط یک سرویس دیگر برای همگام‌سازی و خرابی است.
 * این کلاس عمداً یک واسط ساده دارد تا در آینده قابل تعویض باشد.
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * جستجوی سراسری Header (قانون ۴۴).
   * با یک کادر، هم کتاب پیدا می‌شود هم عضو هم قفسه.
   */
  async global(query: string, limit = 5): Promise<GlobalSearchResult> {
    const raw = query.trim();
    if (raw.length < 2) {
      return { books: [], members: [], copies: [], locations: [], totalBooks: 0 };
    }

    const normalized = persianNormalize(raw);
    const digits = normalizeDigits(raw).replace(/\D/g, '');

    const [books, members, copies, locations] = await Promise.all([
      this.searchBooks(raw, {}, { limit, offset: 0 }),
      this.searchMembers(raw, normalized, digits, limit),
      this.searchCopies(raw, digits, limit),
      this.searchLocations(normalized, raw, limit),
    ]);

    return {
      books: books.hits,
      members,
      copies,
      locations,
      totalBooks: books.total,
    };
  }

  /**
   * جستجوی کامل کتاب با فیلترهای ترکیبی و صفحه‌بندی.
   *
   * کوئری با SQL خام نوشته شده چون Prisma از `ts_rank_cd` و `similarity`
   * پشتیبانی نمی‌کند. تمام مقادیر پارامتری‌اند — امکان تزریق SQL وجود ندارد.
   */
  async searchBooks(
    query: string,
    filters: SearchFilters,
    paging: { limit: number; offset: number },
    sort: 'relevance' | 'title' | 'year' | 'newest' = 'relevance',
  ): Promise<{ hits: BookSearchHit[]; total: number; tookMs: number }> {
    const started = Date.now();
    const raw = query.trim();
    const normalized = persianNormalize(raw);
    const digits = normalizeDigits(raw).replace(/\D/g, '');
    const isbn = toCanonicalIsbn13(raw);

    const conditions: Prisma.Sql[] = [Prisma.sql`b."deletedAt" IS NULL`];

    // ── فیلترها ─────────────────────────────────────────────────────────
    if (filters.publisherId) {
      conditions.push(Prisma.sql`b."publisherId" = ${filters.publisherId}::uuid`);
    }
    if (filters.seriesId) {
      conditions.push(Prisma.sql`b."seriesId" = ${filters.seriesId}::uuid`);
    }
    if (filters.language) {
      conditions.push(Prisma.sql`b."language" = ${filters.language}`);
    }
    if (filters.yearFrom) {
      conditions.push(Prisma.sql`b."publicationYear" >= ${filters.yearFrom}`);
    }
    if (filters.yearTo) {
      conditions.push(Prisma.sql`b."publicationYear" <= ${filters.yearTo}`);
    }
    if (filters.personId) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM book_contributors bc
         WHERE bc."bookId" = b."id" AND bc."personId" = ${filters.personId}::uuid)`);
    }
    if (filters.categoryId) {
      // شامل زیردرخت دسته — «ادبیات» باید «غزل» را هم بیاورد
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM book_categories bcat
          JOIN categories cat ON cat."id" = bcat."categoryId"
         WHERE bcat."bookId" = b."id"
           AND (cat."id" = ${filters.categoryId}::uuid
                OR cat."path" LIKE '%.' || ${filters.categoryId} || '.%'))`);
    }
    if (filters.locationId) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM book_copies c
          JOIN locations l  ON l."id"  = c."locationId"
          JOIN locations lp ON lp."id" = ${filters.locationId}::uuid
         WHERE c."bookId" = b."id" AND c."deletedAt" IS NULL
           AND l."path" LIKE lp."path" || '%')`);
    }
    if (filters.donorId) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM book_copies c
         WHERE c."bookId" = b."id" AND c."donorId" = ${filters.donorId}::uuid
           AND c."deletedAt" IS NULL)`);
    }
    if (filters.availableOnly) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM book_copies c
         WHERE c."bookId" = b."id" AND c."deletedAt" IS NULL AND c."status" = 'AVAILABLE')`);
    }
    if (filters.copyStatus?.length) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM book_copies c
         WHERE c."bookId" = b."id" AND c."deletedAt" IS NULL
           AND c."status" = ANY(${filters.copyStatus}::"CopyStatus"[]))`);
    }
    if (filters.overdueOnly) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM book_copies c JOIN loans ln ON ln."copyId" = c."id"
         WHERE c."bookId" = b."id" AND ln."status" = 'OVERDUE')`);
    }
    if (filters.reservedOnly) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM reservations r
         WHERE r."bookId" = b."id" AND r."status" IN ('PENDING','READY'))`);
    }

    // ── شرط جستجوی متنی و امتیازدهی ─────────────────────────────────────
    let scoreExpr: Prisma.Sql = Prisma.sql`0::float4`;

    if (raw.length > 0) {
      const textConditions: Prisma.Sql[] = [];

      // لایه ۱: تطابق دقیق شناسه‌ها
      if (digits.length >= 4) {
        textConditions.push(Prisma.sql`EXISTS (
          SELECT 1 FROM book_copies c
           WHERE c."bookId" = b."id" AND c."deletedAt" IS NULL
             AND (c."barcode" = ${digits} OR c."accessionNumber" = ${digits}
                  OR c."libraryCode" = ${raw} OR c."assetNumber" = ${raw}))`);
      }
      if (isbn) {
        textConditions.push(Prisma.sql`b."isbn13" = ${isbn}`);
      }
      // لایه ۲: جستجوی کلمه‌ای
      if (normalized) {
        textConditions.push(Prisma.sql`b."searchVector" @@ persian_tsquery(${raw})`);
        // لایه ۳: تشابه سه‌نویسه‌ای برای غلط املایی
        textConditions.push(Prisma.sql`b."titleNormalized" %> ${normalized}`);
      }

      if (textConditions.length > 0) {
        conditions.push(Prisma.sql`(${Prisma.join(textConditions, ' OR ')})`);
      }

      scoreExpr = Prisma.sql`(
          CASE WHEN ${isbn ?? ''} <> '' AND b."isbn13" = ${isbn ?? ''} THEN 1000 ELSE 0 END
        + CASE WHEN ${digits.length >= 4} AND EXISTS (
            SELECT 1 FROM book_copies c
             WHERE c."bookId" = b."id" AND c."deletedAt" IS NULL
               AND (c."barcode" = ${digits} OR c."accessionNumber" = ${digits})
          ) THEN 1000 ELSE 0 END
        + coalesce(ts_rank_cd(b."searchVector", persian_tsquery(${raw})), 0) * 10
        + coalesce(similarity(b."titleNormalized", ${normalized}), 0) * 3
      )::float4`;
    }

    const where = Prisma.join(conditions, ' AND ');

    const orderBy =
      sort === 'title' ? Prisma.sql`b."titleNormalized" ASC`
      : sort === 'year' ? Prisma.sql`b."publicationYear" DESC NULLS LAST, b."titleNormalized" ASC`
      : sort === 'newest' ? Prisma.sql`b."createdAt" DESC`
      : Prisma.sql`score DESC, b."titleNormalized" ASC`;

    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string; title: string; subtitle: string | null;
        volumeTitle: string | null; volumeNumber: number | null;
        publicationYear: number | null; isbn13: string | null; coverImageId: string | null;
        publisherName: string | null; authors: string[] | null;
        totalCopies: bigint; availableCopies: bigint;
        sampleLocation: string | null; score: number;
      }>
    >`
      SELECT b."id", b."title", b."subtitle", b."volumeTitle", b."volumeNumber",
             b."publicationYear", b."isbn13", b."coverImageId",
             pub."name" AS "publisherName",
             (SELECT array_agg(p."fullName" ORDER BY bc."position")
                FROM book_contributors bc
                JOIN persons p ON p."id" = bc."personId"
               WHERE bc."bookId" = b."id" AND bc."role" IN ('AUTHOR','CO_AUTHOR')) AS authors,
             (SELECT count(*) FROM book_copies c
               WHERE c."bookId" = b."id" AND c."deletedAt" IS NULL) AS "totalCopies",
             (SELECT count(*) FROM book_copies c
               WHERE c."bookId" = b."id" AND c."deletedAt" IS NULL
                 AND c."status" = 'AVAILABLE') AS "availableCopies",
             (SELECT l."fullCode" FROM book_copies c
                JOIN locations l ON l."id" = c."locationId"
               WHERE c."bookId" = b."id" AND c."deletedAt" IS NULL
               ORDER BY CASE WHEN c."status" = 'AVAILABLE' THEN 0 ELSE 1 END
               LIMIT 1) AS "sampleLocation",
             ${scoreExpr} AS score
        FROM books b
        LEFT JOIN publishers pub ON pub."id" = b."publisherId"
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT ${paging.limit} OFFSET ${paging.offset}
    `;

    const countRows = await this.prisma.$queryRaw<Array<{ total: bigint }>>`
      SELECT count(*)::bigint AS total
        FROM books b
       WHERE ${where}
    `;

    const hits: BookSearchHit[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      volumeTitle: r.volumeTitle,
      volumeNumber: r.volumeNumber,
      publicationYear: r.publicationYear,
      isbn13: r.isbn13,
      coverImageId: r.coverImageId,
      publisherName: r.publisherName,
      authors: r.authors ?? [],
      totalCopies: Number(r.totalCopies),
      availableCopies: Number(r.availableCopies),
      sampleLocation: r.sampleLocation,
      score: Math.round(r.score * 100) / 100,
      exactMatch: r.score >= 1000 ? (isbn && r.isbn13 === isbn ? 'ISBN' : 'BARCODE') : null,
    }));

    return {
      hits,
      total: Number(countRows[0]?.total ?? 0),
      tookMs: Date.now() - started,
    };
  }

  /** پیشنهاد خودکار هنگام تایپ (Autocomplete). */
  async suggest(query: string, limit = 8): Promise<Array<{ text: string; type: string; id: string }>> {
    const normalized = persianNormalize(query);
    if (normalized.length < 2) return [];

    const [books, persons, publishers] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: string; title: string }>>`
        SELECT "id", "title" FROM books
         WHERE "deletedAt" IS NULL AND "titleNormalized" LIKE ${normalized + '%'}
         ORDER BY "titleNormalized" LIMIT ${limit}
      `,
      this.prisma.$queryRaw<Array<{ id: string; fullName: string }>>`
        SELECT "id", "fullName" FROM persons
         WHERE "deletedAt" IS NULL AND "nameNormalized" LIKE '%' || ${normalized} || '%'
         ORDER BY "nameNormalized" LIMIT ${Math.ceil(limit / 2)}
      `,
      this.prisma.$queryRaw<Array<{ id: string; name: string }>>`
        SELECT "id", "name" FROM publishers
         WHERE "deletedAt" IS NULL AND "nameNormalized" LIKE '%' || ${normalized} || '%'
         ORDER BY "nameNormalized" LIMIT 3
      `,
    ]);

    return [
      ...books.map((b) => ({ text: b.title, type: 'book', id: b.id })),
      ...persons.map((p) => ({ text: p.fullName, type: 'person', id: p.id })),
      ...publishers.map((p) => ({ text: p.name, type: 'publisher', id: p.id })),
    ].slice(0, limit);
  }

  // ── جستجوهای کمکی ──────────────────────────────────────────────────────

  private async searchMembers(raw: string, normalized: string, digits: string, limit: number) {
    if (!normalized && digits.length < 3) return [];
    const rows = await this.prisma.member.findMany({
      where: {
        deletedAt: null,
        OR: [
          { memberCode: { equals: raw, mode: 'insensitive' } },
          ...(normalized ? [{ nameNormalized: { contains: normalized } }] : []),
          ...(digits.length >= 4
            ? [{ mobile: { contains: digits } }, { nationalId: { contains: digits } }]
            : []),
        ],
      },
      take: limit,
      select: {
        id: true, memberCode: true, firstName: true, lastName: true,
        mobile: true, status: true,
        _count: { select: { loans: { where: { status: { in: ['ACTIVE', 'OVERDUE'] } } } } },
      },
    });
    return rows.map((m) => ({
      id: m.id,
      memberCode: m.memberCode,
      fullName: `${m.firstName} ${m.lastName}`,
      mobile: m.mobile,
      status: m.status,
      activeLoans: m._count.loans,
    }));
  }

  private async searchCopies(raw: string, digits: string, limit: number) {
    if (digits.length < 3 && raw.length < 3) return [];
    const rows = await this.prisma.bookCopy.findMany({
      where: {
        deletedAt: null,
        OR: [
          { barcode: { startsWith: digits } },
          { accessionNumber: { startsWith: digits } },
          { libraryCode: { contains: raw, mode: 'insensitive' } },
          { assetNumber: { contains: raw, mode: 'insensitive' } },
        ],
      },
      take: limit,
      select: {
        id: true, barcode: true, accessionNumber: true, status: true,
        book: { select: { title: true } },
        location: { select: { fullCode: true } },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      barcode: c.barcode,
      accessionNumber: c.accessionNumber,
      status: c.status,
      bookTitle: c.book.title,
      locationCode: c.location?.fullCode ?? null,
    }));
  }

  private async searchLocations(normalized: string, raw: string, limit: number) {
    if (!normalized && raw.length < 2) return [];
    return this.prisma.location.findMany({
      where: {
        deletedAt: null,
        OR: [
          ...(normalized ? [{ nameNormalized: { contains: normalized } }] : []),
          { fullCode: { contains: raw.toUpperCase() } },
        ],
      },
      take: limit,
      select: { id: true, name: true, fullCode: true, kind: true },
    });
  }
}
