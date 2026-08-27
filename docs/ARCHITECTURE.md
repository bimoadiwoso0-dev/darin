# معماری سامانه دارین (Darin LMS)

> سامانه جامع مدیریت کتابخانه — طراحی‌شده برای کتابخانه‌های ۱۰٬۰۰۰ تا ۵۰۰٬۰۰۰ جلدی

---

## ۱. خلاصه اجرایی

**دارین** یک سامانه مدیریت کتابخانه (ILS/LMS) با معماری **API-First** و **Modular Monolith** است.

| لایه | فناوری | دلیل انتخاب (خلاصه) |
|------|---------|---------------------|
| Backend | **NestJS 10 + TypeScript** | ماژولار بودن ذاتی، DI واقعی، Guard/Interceptor برای RBAC و Audit، اکوسیستم بالغ |
| ORM | **Prisma 5** | Migration واقعی و نسخه‌دار، Type-safety کامل، جلوگیری از N+1 با `include` صریح |
| Database | **PostgreSQL 16** | تراکنش‌های ACID، Full-Text Search داخلی، `pg_trgm` برای جستجوی فازی، Partial Index، `SELECT FOR UPDATE` برای کنترل همروندی |
| Search | **PostgreSQL FTS + pg_trgm** (بدون Elasticsearch) | برای ۵۰۰K رکورد کاملاً کافی و **زیر ۵۰ms**؛ بدون هزینه عملیاتی سرویس جدا. لایه `SearchProvider` انتزاعی است تا در آینده Elastic/Vector قابل تعویض باشد |
| Cache / Queue | **Redis 7 + BullMQ** | Background Job (Import، Export، Backup، Notification، تصویر)، Cache داشبورد، Distributed Lock |
| Frontend | **React 18 + Vite + TypeScript** | سرعت بالای Dev، Bundle کوچک، PWA-ready با `vite-plugin-pwa` |
| State/Data | **TanStack Query v5** | Cache هوشمند سمت کلاینت، Optimistic Update، Retry، Invalidation دقیق |
| UI | **Tailwind CSS + Radix UI Primitives** | RTL واقعی با `dir="rtl"` و منطق logical properties، دسترس‌پذیری (a11y) داخلی Radix |
| Auth | **JWT (Access کوتاه‌عمر) + Refresh Token چرخشی در HttpOnly Cookie** | امن در برابر XSS (توکن در JS خوانده نمی‌شود)، آماده برای اپ موبایل (حالت Bearer) |
| Storage | **Local FS با `StorageAdapter` انتزاعی (S3-ready)** | استقرار On-Premise کتابخانه بدون وابستگی به ابر |
| Logging | **Pino** (JSON ساختاریافته) | سریع‌ترین Logger نود، آماده برای Loki/ELK |
| Test | **Jest + Supertest** (API) / **Vitest + Testing Library** (Web) | استاندارد صنعتی |
| Deploy | **Docker Compose + Nginx** | یک دستور برای بالا آمدن کل سیستم |

---

## ۲. چرا Modular Monolith و نه Microservices؟

یک کتابخانه با ۵۰۰٬۰۰۰ جلد و ۲۰ کتابدار هم‌زمان، **هرگز** به Microservices نیاز پیدا نمی‌کند. Microservices در این مقیاس فقط هزینه عملیاتی، تأخیر شبکه و پیچیدگی تراکنش توزیع‌شده اضافه می‌کند.

در عوض، معماری ما **مرزهای ماژولی سخت** دارد:

