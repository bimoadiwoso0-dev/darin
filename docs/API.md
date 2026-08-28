# مرجع REST API

پایه همه مسیرها `/api` است. مستندات تعاملی Swagger در محیط توسعه روی
`http://localhost:3001/api/docs` در دسترس است.

---

## احراز هویت

پیش‌فرض **کوکی `HttpOnly`** است. پس از `POST /api/auth/login` کوکی‌ها ست
می‌شوند و بقیه درخواست‌ها به چیز دیگری نیاز ندارند.

```bash
curl -c jar.txt -X POST https://library.example.ir/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"librarian","password":"…"}'

curl -b jar.txt https://library.example.ir/api/books
```

پاسخ ورود **توکن را در بدنه برنمی‌گرداند**. برای یکپارچه‌سازی سرور به سرور
یا اپ موبایل که کوکی ندارد، صریحاً بخواهید:

```jsonc
{ "username": "…", "password": "…", "tokenMode": "bearer" }
// → { "user": {…}, "accessToken": "eyJ…" }
```

سپس `Authorization: Bearer <token>`.

| مسیر | کار |
|------|-----|
| `POST /auth/login` | ورود |
| `POST /auth/refresh` | تازه‌سازی توکن (چرخشی، با تشخیص استفاده مجدد) |
| `POST /auth/logout` | خروج — پاسخ `204` |
| `GET /auth/me` | کاربر جاری، نقش‌ها و مجوزها |
| `POST /auth/change-password` | تغییر رمز خود کاربر |

---

## قرارداد پاسخ

**فهرست‌ها** همیشه همین شکل را دارند:

```jsonc
{
  "data": [ /* … */ ],
  "meta": { "page": 1, "pageSize": 20, "total": 12043, "totalPages": 603 }
}
```

پارامترهای مشترک: `page`، `pageSize` (سقف ۲۰۰)، `sort`، `order`
(`asc` | `desc`).

**خطاها** همیشه همین شکل را دارند:

```jsonc
{
  "code": "VALIDATION_FAILED",
  "message": "اطلاعات واردشده معتبر نیست. لطفاً موارد مشخص‌شده را اصلاح کنید.",
  "details": { "isbn": ["شابک واردشده معتبر نیست."] },
  "requestId": "93ce13d3-c89a-4cee-94e6-ca4ff688bed0"
}
```

`message` همیشه فارسی و قابل نمایش به کاربر است. `requestId` را نگه دارید:
جزئیات فنی با همان شناسه در Log سرور است.

| کد وضعیت | معنی |
|----------|------|
| `400` | ورودی نامعتبر (`details` فیلدها را می‌گوید) |
| `401` | وارد نشده‌اید یا نشست منقضی شده |
| `403` | مجوز لازم را ندارید |
| `404` | یافت نشد |
| `409` | تعارض — مثلاً بارکد تکراری یا نسخه‌ای که همین حالا امانت رفت |
| `429` | از محدودیت نرخ گذشتید |

---

## پارامترهای بولی

`?hasCopies=false` واقعاً `false` معنی می‌دهد. مقادیر پذیرفته:
`true|1|yes|on` و `false|0|no|off`. حضور بدون مقدار (`?overdueOnly`) یعنی
`true`.

---

## کاتالوگ

| مسیر | مجوز | کار |
|------|------|-----|
| `GET /books` | `books.view` | فهرست با فیلتر ترکیبی |
| `GET /books/:id` | `books.view` | جزئیات + تفکیک وضعیت نسخه‌ها |
| `GET /books/:id/related` | `books.view` | کتاب‌های مرتبط |
| `POST /books` | `books.create` | ثبت کتاب |
| `PATCH /books/:id` | `books.edit` | ویرایش |
| `POST /books/check-duplicate` | `books.create` | تشخیص تکراری پیش از ثبت |
| `POST /books/bulk-update` | `books.edit` | ویرایش گروهی |
| `DELETE /books/:id` | `books.delete` | بایگانی (حذف نرم) |
| `POST /books/:id/restore` | `books.delete` | بازگرداندن از بایگانی |

فیلترهای پرکاربرد `GET /books`:

```
?q=مبانی کتابداری     جستجوی فارسی با نرمال‌سازی
?availableOnly        فقط کتاب‌هایی که نسخه موجود دارند
?hasCopies=false      کتاب‌های بدون نسخه فیزیکی
?categoryId=…&publisherId=…&language=fa
?yearFrom=1390&yearTo=1400
?sort=title|publicationYear|copies|createdAt
```

مسیرهای مشابه برای داده مرجع: `/persons`، `/publishers`، `/categories`،
`/series`، `/tags`، `/donors`.

---

## نسخه‌های فیزیکی

| مسیر | مجوز | کار |
|------|------|-----|
| `GET /copies` | `copies.view` | فهرست نسخه‌ها |
| `GET /copies/by-barcode/:barcode` | `copies.view` | **پرتکرارترین کوئری میز امانت** |
| `GET /copies/by-qr/:token` | `copies.view` | اسکن QR |
| `GET /copies/next-numbers` | `copies.create` | شماره ثبت/اموال بعدی |
| `POST /copies` | `copies.create` | افزودن نسخه |
| `PATCH /copies/:id/status` | `copies.edit` | تغییر وضعیت |
| `POST /copies/move` | `copies.move` | جابه‌جایی به مکان دیگر |
| `POST /copies/bulk-status` | `copies.edit` | تغییر وضعیت گروهی |

---

## امانت

