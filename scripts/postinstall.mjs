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

function run(label, args, cwd) {
  process.stdout.write(`  ${label}… `);
  try {
    execFileSync('pnpm', args, { cwd, stdio: 'pipe' });
    console.log('✔');
    return true;
  } catch (error) {
    console.log('✘');
    console.error(`    ${String(error.stdout ?? error.message).trim().split('\n').slice(-3).join('\n    ')}`);
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
  ok = run('تولید کلاینت Prisma', ['--filter', '@darin/api', 'exec', 'prisma', 'generate'], root) && ok;
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
