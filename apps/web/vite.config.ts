import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    // PWA-ready (قانون ۸۱): فعلاً فقط Manifest و Cache دارایی‌های ثابت.
    // استراتژی آفلاین کامل در فاز بعدی اضافه می‌شود.
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'دارین — سامانه مدیریت کتابخانه',
        short_name: 'دارین',
        description: 'سامانه جامع مدیریت کتابخانه',
        lang: 'fa',
        dir: 'rtl',
        theme_color: '#1e40af',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // API هرگز Cache نمی‌شود: نمایش موجودی کهنه به کتابدار
        // بدتر از نمایش خطاست.
        navigateFallbackDenylist: [/^\/api/],
        globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: {
      // در توسعه، درخواست‌های API به سرویس Backend هدایت می‌شوند تا
      // کوکی‌های HttpOnly روی همان دامنه بمانند و CORS دردسر نشود.
      '/api': {
        target: `http://localhost:${process.env.API_PORT ?? 3001}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        /*
         * جداسازی وابستگی‌های بزرگ تا تغییر کد برنامه، Cache آنها را باطل نکند.
         * `recharts` تنها در داشبورد و گزارش‌ها لازم است و ~۴۰۰KB حجم دارد؛
         * جدا نگه داشتنش یعنی صفحه ورود آن را دانلود نمی‌کند.
         */
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return 'react';
          }
          if (id.includes('@tanstack')) return 'query';
          if (id.includes('recharts') || id.includes('d3-')) return 'charts';
          return 'vendor';
        },
      },
    },
  },
});
