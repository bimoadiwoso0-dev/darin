-- ═══════════════════════════════════════════════════════════════════════════
--  لایه جستجوی فارسی + قیدهای یکپارچگی داده
--
--  این Migration دستی نوشته شده چون Prisma از Trigger، تابع SQL و
--  Partial Unique Index پشتیبانی نمی‌کند.
--  مستندات: docs/DATABASE.md §۵ و §۶
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ───────────────────────────────────────────────────────────────────────────
--  ۱. نرمال‌سازی متن فارسی
--
--  باید **دقیقاً** با `persianNormalize()` در
--  packages/shared/src/persian/normalize.ts یکسان بماند.
--  تست تطابق: apps/api/test/persian-normalize.parity.spec.ts
--
--  IMMUTABLE است تا بتوان روی خروجی‌اش ایندکس ساخت.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION persian_normalize(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $fn$
  SELECT lower(btrim(
    regexp_replace(
      -- گام ۳: هر چیزی جز رقم، حرف لاتین و حروف فارسی/عربی → فاصله
      regexp_replace(
        -- گام ۲: یکسان‌سازی نویسه‌های هم‌ارز و ارقام
        translate(
          -- گام ۱: حذف اعراب، کشیده، نویسه‌های کنترلی جهت و همزه تنها
          regexp_replace(input, E'[ً-ٰٟـ​-‏ء]', '', 'g'),
          --  ی‌ها       ک‌ها     ه‌ها      ا‌ها          و
          E'يېۍىئ' ||   -- ي ې ۍ ى ئ  → ی
          E'كڪ'                   ||   -- ك ڪ        → ک
          E'ةۀ'                   ||   -- ة ۀ        → ه
          E'أإآٱ'       ||   -- أ إ آ ٱ    → ا
          E'ؤ'                         ||   -- ؤ          → و
          E'٠١٢٣٤٥٦٧٨٩' || -- ٠-٩
          E'۰۱۲۳۴۵۶۷۸۹',   -- ۰-۹
          E'ییییی'
          || E'کک'
          || E'هه'
          || E'اااا'
          || E'و'
          || '0123456789'
          || '0123456789'
        ),
        E'[^0-9A-Za-zء-غف-يٮ-ۓەۥۦۮۯۺ-ۿ]',
        ' ',
        'g'
      ),
      -- گام ۴: جمع کردن فاصله‌های متوالی
      E'\\s+', ' ', 'g'
    )
  ));
$fn$;

COMMENT ON FUNCTION persian_normalize(text) IS
  'نرمال‌سازی متن فارسی برای جستجو. معادل TypeScript: packages/shared/src/persian/normalize.ts';

-- ───────────────────────────────────────────────────────────────────────────
--  ۲. Trigger عمومی نرمال‌سازی
--  استفاده: CREATE TRIGGER ... EXECUTE FUNCTION trg_normalize_text('dstCol', 'srcCol1', 'srcCol2')
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trg_normalize_text()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  dst      text  := TG_ARGV[0];
  row_json jsonb := to_jsonb(NEW);
  combined text  := '';
  i        int;
BEGIN
  FOR i IN 1 .. TG_NARGS - 1 LOOP
    combined := combined || ' ' || coalesce(row_json ->> TG_ARGV[i], '');
  END LOOP;

  NEW := jsonb_populate_record(
    NEW,
    row_json || jsonb_build_object(dst, persian_normalize(combined))
  );
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER persons_normalize BEFORE INSERT OR UPDATE ON "persons"
  FOR EACH ROW EXECUTE FUNCTION trg_normalize_text('nameNormalized', 'fullName', 'latinName');

CREATE TRIGGER publishers_normalize BEFORE INSERT OR UPDATE ON "publishers"
  FOR EACH ROW EXECUTE FUNCTION trg_normalize_text('nameNormalized', 'name', 'latinName');

CREATE TRIGGER series_normalize BEFORE INSERT OR UPDATE ON "series"
  FOR EACH ROW EXECUTE FUNCTION trg_normalize_text('titleNormalized', 'title');

CREATE TRIGGER categories_normalize BEFORE INSERT OR UPDATE ON "categories"
  FOR EACH ROW EXECUTE FUNCTION trg_normalize_text('nameNormalized', 'name');

CREATE TRIGGER tags_normalize BEFORE INSERT OR UPDATE ON "tags"
  FOR EACH ROW EXECUTE FUNCTION trg_normalize_text('nameNormalized', 'name');

CREATE TRIGGER donors_normalize BEFORE INSERT OR UPDATE ON "donors"
  FOR EACH ROW EXECUTE FUNCTION trg_normalize_text('nameNormalized', 'fullName');

CREATE TRIGGER members_normalize BEFORE INSERT OR UPDATE ON "members"
  FOR EACH ROW EXECUTE FUNCTION trg_normalize_text(
    'nameNormalized', 'firstName', 'lastName', 'memberCode', 'nationalId', 'mobile', 'phone');

CREATE TRIGGER locations_normalize BEFORE INSERT OR UPDATE ON "locations"
  FOR EACH ROW EXECUTE FUNCTION trg_normalize_text('nameNormalized', 'name', 'code', 'fullCode');

CREATE TRIGGER books_normalize_title BEFORE INSERT OR UPDATE ON "books"
  FOR EACH ROW EXECUTE FUNCTION trg_normalize_text(
    'titleNormalized', 'title', 'subtitle', 'titleEn', 'originalTitle', 'volumeTitle');

-- ───────────────────────────────────────────────────────────────────────────
--  ۳. بردار جستجوی کتاب
--
--  وزن‌ها:
--    A = عنوان‌ها و شناسه‌های دقیق (ISBN، شماره کتابشناسی ملی)
--    B = پدیدآورندگان (نویسنده، مترجم، ...)
--    C = ناشر و مجموعه
--    D = کلیدواژه، خلاصه، رده‌بندی
--
--  از پیکربندی 'simple' استفاده می‌شود چون PostgreSQL دیکشنری فارسی ندارد؛
--  ریشه‌یابی را با نرمال‌سازی + جستجوی پیشوندی (`:*`) + ایندکس trigram جبران می‌کنیم.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION book_search_vector(p_book_id uuid)
RETURNS tsvector
LANGUAGE sql
STABLE
AS $fn$
  SELECT
      setweight(to_tsvector('simple', persian_normalize(
        concat_ws(' ', b."title", b."subtitle", b."titleEn", b."originalTitle", b."volumeTitle")
      )), 'A')
   || setweight(to_tsvector('simple',
        concat_ws(' ',
          nullif(regexp_replace(coalesce(b."isbn13", ''), '\D', '', 'g'), ''),
          nullif(regexp_replace(coalesce(b."isbnRaw", ''), '\D', '', 'g'), ''),
          b."nationalBibNumber", b."issn")
      ), 'A')
   || setweight(to_tsvector('simple', persian_normalize(
        coalesce((
          SELECT string_agg(concat_ws(' ', p."fullName", p."latinName"), ' ')
          FROM "book_contributors" bc
          JOIN "persons" p ON p."id" = bc."personId"
          WHERE bc."bookId" = b."id"
        ), '')
      )), 'B')
   || setweight(to_tsvector('simple', persian_normalize(
        concat_ws(' ', pub."name", pub."latinName", s."title", b."publicationPlace")
      )), 'C')
   || setweight(to_tsvector('simple', persian_normalize(
        concat_ws(' ',
          array_to_string(coalesce(b."keywords", ARRAY[]::text[]), ' '),
          b."summary", b."deweyCode", b."congressCode", b."ageRating")
      )), 'D')
  FROM "books" b
  LEFT JOIN "publishers" pub ON pub."id" = b."publisherId"
  LEFT JOIN "series"     s   ON s."id"   = b."seriesId"
  WHERE b."id" = p_book_id;
$fn$;

-- بازسازی بردار پس از تغییر رکورد کتاب.
-- شرط `IS DISTINCT FROM` از بازگشت بی‌نهایت جلوگیری می‌کند: UPDATE داخلی
-- همین Trigger را یک بار دیگر صدا می‌زند، اما بار دوم مقدار یکسان است و متوقف می‌شود.
CREATE OR REPLACE FUNCTION trg_book_refresh_search()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v tsvector;
BEGIN
  v := book_search_vector(NEW."id");
  IF NEW."searchVector" IS DISTINCT FROM v THEN
    UPDATE "books" SET "searchVector" = v WHERE "id" = NEW."id";
  END IF;
  RETURN NULL;
END;
$fn$;

CREATE TRIGGER books_refresh_search AFTER INSERT OR UPDATE ON "books"
  FOR EACH ROW EXECUTE FUNCTION trg_book_refresh_search();

-- تغییر پدیدآورندگان یک کتاب → بردار همان کتاب بازسازی می‌شود.
CREATE OR REPLACE FUNCTION trg_contributor_refresh_search()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  target uuid := coalesce(NEW."bookId", OLD."bookId");
BEGIN
  UPDATE "books" SET "searchVector" = book_search_vector(target) WHERE "id" = target;
  RETURN NULL;
END;
$fn$;

CREATE TRIGGER book_contributors_refresh_search
  AFTER INSERT OR UPDATE OR DELETE ON "book_contributors"
  FOR EACH ROW EXECUTE FUNCTION trg_contributor_refresh_search();

-- تغییر نام یک پدیدآورنده → بردار همه کتاب‌های او بازسازی می‌شود.
-- شرط `WHEN` باعث می‌شود ویرایش زندگی‌نامه یا عکس، این کار سنگین را راه نیندازد.
CREATE OR REPLACE FUNCTION trg_person_refresh_books()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  UPDATE "books" b
     SET "searchVector" = book_search_vector(b."id")
   WHERE b."id" IN (SELECT "bookId" FROM "book_contributors" WHERE "personId" = NEW."id");
  RETURN NULL;
END;
$fn$;

CREATE TRIGGER persons_refresh_books AFTER UPDATE ON "persons"
  FOR EACH ROW
  WHEN (OLD."fullName" IS DISTINCT FROM NEW."fullName"
     OR OLD."latinName" IS DISTINCT FROM NEW."latinName")
  EXECUTE FUNCTION trg_person_refresh_books();

-- تغییر نام ناشر → بردار کتاب‌های آن ناشر بازسازی می‌شود.
CREATE OR REPLACE FUNCTION trg_publisher_refresh_books()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  UPDATE "books" b
     SET "searchVector" = book_search_vector(b."id")
   WHERE b."publisherId" = NEW."id";
  RETURN NULL;
END;
$fn$;

CREATE TRIGGER publishers_refresh_books AFTER UPDATE ON "publishers"
  FOR EACH ROW
  WHEN (OLD."name" IS DISTINCT FROM NEW."name"
     OR OLD."latinName" IS DISTINCT FROM NEW."latinName")
  EXECUTE FUNCTION trg_publisher_refresh_books();

-- ───────────────────────────────────────────────────────────────────────────
--  ۴. ایندکس‌های جستجو
-- ───────────────────────────────────────────────────────────────────────────

-- جستجوی کلمه‌ای (اصلی)
CREATE INDEX "books_searchVector_gin" ON "books" USING GIN ("searchVector");

-- جستجوی فازی / غلط املایی / ILIKE
CREATE INDEX "books_titleNormalized_trgm" ON "books" USING GIN ("titleNormalized" gin_trgm_ops);
CREATE INDEX "persons_nameNormalized_trgm" ON "persons" USING GIN ("nameNormalized" gin_trgm_ops);
CREATE INDEX "publishers_nameNormalized_trgm" ON "publishers" USING GIN ("nameNormalized" gin_trgm_ops);
CREATE INDEX "series_titleNormalized_trgm" ON "series" USING GIN ("titleNormalized" gin_trgm_ops);
CREATE INDEX "categories_nameNormalized_trgm" ON "categories" USING GIN ("nameNormalized" gin_trgm_ops);
CREATE INDEX "members_nameNormalized_trgm" ON "members" USING GIN ("nameNormalized" gin_trgm_ops);
CREATE INDEX "locations_nameNormalized_trgm" ON "locations" USING GIN ("nameNormalized" gin_trgm_ops);

-- جستجوی پیشوندی روی بارکد و شماره ثبت (LIKE 'ABC%')
CREATE INDEX "book_copies_barcode_prefix" ON "book_copies" ("barcode" text_pattern_ops);
CREATE INDEX "book_copies_accession_prefix" ON "book_copies" ("accessionNumber" text_pattern_ops);
CREATE INDEX "members_memberCode_prefix" ON "members" ("memberCode" text_pattern_ops);

-- کوئری زیردرخت: WHERE path LIKE '.a1.b2.%'
CREATE INDEX "locations_path_prefix" ON "locations" ("path" text_pattern_ops);
CREATE INDEX "categories_path_prefix" ON "categories" ("path" text_pattern_ops);

-- ───────────────────────────────────────────────────────────────────────────
--  ۵. ایندکس‌های جزئی (Partial) — کوچک‌تر و سریع‌تر
--  اکثر کوئری‌های سیستم فقط رکوردهای حذف‌نشده را می‌خواهند.
-- ───────────────────────────────────────────────────────────────────────────
CREATE INDEX "books_alive_recent" ON "books" ("createdAt" DESC) WHERE "deletedAt" IS NULL;
CREATE INDEX "book_copies_alive_status" ON "book_copies" ("branchId", "status") WHERE "deletedAt" IS NULL;
CREATE INDEX "book_copies_alive_location" ON "book_copies" ("locationId") WHERE "deletedAt" IS NULL;
CREATE INDEX "members_alive_status" ON "members" ("branchId", "status") WHERE "deletedAt" IS NULL;

-- امانت‌های باز — پرتکرارترین کوئری سیستم (داشبورد، پروفایل عضو، دیرکردها)
CREATE INDEX "loans_open_by_member" ON "loans" ("memberId", "dueAt") WHERE "status" IN ('ACTIVE', 'OVERDUE');
CREATE INDEX "loans_open_by_due" ON "loans" ("dueAt") WHERE "status" IN ('ACTIVE', 'OVERDUE');

-- صف رزروهای فعال
CREATE INDEX "reservations_active_queue" ON "reservations" ("bookId", "queuePosition")
  WHERE "status" IN ('PENDING', 'READY');

-- جریمه‌های تسویه‌نشده
CREATE INDEX "fines_outstanding" ON "fines" ("memberId") WHERE "status" IN ('UNPAID', 'PARTIALLY_PAID');

-- ───────────────────────────────────────────────────────────────────────────
--  ۶. قیدهای یکپارچگی که Prisma نمی‌تواند بیان کند
--
--  اینها آخرین خط دفاع‌اند: حتی اگر منطق برنامه اشتباه کند یا دو درخواست
--  هم‌زمان برسند، دیتابیس داده ناسازگار را نمی‌پذیرد.
-- ───────────────────────────────────────────────────────────────────────────

-- یک نسخه فیزیکی هرگز نمی‌تواند هم‌زمان دو امانت باز داشته باشد.
-- این قید Race Condition امانت هم‌زمان را در سطح دیتابیس می‌بندد (ADR-07).
CREATE UNIQUE INDEX "loans_one_open_per_copy" ON "loans" ("copyId")
  WHERE "status" IN ('ACTIVE', 'OVERDUE');

-- یک عضو نمی‌تواند دو رزرو فعال روی یک عنوان داشته باشد.
CREATE UNIQUE INDEX "reservations_one_active_per_member_book"
  ON "reservations" ("bookId", "memberId")
  WHERE "status" IN ('PENDING', 'READY');

-- شماره اموال و کد کتابخانه: یکتا در هر شعبه، اما فقط وقتی مقدار دارند.
CREATE UNIQUE INDEX "book_copies_asset_unique_per_branch"
  ON "book_copies" ("branchId", "assetNumber")
  WHERE "assetNumber" IS NOT NULL AND "deletedAt" IS NULL;

CREATE UNIQUE INDEX "book_copies_library_code_unique_per_branch"
  ON "book_copies" ("branchId", "libraryCode")
  WHERE "libraryCode" IS NOT NULL AND "deletedAt" IS NULL;

-- هر کتاب حداکثر یک «موضوع اصلی» دارد.
CREATE UNIQUE INDEX "book_categories_single_primary" ON "book_categories" ("bookId")
  WHERE "isPrimary";

-- دقیقاً یک شعبه پیش‌فرض و یک نوع عضویت پیش‌فرض.
CREATE UNIQUE INDEX "branches_single_default" ON "branches" ((true)) WHERE "isDefault";
CREATE UNIQUE INDEX "membership_types_single_default" ON "membership_types" ((true)) WHERE "isDefault";

-- مبالغ مالی هرگز منفی نمی‌شوند و پرداخت از مبلغ جریمه بیشتر نمی‌شود.
ALTER TABLE "fines"
  ADD CONSTRAINT "fines_amount_non_negative" CHECK ("amount" >= 0),
  ADD CONSTRAINT "fines_paid_within_amount" CHECK ("paidAmount" >= 0 AND "paidAmount" <= "amount");

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);