| مسیر | مجوز | کار |
|------|------|-----|
| `GET /loans` | `loans.view` | فهرست امانت‌ها |
| `GET /loans/eligibility/:memberId` | `loans.create` | آیا این عضو می‌تواند امانت بگیرد |
| `POST /loans/checkout` | `loans.create` | ثبت امانت |
| `POST /loans/return` | `loans.return` | بازگشت با بارکد |
| `POST /loans/:id/renew` | `loans.renew` | تمدید |
| `GET /reservations` · `POST /reservations` | `reservations.*` | رزرو |
| `GET /fines` · `POST /fines/:id/pay` | `fines.*` | جریمه و پرداخت |
| `GET /notifications` | `loans.view` | صندوق یادآوری کتابدار |

### امانت هم‌زمان یک نسخه

`POST /loans/checkout` در برابر مسابقه امن است. اگر دو کتابدار هم‌زمان یک
نسخه را امانت بدهند، **دقیقاً یکی** موفق می‌شود و دیگری `409` می‌گیرد.

دو لایه محافظت: به‌روزرسانی شرطی وضعیت نسخه، و یک ایندکس یکتای جزئی روی
پایگاه داده که بیش از یک امانت باز برای هر نسخه را غیرممکن می‌کند. لایه دوم
مهم است: حتی اگر روزی کدی از مسیر سرویس عبور نکند، پایگاه داده جلویش را
می‌گیرد.

---

## اعضا

| مسیر | مجوز | کار |
|------|------|-----|
| `GET /members` | `members.view` | فهرست (بدون کد ملی و آدرس) |
| `GET /members/search?q=` | `members.view` | جستجوی سریع میز امانت |
| `GET /members/:id` | `members.view` | پروفایل کامل |
| `POST /members` | `members.create` | ثبت عضو |
| `POST /members/:id/renew` | `members.edit` | تمدید عضویت |
| `GET /members/:id/card` | `members.card` | کارت عضویت |

نگاه کنید به [`SECURITY.md`](SECURITY.md) برای اینکه کدام فیلد کجا برمی‌گردد.

---

## جستجو

| مسیر | کار |
|------|-----|
| `GET /search/global?q=` | جستجو در کتاب، نسخه، عضو و مکان با هم |
| `GET /search/suggest?q=` | پیشنهاد خودکار |
| `GET /search/books?q=` | جستجوی پیشرفته کتاب |

جستجو **نرمال‌سازی فارسی** دارد: «ي» و «ی»، «ك» و «ک»، اعراب، نیم‌فاصله و
ارقام فارسی/عربی همه یکسان می‌شوند. برای غلط املایی، شباهت trigram هم
اعمال می‌شود.

---

## گزارش و خروجی

| مسیر | کار |
|------|-----|
| `GET /dashboard` | آمار زنده — همه اعداد از پایگاه داده |
| `GET /dashboard/trend?days=30` | روند امانت |
| `GET /reports` | فهرست گزارش‌های موجود |
| `GET /reports/:key` | داده گزارش |
| `GET /reports/:key/export?format=xlsx\|csv` | فایل واقعی |

---

## ورود اطلاعات از Excel

فرایند چهار مرحله‌ای، عمداً جدا از هم:

```
POST /imports/upload      → آپلود فایل، تشخیص ستون‌ها
PUT  /imports/:id/mapping → نگاشت ستون فایل به فیلد سیستم
POST /imports/:id/validate→ اعتبارسنجی بدون نوشتن — گزارش خطای سطر به سطر
POST /imports/:id/execute → نوشتن واقعی
```

مرحله اعتبارسنجی جداست تا کاربر **پیش از** آلوده شدن پایگاه داده، خطاها
را ببیند و فایل را درست کند.

---

## مدیریت

| مسیر | مجوز | کار |
|------|------|-----|
| `GET /users` · `POST /users` | `users.*` | کاربران |
| `POST /users/:id/revoke-sessions` | `users.manage` | قطع همه نشست‌ها |
| `GET /roles` · `GET /roles/permissions` | `roles.*` | نقش و مجوز |
| `GET /settings` · `PUT /settings` | `settings.*` | تنظیمات |
| `GET /audit-logs` | `audit.view` | گزارش عملیات |
| `GET /backups` · `POST /backups` | `backup.*` | پشتیبان‌گیری |
| `POST /backups/:id/restore` | `backup.restore` | بازیابی (نیازمند تأیید متنی) |
| `POST /maintenance/run` | `settings.manage` | اجرای فوری کارهای شبانه |

---

## سلامت

`GET /api/health/live` · `GET /api/health/ready` · `GET /api/health`

`ready` واقعاً به پایگاه داده کوئری می‌زند و برای Load Balancer و
HEALTHCHECK کانتینر مناسب است.

---

## تاریخ‌ها

همه تاریخ‌ها در API به‌صورت **ISO 8601 با منطقه زمانی** رد و بدل می‌شوند:

```json
{ "dueAt": "2026-09-06T20:30:00.000Z" }
```

تبدیل به شمسی کار لایه نمایش است. اگر کلاینتی می‌سازید، تبدیل را با
منطقه زمانی `Asia/Tehran` انجام دهید — بدون آن، موعدهای نزدیک نیمه‌شب یک
روز اشتباه نمایش داده می‌شوند.

---

## محدودیت نرخ

سقف‌ها در سربرگ هر پاسخ می‌آیند:

```
X-RateLimit-Limit: 300
X-RateLimit-Remaining: 299
X-RateLimit-Reset: 60
```

ورود سقف جداگانه و سخت‌گیرانه‌تری دارد.
