import { rmSync } from 'node:fs';

/**
 * پاک کردن خروجی ساخت — به‌جای `rm -rf`.
 *
 * ── چرا اسکریپت و نه دستور مستقیم ───────────────────────────────────────
 * `rm -rf` روی ویندوز وجود ندارد. pnpm اسکریپت‌ها را روی ویندوز با
 * `cmd.exe` اجرا می‌کند و آنجا `rm` شناخته نمی‌شود، پس `pnpm build`
 * پیش از شروع شکست می‌خورد. در PowerShell هم `rm` نام مستعار
 * `Remove-Item` است ولی `-rf` را نمی‌پذیرد.
 *
 * `node` به‌هرحال برای ساخت پروژه لازم است، پس این اسکریپت هیچ وابستگی
 * تازه‌ای اضافه نمی‌کند و روی هر سه سیستم‌عامل یکسان رفتار می‌کند.
 */
const targets = [
  'dist',
  'dist-seed',
  'tsconfig.tsbuildinfo',
  'tsconfig.seed.tsbuildinfo',
];

for (const target of targets) {
  // `force` یعنی نبودنِ مسیر خطا نیست — اولین ساخت هنوز چیزی برای پاک کردن ندارد
  rmSync(target, { recursive: true, force: true });
}