```
apps/api/src/modules/
  ├── catalog/        ← کتاب، نویسنده، ناشر، دسته‌بندی، مجموعه
  ├── holdings/       ← نسخه فیزیکی، بارکد، جابه‌جایی
  ├── locations/      ← ساختمان تا موقعیت قفسه
  ├── members/        ← اعضا و انواع عضویت
  ├── circulation/    ← امانت، بازگشت، تمدید، رزرو
  ├── fines/          ← جریمه و پرداخت
  ├── inventory/      ← شمارش موجودی
  ├── search/         ← موتور جستجو (انتزاعی)
  ├── reports/        ← گزارش‌ها و داشبورد
  ├── imports/        ← ورود اطلاعات از Excel/CSV
  ├── exports/        ← خروجی Excel/CSV/PDF
  ├── labels/         ← بارکد، QR، چاپ برچسب
  ├── notifications/  ← اعلان‌ها + آداپتور SMS/Email
  ├── iam/            ← کاربران، نقش‌ها، دسترسی‌ها
  ├── audit/          ← ثبت فعالیت
  ├── settings/       ← تنظیمات سیستم
  ├── backup/         ← پشتیبان‌گیری و بازیابی
  ├── setup/          ← Setup Wizard
  └── health/         ← Health Check
```

هر ماژول فقط از طریق **Service عمومی** ماژول دیگر با آن حرف می‌زند — نه از طریق Repository داخلی. این یعنی اگر روزی ماژولی باید جدا شود، مرزش از قبل آماده است.

---

## ۳. لایه‌بندی داخل هر ماژول

```
modules/circulation/
├── circulation.module.ts
├── controllers/          ← فقط HTTP: اعتبارسنجی ورودی، فراخوانی Service، Serialize خروجی
│   └── loans.controller.ts
├── services/             ← تمام منطق کسب‌وکار (قوانین امانت، محاسبه جریمه)
│   ├── loans.service.ts
│   └── renewals.service.ts
├── dto/                  ← Zod/class-validator schemas
├── policies/             ← قوانین قابل تنظیم (LoanPolicyService)
└── __tests__/
```

**قانون طلایی:** هیچ منطق کسب‌وکاری در Controller یا در Frontend نوشته نمی‌شود.
Frontend فقط نمایش‌دهنده است — همان API که وب استفاده می‌کند، فردا اپ اندروید هم استفاده خواهد کرد.

---

## ۴. تصمیمات کلیدی معماری (ADR خلاصه)

### ADR-01 — تفکیک «عنوان» از «نسخه فیزیکی»
دو موجودیت مجزا:
- **`Book`** = رکورد کتاب‌شناختی (Bibliographic Record) — عنوان، نویسنده، ISBN، ناشر
- **`BookCopy`** = نسخه فیزیکی — بارکد، شماره ثبت، محل قرارگیری، وضعیت

یک `Book` می‌تواند N تا `BookCopy` داشته باشد. امانت **همیشه** روی `BookCopy` ثبت می‌شود، رزرو **همیشه** روی `Book` (عضو یک عنوان می‌خواهد، نه نسخه خاص).

### ADR-02 — یک جدول `Person` به‌جای Author/Translator/Editor جداگانه
یک انسان می‌تواند هم نویسنده یک کتاب باشد و هم مترجم کتاب دیگر. جدول‌های جدا باعث تکرار داده و ناسازگاری می‌شود.
راه‌حل: جدول `Person` (Authority Record) + جدول واسط `BookContributor` با فیلد `role`.
در UI همچنان صفحات جدا «نویسندگان» و «مترجمان» وجود دارد که روی همین جدول فیلتر می‌شوند.

### ADR-03 — درخت `Location` یکپارچه به‌جای ۸ جدول تودرتو
به‌جای Building/Floor/Section/Room/Aisle/Shelf/Level/Position به‌عنوان ۸ جدول، یک جدول `Location` با:
- `parentId` (خودارجاع)
- `kind` (enum: BUILDING, FLOOR, SECTION, ROOM, AISLE, SHELF, SHELF_LEVEL, POSITION)
- `path` (Materialized Path مثل `.a1.b3.c7.`) + `depth`
- `fullCode` (مثل `B1-S2-A03-SH12-L04`)

**چرا؟** هر کتابخانه‌ای همه ۸ سطح را ندارد. کتابخانه شما شاید «اتاق» نداشته باشد. با درخت یکپارچه، سطوح اختیاری‌اند و کوئری زیردرخت با یک `path LIKE '.a1.b3.%'` و یک Index انجام می‌شود — نه ۸ تا JOIN.

