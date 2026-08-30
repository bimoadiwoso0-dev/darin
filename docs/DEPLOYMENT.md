# استقرار روی سرور

این راهنما استقرار با Docker Compose را پوشش می‌دهد: PostgreSQL، Redis، API و
Nginx در چهار کانتینر.

---

## ۱. نیازمندی‌های سرور

| مورد | حداقل | پیشنهادی برای ۱۰۰٬۰۰۰ جلد |
|------|-------|---------------------------|
| CPU | ۲ هسته | ۴ هسته |
| RAM | ۴ گیگابایت | ۸ گیگابایت |
| دیسک | ۲۰ گیگابایت | ۵۰ گیگابایت SSD |
| سیستم‌عامل | هر توزیعی با Docker ≥ ۲۴ | — |

پایگاه داده با ۱۰۰٬۰۰۰ کتاب حدود **۲۴۲ مگابایت** است. بیشتر فضای دیسک صرف
پشتیبان‌ها و تصاویر جلد می‌شود، نه خود داده.

---

## ۲. آماده‌سازی متغیرهای محیطی

```bash
git clone <repo> /opt/darin && cd /opt/darin
cp .env.example .env
```

سه مقدار **باید** تغییر کنند؛ بدون آنها سرویس بالا نمی‌آید:

```bash
openssl rand -base64 48      # برای JWT_ACCESS_SECRET
openssl rand -base64 48      # برای JWT_REFRESH_SECRET — باید متفاوت باشد
openssl rand -base64 24      # برای POSTGRES_PASSWORD
```

و در `.env`:

```ini
NODE_ENV=production
POSTGRES_PASSWORD=<رمز تولیدشده>
JWT_ACCESS_SECRET=<کلید اول>
JWT_REFRESH_SECRET=<کلید دوم>

COOKIE_SECURE=true                      # اجباری در Production
PUBLIC_WEB_URL=https://library.example.ir
WEB_PUBLIC_PORT=8080                    # پورتی که Reverse Proxy به آن وصل می‌شود
LOG_PRETTY=false
```

> **`COOKIE_SECURE=true` اجباری است.** اگر `NODE_ENV=production` باشد و این
> مقدار `false`، سرویس عمداً بالا نمی‌آید و پیام خطای روشن می‌دهد. دلیل: بدون
> آن، کوکی احراز هویت روی HTTP هم فرستاده می‌شود.

> **مراقب `.env` توسعه باشید.** Docker Compose فایل `.env` کنار
> `docker-compose.yml` را برای جای‌گذاری متغیرها می‌خواند. اگر روی سروری
> مستقر می‌کنید که قبلاً برای توسعه استفاده شده، مقادیر توسعه (مثل
> `COOKIE_SECURE=false`) وارد پیکربندی Production می‌شوند. با
> `docker compose config` مقادیر نهایی را ببینید و بررسی کنید.

---

## ۳. مهاجرت پایگاه داده

مهاجرت **سرویس جداگانه‌ای** است و هنگام `up` معمولی اجرا نمی‌شود:

```bash
docker compose --profile migrate run --rm migrate
```

این دستور دو کار می‌کند: اعمال مهاجرت‌های نسخه‌دار، و ساخت داده سیستمی
(۵۲ مجوز، ۶ نقش، ۳۳ کلید تنظیمات، قوانین شماره‌گذاری، شعبه پیش‌فرض، انواع
عضویت، قالب‌های اعلان). هیچ داده نمایشی ساخته نمی‌شود.

> **چرا خودکار نیست:** اگر مهاجرت هنگام بالا آمدن سرویس اجرا شود، در استقرار
> چندنمونه‌ای چند کانتینر هم‌زمان مهاجرت می‌زنند. مهاجرت باید یک بار، آگاهانه،
> و ترجیحاً پس از گرفتن پشتیبان اجرا شود.

---

## ۴. اجرا

```bash
docker compose up -d
docker compose ps          # هر چهار سرویس باید healthy باشند
```

سپس `http://<سرور>:8080` را باز کنید. **جادوگر راه‌اندازی** اجرا می‌شود و
حساب مدیر ارشد را می‌سازد.

> هیچ رمز پیش‌فرضی در کد وجود ندارد. تا وقتی این مرحله انجام نشود، هیچ حسابی
> برای ورود موجود نیست.

اگر جادوگر باز نشد و مستقیم صفحه ورود آمد، یعنی راه‌اندازی قبلاً انجام شده.

---

## ۵. HTTPS

کانتینر رابط کاربری روی پورت ۸۰ داخل شبکه Docker گوش می‌دهد و **خودش TLS
ندارد**. یک Reverse Proxy جلوی آن بگذارید.

نمونه با Caddy — گواهی Let's Encrypt را خودکار می‌گیرد و تمدید می‌کند:

```caddy
library.example.ir {
    reverse_proxy 127.0.0.1:8080
    request_body {
        max_size 60MB          # آپلود فایل Excel برای ورود اطلاعات
    }
}
```

نمونه با Nginx روی خود میزبان:

```nginx
server {
    listen 443 ssl http2;
    server_name library.example.ir;

    ssl_certificate     /etc/letsencrypt/live/library.example.ir/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/library.example.ir/privkey.pem;

    client_max_body_size 60m;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;   # لازم برای تشخیص HTTPS
        proxy_read_timeout 600s;                      # پشتیبان‌گیری و Import
    }
}
```