-- موعد بازگشت هرگز قبل از تاریخ امانت نیست.
ALTER TABLE "loans"
  ADD CONSTRAINT "loans_due_after_loaned" CHECK ("dueAt" >= "loanedAt"),
  ADD CONSTRAINT "loans_renewal_count_non_negative" CHECK ("renewalCount" >= 0);

-- ظرفیت قفسه منفی نیست.
ALTER TABLE "locations"
  ADD CONSTRAINT "locations_capacity_non_negative" CHECK ("capacity" IS NULL OR "capacity" >= 0);

-- شماره نسخه از ۱ شروع می‌شود.
ALTER TABLE "book_copies"
  ADD CONSTRAINT "book_copies_copy_number_positive" CHECK ("copyNumber" >= 1);

-- یک کتاب نمی‌تواند جلدِ خودش باشد.
ALTER TABLE "books"
  ADD CONSTRAINT "books_no_self_parent" CHECK ("parentBookId" IS NULL OR "parentBookId" <> "id");

-- یک مکان نمی‌تواند والد خودش باشد (ADR: چرخه‌های عمیق‌تر در سرویس بررسی می‌شوند).
ALTER TABLE "locations"
  ADD CONSTRAINT "locations_no_self_parent" CHECK ("parentId" IS NULL OR "parentId" <> "id");

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_no_self_parent" CHECK ("parentId" IS NULL OR "parentId" <> "id");

-- اعلان باید دقیقاً یک گیرنده داشته باشد (عضو یا کاربر سیستم).
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_single_recipient"
  CHECK (("memberId" IS NOT NULL)::int + ("userId" IS NOT NULL)::int = 1);
