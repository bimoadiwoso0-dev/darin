// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * پیکربندی ESLint برای کل مخزن (قالب Flat).
 *
 * ── فلسفه انتخاب قواعد ──────────────────────────────────────────────────
 * `tsc` با تنظیمات سخت‌گیرانه اجرا می‌شود و بیشتر خطاهای نوعی را همان‌جا
 * می‌گیرد. پس اینجا فقط چیزهایی فعال‌اند که کامپایلر نمی‌بیند و در عمل به
 * اشکال واقعی می‌انجامند: Promise فراموش‌شده، `any` نشت‌کرده، شرط همیشه
 * درست، و وابستگی جاافتاده در Hook.
 *
 * قواعد سلیقه‌ای (طول خط، نقل‌قول، ترتیب import) عمداً نیستند — هشدارِ
 * بی‌اثر، آدم را به نادیده گرفتن کل خروجی lint عادت می‌دهد.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-seed/**',
      '**/node_modules/**',
      'apps/api/src/generated/**', // کد تولیدشده Prisma
      'apps/web/dev-dist/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/*.config.ts',
      '.claude/**',                // ابزار محیط توسعه، نه کد پروژه
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // ── چیزهایی که کامپایلر نمی‌گیرد و واقعاً اشکال می‌سازند ──────────
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      // ── سخت‌گیری متعادل ──────────────────────────────────────────────
      // `_` ابتدای نام یعنی «عمداً استفاده نشده»
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',

      /*
       * این چهار قاعده روی مرز داده‌های خارجی (بدنه درخواست، ردیف Excel،
       * خروجی کوئری خام) بیش از حد پرسروصدا می‌شوند، در حالی که همان
       * مرزها با Zod اعتبارسنجی شده‌اند. هشدار می‌مانند تا دیده شوند،
       * ولی جلوی ساخت را نمی‌گیرند.
       */
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',

      /*
       * نویسه‌های نامرئی داخل عبارت باقاعده عمدی‌اند: نرمال‌ساز فارسی باید
       * اعراب، نیم‌فاصله، ZWSP و علامت‌های جهت را حذف کند و نوشتنشان به
       * شکل واقعی، خواناتر از فهرستی از `\u200c` است.
       */
      'no-irregular-whitespace': ['error', { skipRegExps: true, skipComments: true }],

      '@typescript-eslint/restrict-template-expressions': [
        'warn',
        { allowNumber: true, allowBoolean: true, allowNullish: true },
      ],
    },
  },

  // ── سمت سرور ───────────────────────────────────────────────────────────
  {
    files: ['apps/api/**/*.ts', 'packages/shared/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  // ── رابط کاربری ────────────────────────────────────────────────────────
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      /*
       * ── چرا هشدار و نه خطا ──────────────────────────────────────────
       * این قاعده در نسخه ۷ افزونه اضافه شد و هر `setState` داخل `useEffect`
       * را علامت می‌زند. دوازده مورد باقی‌مانده همگی یک الگو هستند: همگام
       * کردن یک مقدار بیرونی با وضعیت محلی (فرمی که پس از رسیدن داده پر
       * می‌شود، انتخابگری که با پاک شدن فیلتر خالی می‌شود). هر کدام
       * وابستگی درست دارند و رفتارشان در مرورگر بررسی شده است.
       *
       * بازنویسی هر دوازده مورد به وضعیت مشتق یا `key`، تغییری است با
       * ریسک واقعی روی فرم‌هایی که کار می‌کنند. پس دیده می‌شود، ولی جلوی
       * ساخت را نمی‌گیرد — و به‌عنوان بدهی فنی ثبت شده است.
       */
      'react-hooks/set-state-in-effect': 'warn',
    },
  },

  /*
   * ── آزمون‌ها و اسکریپت‌های Prisma ─────────────────────────────────────
   *
   * این فایل‌ها عمداً بیرون از `tsconfig.json` هر بسته‌اند: `rootDir` سمت
   * API روی `src` است و بسته مشترک نباید فایل آزمون را داخل `dist` منتشر
   * کند. بدون پروژه TypeScript، قواعد نوع‌آگاه اجرا نمی‌شوند و ESLint
   * خطای تجزیه می‌دهد؛ پس برای همین دسته خاموش می‌شوند و قواعد نحوی
   * سر جایشان می‌مانند.
   *
   * پوشش نوعی این فایل‌ها از دست نمی‌رود: `jest` با `ts-jest` و بسته
   * مشترک با `vitest` هر دو کامپایل می‌کنند، و
   * `tsconfig.scripts.json` اسکریپت‌های Prisma را می‌سنجد.
   */
  {
    files: [
      '**/*.spec.ts', '**/*.test.ts',
      'apps/api/test/**/*.ts',
      'apps/api/prisma/**/*.ts',
    ],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
