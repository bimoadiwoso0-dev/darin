import type { Config } from 'tailwindcss';

/**
 * سیستم طراحی دارین (قوانین ۱۲۰، ۱۲۱، ۱۲۲).
 *
 * ── چرا رنگ‌ها با متغیر CSS تعریف می‌شوند ────────────────────────────────
 * حالت روشن و تیره باید بدون تکرار کلاس‌ها (`bg-white dark:bg-gray-900`)
 * در هر کامپوننت کار کند. با متغیر CSS، هر کامپوننت `bg-surface` می‌نویسد
 * و مقدار واقعی در `:root` و `.dark` تعریف می‌شود.
 *
 * ── RTL واقعی (قانون ۱۲۲) ───────────────────────────────────────────────
 * از ویژگی‌های منطقی (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`, `end-*`)
 * استفاده می‌شود، نه `ml/mr/left/right`. Tailwind 3 این‌ها را به‌صورت
 * بومی پشتیبانی می‌کند و با `dir="rtl"` روی `<html>` خودکار برعکس می‌شوند.
 */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // رنگ‌های معنایی — هرگز رنگ خام در کامپوننت نوشته نمی‌شود
        background: 'rgb(var(--color-background) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        'surface-raised': 'rgb(var(--color-surface-raised) / <alpha-value>)',
        'surface-sunken': 'rgb(var(--color-surface-sunken) / <alpha-value>)',
        border: 'rgb(var(--color-border) / <alpha-value>)',
        'border-strong': 'rgb(var(--color-border-strong) / <alpha-value>)',

        content: {
          DEFAULT: 'rgb(var(--color-content) / <alpha-value>)',
          muted: 'rgb(var(--color-content-muted) / <alpha-value>)',
          subtle: 'rgb(var(--color-content-subtle) / <alpha-value>)',
          inverted: 'rgb(var(--color-content-inverted) / <alpha-value>)',
        },

        primary: {
          DEFAULT: 'rgb(var(--color-primary) / <alpha-value>)',
          hover: 'rgb(var(--color-primary-hover) / <alpha-value>)',
          soft: 'rgb(var(--color-primary-soft) / <alpha-value>)',
          content: 'rgb(var(--color-primary-content) / <alpha-value>)',
        },

        // وضعیت‌ها — در کل سیستم معنای ثابت دارند
        success: {
          DEFAULT: 'rgb(var(--color-success) / <alpha-value>)',
          soft: 'rgb(var(--color-success-soft) / <alpha-value>)',
          content: 'rgb(var(--color-success-content) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'rgb(var(--color-warning) / <alpha-value>)',
          soft: 'rgb(var(--color-warning-soft) / <alpha-value>)',
          content: 'rgb(var(--color-warning-content) / <alpha-value>)',
        },
        danger: {
          DEFAULT: 'rgb(var(--color-danger) / <alpha-value>)',
          soft: 'rgb(var(--color-danger-soft) / <alpha-value>)',
          content: 'rgb(var(--color-danger-content) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'rgb(var(--color-info) / <alpha-value>)',
          soft: 'rgb(var(--color-info-soft) / <alpha-value>)',
          content: 'rgb(var(--color-info-content) / <alpha-value>)',
        },
      },

      fontFamily: {
        // Vazirmatn: خواناترین فونت فارسی برای رابط کاربری، با ارقام فارسی
        // و لاتین هماهنگ. محلی سرو می‌شود، نه از CDN (کتابخانه ممکن است
        // اینترنت محدود داشته باشد).
        sans: ['Vazirmatn', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['Vazirmatn Code', 'ui-monospace', 'Menlo', 'monospace'],
      },

      fontSize: {
        // مقیاس تایپوگرافی — نسبت ۱٫۲ (Minor Third)
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],      // 11px — برچسب جدول
        xs: ['0.75rem', { lineHeight: '1.125rem' }],       // 12px
        sm: ['0.8125rem', { lineHeight: '1.375rem' }],     // 13px — متن جدول
        base: ['0.9375rem', { lineHeight: '1.625rem' }],   // 15px — متن اصلی
        lg: ['1.0625rem', { lineHeight: '1.75rem' }],      // 17px
        xl: ['1.25rem', { lineHeight: '1.875rem' }],       // 20px — عنوان بخش
        '2xl': ['1.5rem', { lineHeight: '2.125rem' }],     // 24px — عنوان صفحه
        '3xl': ['1.875rem', { lineHeight: '2.375rem' }],   // 30px — عدد داشبورد
        '4xl': ['2.25rem', { lineHeight: '2.75rem' }],
      },

      borderRadius: {
        sm: '0.25rem',
        DEFAULT: '0.375rem',
        md: '0.5rem',
        lg: '0.75rem',
        xl: '1rem',
      },

      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        raised: '0 4px 12px -2px rgb(0 0 0 / 0.08), 0 2px 6px -2px rgb(0 0 0 / 0.05)',
        overlay: '0 12px 32px -8px rgb(0 0 0 / 0.18), 0 4px 12px -4px rgb(0 0 0 / 0.10)',
        // حلقه تمرکز — برای دسترس‌پذیری با صفحه‌کلید (قانون ۵۷)
        focus: '0 0 0 3px rgb(var(--color-primary) / 0.35)',
      },

      spacing: {
        // ارتفاع‌های ثابت اجزای رابط
        input: '2.375rem',   // 38px — ارتفاع فیلد ورودی
        row: '2.75rem',      // 44px — ارتفاع ردیف جدول (کافی برای لمس)
        header: '3.5rem',    // 56px
        sidebar: '15.5rem',  // 248px
      },

      transitionDuration: {
        DEFAULT: '150ms',
      },

      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        // جهت‌آگاه: در RTL از راست می‌آید
        'slide-in-end': {
          from: { opacity: '0', transform: 'translateX(var(--slide-from, 8px))' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(var(--shimmer-to, -100%))' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-up': 'slide-up 180ms ease-out',
        'slide-in-end': 'slide-in-end 200ms ease-out',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
