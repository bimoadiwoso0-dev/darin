-- تولید UUID در سطح دیتابیس به‌جای سمت کلاینت.
--
-- دلیل: مسیرهایی مثل Import انبوه، Seed کارایی و اسکریپت‌های نگهداری از SQL خام
-- استفاده می‌کنند و در آنجا Prisma Client حضور ندارد تا شناسه بسازد.
-- با `gen_random_uuid()` هر مسیر درجی — چه از طریق Prisma و چه SQL خام — کار می‌کند.
--
-- توجه: دستورهای `DROP INDEX` که Prisma تولید کرده بود عمداً حذف شده‌اند؛
-- آن ایندکس‌ها در Migration دستی `20260827054000` ساخته شده‌اند و Prisma
-- چون آنها را در schema.prisma نمی‌بیند، پیشنهاد حذفشان می‌دهد.
-- قاعده پروژه: اشیای SQL دستی (تابع، Trigger، Partial Index) فقط در
-- Migration های دستی مدیریت می‌شوند و از خروجی `migrate dev` حذف می‌گردند.
-- AlterTable
ALTER TABLE "attachments" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "audit_logs" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "backup_records" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "book_contributors" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "book_copies" ALTER COLUMN "id" SET DEFAULT gen_random_uuid(),
ALTER COLUMN "qrToken" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "book_movements" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "books" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "branches" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "categories" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "donors" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "fines" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "import_errors" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "import_jobs" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "inventory_scans" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "inventory_sessions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "job_records" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "loans" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "locations" ALTER COLUMN "id" SET DEFAULT gen_random_uuid(),
ALTER COLUMN "qrToken" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "lost_reports" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "members" ALTER COLUMN "id" SET DEFAULT gen_random_uuid(),
ALTER COLUMN "qrToken" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "membership_types" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "notes" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "notification_templates" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "notifications" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "numbering_rules" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "payments" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "permissions" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "persons" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "publishers" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "refresh_tokens" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "reservations" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "roles" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "saved_filters" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "series" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "tags" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "transfers" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