پس از فعال شدن HTTPS، `PUBLIC_WEB_URL` را به آدرس `https://` تغییر دهید و
`docker compose up -d` را دوباره بزنید. این مقدار در QR Codeهای قفسه و کارت
عضویت هم استفاده می‌شود.

---

## ۶. پشتیبان‌گیری

پشتیبان‌گیری خودکار به‌صورت پیش‌فرض **روزانه** فعال است و از داخل خود سامانه
تنظیم می‌شود (تنظیمات ← پشتیبان‌گیری). فایل‌ها در حجم `api-storage` می‌مانند.

حجم را حتماً به بیرون از سرور هم کپی کنید — پشتیبانی که روی همان دیسک است،
در برابر خرابی دیسک بی‌فایده است. جزئیات، شامل روش بازیابی و تمرین بازیابی،
در [`BACKUP.md`](BACKUP.md).

---

## ۷. به‌روزرسانی نسخه

```bash
cd /opt/darin
# ۱. پشتیبان بگیرید (از داخل سامانه یا با دستور زیر)
docker compose exec -T postgres pg_dump -U darin darin | gzip > pre-upgrade.sql.gz

# ۲. کد جدید
git pull

# ۳. ساخت تصویرها
docker compose build

# ۴. مهاجرت — پیش از بالا آوردن نسخه جدید
docker compose --profile migrate run --rm migrate

# ۵. جایگزینی
docker compose up -d
```

مهاجرت‌های Prisma **افزایشی و نسخه‌دار** هستند؛ اجرای دوباره بی‌خطر است.

---

## ۸. پایش

| بررسی | دستور |
|-------|-------|
| فرایند زنده است | `curl http://localhost:8080/api/health/live` |
| آماده پاسخ‌گویی (اتصال دیتابیس) | `curl http://localhost:8080/api/health/ready` |
| وضعیت کامل | `curl http://localhost:8080/api/health` |
| Log سرویس | `docker compose logs -f api` |

`health/ready` واقعاً به پایگاه داده کوئری می‌زند. همین Endpoint در
`HEALTHCHECK` تصویر Docker استفاده می‌شود، پس اگر اتصال پایگاه داده قطع شود،
کانتینر `unhealthy` می‌شود.

Logها **JSON خطی** هستند (`LOG_PRETTY=false`). هر خط شناسه درخواست دارد؛ وقتی
کاربر خطایی با شناسه گزارش می‌کند، با همان شناسه ردیف دقیق را پیدا می‌کنید:

```bash
docker compose logs api | grep '<شناسه درخواست>'
```

---

## ۹. عیب‌یابی

| نشانه | علت محتمل | راه حل |
|-------|-----------|--------|
| API بالا نمی‌آید، خطای `COOKIE_SECURE` | `NODE_ENV=production` با `COOKIE_SECURE=false` | مقدار را `true` کنید |
| API بالا نمی‌آید، خطای طول کلید | کلید JWT کمتر از ۳۲ نویسه | با `openssl rand -base64 48` بسازید |
| صفحه سفید، خطای CORS در Console | `PUBLIC_WEB_URL` با آدرس واقعی نمی‌خواند | اصلاح و `up -d` دوباره |
| ورود موفق ولی بلافاصله خروج | کوکی `Secure` روی HTTP | HTTPS را فعال کنید |
| دکمه پشتیبان خطا می‌دهد | `pg_dump` در دسترس نیست | تصویر API را دوباره بسازید |
| کندی ناگهانی جستجو | آمار برنامه‌ریز کهنه | `docker compose exec postgres psql -U darin -d darin -c 'ANALYZE'` |
| تازه کردن صفحه ۴۰۴ می‌دهد | Reverse Proxy مسیرها را به کانتینر نمی‌رساند | `proxy_pass` را روی ریشه بگذارید، نه مسیر خاص |
| روی ویندوز: `pnpm` شناخته نمی‌شود | نصب نشده یا `PATH` تازه نشده | `npm install -g pnpm@9` و سپس پنجره جدید PowerShell |
| روی ویندوز: `createdb` شناخته نمی‌شود | ابزارهای PostgreSQL روی `PATH` نیستند | مسیر کامل: `& "C:\Program Files\PostgreSQL\16\bin\createdb.exe"` |

---

## ۱۰. آنچه در تصویر Production هست و نیست

- تصویر API فقط وابستگی‌های Production را دارد. ابزار توسعه (`tsx`، `nest`،
  `jest`) در آن نیست.
- اسکریپت Seed هسته پیش از ساخت تصویر به JavaScript ساده ترجمه می‌شود
  (`build:seed`) تا بدون `tsx` با `node` اجرا شود.
- `postgresql-client` نصب است، چون ماژول پشتیبان واقعاً `pg_dump` و `psql`
  را اجرا می‌کند.
- سرویس با کاربر `node` اجرا می‌شود، نه `root`.
- پایگاه داده هیچ پورتی به میزبان باز نمی‌کند. برای اتصال مستقیم:
  `docker compose exec postgres psql -U darin -d darin`