### ADR-04 — جستجو با PostgreSQL نه Elasticsearch
برای ۱۰۰٬۰۰۰ عنوان، یک `GIN` index روی `tsvector` جستجو را در **۵ تا ۳۰ میلی‌ثانیه** انجام می‌دهد. Elasticsearch در این مقیاس فقط یک سرویس دیگر برای نگهداری، همگام‌سازی و خرابی است.
لایه `SearchProvider` (interface) طراحی شده تا در آینده `ElasticSearchProvider` یا `VectorSearchProvider` بدون تغییر Controller اضافه شود.

### ADR-05 — نرمال‌سازی فارسی در سطح دیتابیس
تابع `IMMUTABLE` به‌نام `persian_normalize(text)` در PostgreSQL تعریف شده که:
`ي→ی`، `ك→ک`، `ة→ه`، `أ/إ/آ→ا`، حذف اعراب، `‌ (ZWNJ) → فاصله`، `۰-۹/٠-٩ → 0-9`، حذف فاصله اضافه، lowercase.

چون `IMMUTABLE` است، می‌توان روی آن **Index ساخت** — یعنی نرمال‌سازی هزینه‌ای در زمان جستجو ندارد.
همین تابع عیناً در `packages/shared` به TypeScript پورت شده تا Frontend و Backend یکسان رفتار کنند.

### ADR-06 — تولید شماره با قفل ردیف (Row Lock)
شماره ثبت و بارکد از جدول `NumberingRule` تولید می‌شوند. تولید داخل تراکنش با `SELECT ... FOR UPDATE` روی ردیف قانون انجام می‌شود → حتی با ۱۰ کتابدار هم‌زمان، شماره تکراری غیرممکن است.

### ADR-07 — کنترل همروندی امانت با قفل خوش‌بینانه + شرطی
هنگام امانت، وضعیت نسخه با یک `UPDATE ... WHERE id = ? AND status = 'AVAILABLE'` تغییر می‌کند و اگر `rowCount = 0` بود، تراکنش برگردانده می‌شود. این یعنی از دو درخواست هم‌زمان، دقیقاً یکی موفق می‌شود.

### ADR-08 — Soft Delete برای همه موجودیت‌های حساس
`deletedAt` روی Book، BookCopy، Member، User، Person، Publisher.
**اما** رکوردهای تراکنشی (Loan، Fine، Payment، AuditLog) **هرگز** حذف نمی‌شوند — نه سخت، نه نرم. تاریخ کتابخانه غیرقابل بازنویسی است.

### ADR-09 — تاریخ: ذخیره میلادی UTC، نمایش شمسی
تمام `DateTime` ها در دیتابیس **UTC** ذخیره می‌شوند (`timestamptz`). تبدیل به شمسی **فقط** در لایه نمایش (Frontend) با `Intl.DateTimeFormat('fa-IR-u-ca-persian')` انجام می‌شود. Timezone کتابخانه از Settings خوانده می‌شود.
هرگز رشته تاریخ شمسی در دیتابیس ذخیره نمی‌شود.

### ADR-10 — مبالغ مالی با `Decimal(14,2)`
هرگز `Float`. جریمه و پرداخت با `Prisma.Decimal` و در سرویس‌ها با عملیات دقیق محاسبه می‌شوند.

### ADR-11 — Multi-Branch از روز اول در Schema
تمام موجودیت‌های فیزیکی (`BookCopy`, `Member`, `Loan`, `User`) فیلد `branchId` دارند. فعلاً یک شعبه پیش‌فرض ساخته می‌شود و UI شعبه را نشان نمی‌دهد؛ اما افزودن شعبه دوم در آینده **صفر Migration دردناک** خواهد داشت.

### ADR-12 — RBAC واقعی با Permission ریزدانه
`User → Role(s) → Permission(s)`. Guard در NestJS با decorator `@RequirePermissions('books.create')` کار می‌کند. مجوزها در دیتابیس‌اند و از طریق UI قابل تخصیص به نقش‌ها هستند.

---

## ۵. جریان درخواست (Request Flow)

