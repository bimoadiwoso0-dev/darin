# ─────────────────────────────────────────────────────────────────────────────
#  Darin LMS — API
#
#  ساخت چندمرحله‌ای: مرحله ساخت ابزار کامل دارد، تصویر نهایی فقط آنچه برای
#  اجرا لازم است. نتیجه: تصویری کوچک‌تر و با سطح حمله کمتر.
# ─────────────────────────────────────────────────────────────────────────────

# ── مرحله ۱: نصب وابستگی‌ها ─────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app

RUN corepack enable

# فقط فایل‌های تعریف وابستگی کپی می‌شوند تا لایه Cache با هر تغییر کد
# باطل نشود — نصب وابستگی کندترین مرحله ساخت است.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/

RUN pnpm install --frozen-lockfile

# ── مرحله ۲: ساخت ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .

# بسته مشترک باید پیش از API ساخته شود؛ API به خروجی آن وابسته است
RUN pnpm --filter @darin/shared build \
 && pnpm --filter @darin/api exec prisma generate \
 && pnpm --filter @darin/api build \
 && pnpm --filter @darin/api build:seed

# حذف وابستگی‌های توسعه — تصویر نهایی به آنها نیازی ندارد
RUN pnpm --filter @darin/api --prod deploy /output

# ── مرحله ۳: اجرا ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

# `postgresql-client` برای پشتیبان‌گیری لازم است: ماژول Backup واقعاً
# `pg_dump` و `psql` را اجرا می‌کند و بدون آنها دکمه پشتیبان کار نمی‌کند.
# `tini` سیگنال‌ها را درست به فرزند می‌رساند تا خاموشی تمیز انجام شود.
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV API_PORT=3001

COPY --from=build /output ./
# فایل‌های SQL مهاجرت — `prisma migrate deploy` آنها را می‌خواند
COPY --from=build /app/apps/api/prisma ./prisma
# Seed هسته به JavaScript ساده ترجمه شده تا با `node` اجرا شود؛ `tsx` یک
# devDependency است و در تصویر Production وجود ندارد.
COPY --from=build /app/apps/api/dist-seed ./seed

# اجرای سرویس با کاربر غیر root — اگر کسی از طریق برنامه نفوذ کند،
# دسترسی root روی کانتینر نخواهد داشت.
RUN mkdir -p /app/storage/backups /app/storage/uploads \
 && chown -R node:node /app
USER node

EXPOSE 3001

# بررسی سلامت واقعی: خودِ Endpoint سلامت که اتصال دیتابیس را می‌سنجد،
# نه صرفاً «فرایند زنده است».
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
