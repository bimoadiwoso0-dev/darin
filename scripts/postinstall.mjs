import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * آماده‌سازی فضای کار پس از نصب وابستگی‌ها.
 *
 * ── مسئله ───────────────────────────────────────────────────────────────
 * دو چیز در مخزن نیستند و باید تولید شوند:
 *
 * ۱. **خروجی بسته مشترک.** `@darin/shared` در `package.json` به
 *    `dist/index.js` اشاره می‌کند. در یک کلون تازه این پوشه وجود ندارد،
 *    پس Vite با «Failed to resolve import @darin/shared» و کامپایلر API
 *    با صدها خطای «Cannot find module» شکست می‌خورند.
 * ۲. **کلاینت Prisma.** با `prisma generate` ساخته می‌شود و در گیت نیست.
 *
 * بدون این اسکریپت، `pnpm install` یک درخت **ناقص** تحویل می‌داد و
 * `pnpm dev` بلافاصله شکست می‌خورد — بدون آنکه از پیام خطا معلوم باشد
 * علت چیست.
 *
 * ── چرا در برابر نبودن سورس مقاوم است ───────────────────────────────────
 * Dockerfile عمداً اول فقط فایل‌های `package.json` را کپی می‌کند و
 * `pnpm install` می‌زند تا لایه Cache وابستگی‌ها با هر تغییر کد باطل
 * نشود. آنجا سورسی وجود ندارد. پس اگر سورس نبود، این اسکریپت بی‌سروصدا
 * رد می‌شود و ساخت تصویر را نمی‌شکند — خود Dockerfile هر دو گام را
 * صریح اجرا می‌کند.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * چگونه pnpm را صدا بزنیم.
 *
 * ── چرا `execFileSync('pnpm', …)` روی ویندوز شکست می‌خورد ────────────────
 * آنجا `pnpm` در واقع `pnpm.cmd` است. Node بدون shell فایل `.cmd` را پیدا
 * نمی‌کند و خطای `spawnSync pnpm ENOENT` می‌دهد — روی لینوکس و مک هرگز
 * دیده نمی‌شود.
 *
 * راه درست: خود pnpm هنگام اجرای اسکریپت‌ها متغیر `npm_execpath` را روی
 * فایل جاوااسکریپتِ CLI خودش تنظیم می‌کند. اجرای آن با `node` روی هر سه
 * سیستم‌عامل یکسان است و اصلاً به shell و پسوند فایل کاری ندارد.
 */
function pnpmInvocation() {
  const execPath = process.env.npm_execpath;
  if (execPath && /\.(c|m)?js$/.test(execPath)) {
    return { file: process.execPath, prefix: [execPath], shell: false };
  }
  /*
   * اجرای مستقیم اسکریپت (بدون pnpm). روی ویندوز `shell: true` لازم است
   * تا `pnpm.cmd` پیدا شود؛ Node از نسخه ۲۰ اجرای `.cmd` بدون shell را
   * به دلایل امنیتی مسدود کرده است.
   */
  return { file: 'pnpm', prefix: [], shell: process.platform === 'win32' };
}

const pnpm = pnpmInvocation();

function run(label, args, cwd, extraEnv) {
  process.stdout.write(`  ${label}… `);
  try {
    execFileSync(pnpm.file, [...pnpm.prefix, ...args], {
      cwd,
      stdio: 'pipe',
      shell: pnpm.shell,
      env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    });
    console.log('✔');
    return true;
  } catch (error) {
    console.log('✘');
    const detail = [error.stdout, error.stderr, error.message]
      .map((part) => String(part ?? '').trim())
      .filter(Boolean)
      .join('\n');
    console.error(`    ${detail.split('\n').filter(Boolean).slice(-4).join('\n    ')}`);
    return false;
  }
}

const sharedSource = join(root, 'packages', 'shared', 'src', 'index.ts');
const prismaSchema = join(root, 'apps', 'api', 'prisma', 'schema.prisma');

// نصب فقط-وابستگی (مرحله Docker): چیزی برای آماده‌سازی نیست
if (!existsSync(sharedSource) && !existsSync(prismaSchema)) {
  process.exit(0);
}

console.log('آماده‌سازی فضای کار:');

let ok = true;
if (existsSync(sharedSource)) {
  ok = run('ساخت بسته مشترک', ['--filter', '@darin/shared', 'build'], root) && ok;
}
if (existsSync(prismaSchema)) {
  /*
   * `prisma.config.ts` وجود `DATABASE_URL` را الزامی می‌کند، ولی
   * `generate` هرگز به پایگاه داده وصل نمی‌شود — فقط از روی schema کد
   * تولید می‌کند. در یک کلون تازه هنوز `.env` ساخته نشده، پس این الزام
   * باعث می‌شد `pnpm install` نتواند کلاینت را بسازد و کاربر با انبوهی
   * خطای «Cannot find module» روبه‌رو شود.
   *
   * مقدار جانشین فقط به همین یک فرمان داده می‌شود. فرمان‌هایی که واقعاً
   * وصل می‌شوند (`db:create`، `db:migrate`) دست‌نخورده می‌مانند و اگر
   * `DATABASE_URL` نباشد، خطای روشن خودشان را می‌دهند.
   */
  const generateEnv = process.env.DATABASE_URL
    ? undefined
    : { DATABASE_URL: 'postgresql://unused:unused@localhost:5432/unused?schema=public' };

  ok =
    run(
      'تولید کلاینت Prisma',
      ['--filter', '@darin/api', 'exec', 'prisma', 'generate'],
      root,
      generateEnv,
    ) && ok;
}

if (!ok) {
  console.error('\n⚠️  آماده‌سازی کامل نشد. پیش از `pnpm dev` این را اجرا کنید:');
  console.error('    pnpm prepare:workspace\n');
  /*
   * عمداً با کد صفر خارج می‌شود: شکست اینجا نباید کل `pnpm install` را
   * ناموفق کند و کاربر را با درختی بدون node_modules رها کند. پیام بالا
   * راه ادامه را می‌گوید.
   */
}
