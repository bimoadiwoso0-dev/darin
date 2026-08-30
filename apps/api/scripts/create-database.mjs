import { config } from 'dotenv';
import { Client } from 'pg';

// همان ترتیب `prisma/load-env.ts`: `.env` محلی، سپس ریشه مخزن
config({ path: ['.env', '../../.env'], quiet: true });

/**
 * ساخت پایگاه داده اگر وجود نداشته باشد.
 *
 * ── چرا این اسکریپت لازم است ────────────────────────────────────────────
 * راه متعارف `createdb` است، اما آن یکی از ابزارهای خط فرمان PostgreSQL
 * است و **روی ویندوز داخل PATH قرار نمی‌گیرد**. کاربر باید مسیر کامل
 * `C:\Program Files\PostgreSQL\16\bin\createdb.exe` را بنویسد و شماره
 * نسخه را هم درست حدس بزند.
 *
 * `pg` از قبل وابستگی این بسته است، پس این اسکریپت هیچ چیز تازه‌ای اضافه
 * نمی‌کند و روی ویندوز، لینوکس و مک یکسان کار می‌کند. آدرس اتصال را هم از
 * همان `DATABASE_URL` می‌خواند، پس جایی برای ناهماهنگی نمی‌ماند.
 *
 * ── چرا `prisma migrate dev` جایگزینش نیست ──────────────────────────────
 * آن هم پایگاه داده را می‌سازد، ولی تعاملی است و منتظر پاسخ می‌ماند؛
 * برای دستورالعمل راه‌اندازی مناسب نیست.
 */

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('✘ متغیر DATABASE_URL تعریف نشده است. فایل .env را بررسی کنید.');
  process.exit(1);
}

let parsed;
try {
  parsed = new URL(url);
} catch {
  console.error('✘ مقدار DATABASE_URL معتبر نیست.');
  process.exit(1);
}

const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
if (!databaseName) {
  console.error('✘ نام پایگاه داده در DATABASE_URL مشخص نشده است.');
  process.exit(1);
}

/*
 * برای ساختن یک پایگاه داده باید به پایگاه داده دیگری وصل بود. `postgres`
 * پایگاه داده مدیریتی است و در هر نصب PostgreSQL وجود دارد.
 */
const adminUrl = new URL(url);
adminUrl.pathname = '/postgres';
adminUrl.search = '';

const client = new Client({ connectionString: adminUrl.toString() });

/*
 * پیام خطا عمداً مقدارهایی را که واقعاً استفاده شده‌اند نام می‌برد.
 * «اتصال ممکن نشد» به‌تنهایی کاربر را وادار می‌کند حدس بزند کجا را نگاه
 * کند؛ دیدن نام کاربر و میزبان، غلط بودن `.env` را فوری آشکار می‌کند.
 * رمز هرگز چاپ نمی‌شود.
 */
const target = `کاربر «${decodeURIComponent(parsed.username || '(خالی)')}» روی ` +
  `${parsed.hostname}:${parsed.port || '5432'}`;

try {
  await client.connect();
} catch (error) {
  console.error(`✘ اتصال به PostgreSQL ممکن نشد: ${error.message}`);
  console.error(`  تلاش شد با ${target}`);

  const message = String(error.message);
  if (/password|authentication|SASL/i.test(message)) {
    console.error('  نام کاربری یا رمز در DATABASE_URL درست نیست.');
    console.error('  فایل `.env` را در ریشه مخزن باز کنید و DATABASE_URL را اصلاح کنید.');
    console.error('  کاربر پیش‌فرض هر نصب PostgreSQL «postgres» است، با همان رمزی که');
    console.error('  هنگام نصب انتخاب کرده‌اید.');
    console.error('  اگر رمز نویسه ویژه دارد (@ : / ? # %) باید در آدرس رمزگذاری شود.');
  } else if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(message)) {
    console.error('  سرویس PostgreSQL در دسترس نیست. بررسی کنید نصب و در حال اجراست:');
    console.error('    ویندوز:  Get-Service -Name "*postgres*"');
    console.error('    لینوکس:  systemctl status postgresql');
  }
  process.exit(1);
}

try {
  const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
    databaseName,
  ]);

  if (existing.rowCount > 0) {
    console.log(`✔ پایگاه داده «${databaseName}» از قبل وجود دارد.`);
  } else {
    /*
     * نام پایگاه داده نمی‌تواند پارامتر باشد (PostgreSQL اجازه نمی‌دهد)،
     * پس با شناسه‌گذاری امن داخل دستور قرار می‌گیرد: هر `"` دوبرابر
     * می‌شود و کل نام در گیومه می‌آید.
     */
    const quoted = `"${databaseName.replace(/"/g, '""')}"`;
    await client.query(`CREATE DATABASE ${quoted}`);
    console.log(`✔ پایگاه داده «${databaseName}» ساخته شد.`);
  }
  console.log('  گام بعد:  pnpm db:migrate');
} catch (error) {
  console.error(`✘ ساخت پایگاه داده ممکن نشد: ${error.message}`);
  process.exit(1);
} finally {
  await client.end();
}
