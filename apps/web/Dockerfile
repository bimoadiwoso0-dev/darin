# ─────────────────────────────────────────────────────────────────────────────
#  Darin LMS — رابط کاربری
#
#  خروجی نهایی فایل‌های ایستا هستند که Nginx سرو می‌کند. Node فقط در مرحله
#  ساخت لازم است و در تصویر نهایی وجود ندارد.
# ─────────────────────────────────────────────────────────────────────────────

FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @darin/shared build \
 && pnpm --filter @darin/web build

# ── سرو فایل‌های ایستا ─────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