```
Browser (React)
   │  fetch با HttpOnly Cookie + CSRF header
   ▼
Nginx (TLS, Rate Limit, Security Headers, gzip)
   │
   ▼
NestJS
   ├─ ThrottlerGuard        ← Rate Limiting
   ├─ JwtAuthGuard          ← احراز هویت
   ├─ PermissionsGuard      ← مجوز ریزدانه
   ├─ ZodValidationPipe     ← اعتبارسنجی ورودی
   ├─ Controller            ← بدون منطق
   ├─ Service               ← منطق کسب‌وکار (داخل تراکنش در صورت نیاز)
   │     ├─ Prisma          ← PostgreSQL
   │     ├─ Redis           ← Cache / Lock
   │     └─ BullMQ          ← Background Job
   ├─ AuditInterceptor      ← ثبت خودکار تغییرات
   └─ AllExceptionsFilter   ← خطای فارسی برای کاربر، Log فنی جدا
```

---

## ۶. Background Jobs (BullMQ)

| صف | وظیفه |
|-----|-------|
| `imports` | پردازش Batch فایل Excel/CSV (۱۰٬۰۰۰ رکورد در Chunk های ۵۰۰تایی) |
| `exports` | تولید Excel/CSV/PDF بزرگ با Streaming (بدون بارگذاری کل داده در RAM) |
| `backups` | `pg_dump` + آرشیو فایل‌ها |
| `notifications` | ارسال اعلان از طریق آداپتور فعال |
| `images` | تولید Thumbnail با `sharp` |
| `maintenance` | علامت‌گذاری دیرکردها، انقضای رزرو، انقضای عضویت (Cron روزانه) |

---

## ۷. استراتژی کارایی (Performance)

1. **Pagination واقعی سمت سرور** — `LIMIT/OFFSET` برای صفحات اول و **Keyset Pagination** برای پیمایش عمیق.
2. **`count` جداگانه و Cache شده** — `COUNT(*)` روی ۵۰۰K رکورد گران است؛ برای فیلترهای بدون شرط از `reltuples` تخمینی و برای فیلتردار از `COUNT` واقعی با Cache کوتاه استفاده می‌شود.
3. **جلوگیری از N+1** — Prisma با `include` صریح؛ هیچ کوئری داخل حلقه.
4. **Index دقیق** — روی `barcode`, `accession_number`, `search_vector (GIN)`, `title_normalized (GIN trgm)`, `(status, due_at)`, `(member_id, status)`, `location_id`, `path (text_pattern_ops)`.
5. **Partial Index** — مثلاً `WHERE deleted_at IS NULL` روی کتاب‌ها؛ اندازه ایندکس را کوچک نگه می‌دارد.
6. **Cache داشبورد** — آمار سنگین داشبورد در Redis با TTL ۶۰ ثانیه.
7. **Virtualized Table در UI** — جدول کتاب‌ها هرگز ۱۰٬۰۰۰ ردیف را رندر نمی‌کند.

---

## ۸. آمادگی برای آینده

| قابلیت آینده | چه چیزی از الان آماده است |
|--------------|----------------------------|
| اپ موبایل | همان REST API + پشتیبانی Bearer Token |
| OPAC (کاتالوگ عمومی) | ماژول `catalog` مستقل از `iam`؛ یک Controller عمومی `/public/catalog` با DTO محدودشده کافی است |
| پیامک | `NotificationChannelAdapter` interface — پیاده‌سازی `KavenegarAdapter` بدون تغییر هیچ کد دیگری |
| جستجوی معنایی | `SearchProvider` interface + آمادگی `pgvector` |
| هوش مصنوعی | `AiService` interface (خلاصه‌سازی، پیشنهاد دسته‌بندی) — فعلاً پیاده‌سازی نشده، Contract تعریف شده |
| PWA | `vite-plugin-pwa` پیکربندی‌شده؛ Service Worker با استراتژی Network-First |
| چندزبانه | تمام رشته‌ها در `packages/shared/src/i18n/fa.ts`؛ افزودن `en.ts` کافی است |

