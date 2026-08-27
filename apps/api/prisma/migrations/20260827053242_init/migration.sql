-- CreateEnum
CREATE TYPE "CategoryKind" AS ENUM ('SUBJECT', 'GENRE');

-- CreateEnum
CREATE TYPE "BookFormat" AS ENUM ('RAHLI', 'SOLTANI', 'VAZIRI', 'ROQEI', 'JEEBI', 'KHESHTI', 'PALTOEI', 'OTHER');

-- CreateEnum
CREATE TYPE "BindingType" AS ENUM ('HARDCOVER', 'PAPERBACK', 'SPIRAL', 'LEATHER', 'OTHER');

-- CreateEnum
CREATE TYPE "CalendarType" AS ENUM ('SOLAR_HIJRI', 'GREGORIAN', 'LUNAR_HIJRI');

-- CreateEnum
CREATE TYPE "ContributorRole" AS ENUM ('AUTHOR', 'CO_AUTHOR', 'TRANSLATOR', 'EDITOR', 'COMPILER', 'ILLUSTRATOR', 'INTRODUCER', 'RESEARCHER', 'NARRATOR', 'CALLIGRAPHER');

-- CreateEnum
CREATE TYPE "LocationKind" AS ENUM ('BUILDING', 'FLOOR', 'SECTION', 'ROOM', 'AISLE', 'SHELF', 'SHELF_LEVEL', 'POSITION');

-- CreateEnum
CREATE TYPE "CopyStatus" AS ENUM ('AVAILABLE', 'ON_LOAN', 'RESERVED_HOLD', 'LOST', 'DAMAGED', 'IN_REPAIR', 'IN_TRANSIT', 'NOT_LOANABLE', 'ARCHIVED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "CopyCondition" AS ENUM ('NEW', 'GOOD', 'FAIR', 'POOR');

-- CreateEnum
CREATE TYPE "AcquisitionSource" AS ENUM ('PURCHASE', 'DONATION', 'TRANSFER', 'EXCHANGE', 'LEGAL_DEPOSIT', 'INTER_LIBRARY', 'OTHER');

-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'EXPIRED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'UNSPECIFIED');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('ACTIVE', 'OVERDUE', 'RETURNED', 'LOST', 'CLAIMED_RETURNED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'READY', 'FULFILLED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FineType" AS ENUM ('LATE_RETURN', 'DAMAGE', 'LOST', 'REPLACEMENT', 'MEMBERSHIP', 'OTHER');

-- CreateEnum
CREATE TYPE "FineStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'WAIVED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'TRANSFER', 'ONLINE');

-- CreateEnum
CREATE TYPE "LostReportStatus" AS ENUM ('OPEN', 'CHARGED', 'REPLACED', 'WRITTEN_OFF', 'FOUND', 'CLOSED');

-- CreateEnum
CREATE TYPE "InventorySessionStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InventoryScanResult" AS ENUM ('FOUND', 'MOVED', 'UNEXPECTED', 'UNKNOWN', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('COVER', 'IMAGE', 'PDF', 'DOCUMENT', 'AVATAR', 'OTHER');

-- CreateEnum
CREATE TYPE "NumberingTarget" AS ENUM ('ACCESSION', 'BARCODE', 'LIBRARY_CODE', 'ASSET', 'MEMBER_CODE', 'LOAN_NUMBER');

-- CreateEnum
CREATE TYPE "NumberingReset" AS ENUM ('NEVER', 'YEARLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'SMS', 'EMAIL', 'TELEGRAM', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('DUE_SOON', 'OVERDUE', 'RESERVATION_READY', 'MEMBERSHIP_EXPIRING', 'FINE_ISSUED', 'LOST_BOOK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'READ', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('IMPORT', 'EXPORT', 'BACKUP', 'RESTORE', 'REPORT', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('BOOKS', 'MEMBERS', 'COPIES');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'MAPPING', 'VALIDATED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BackupType" AS ENUM ('FULL', 'DATABASE', 'FILES');

-- CreateEnum
CREATE TYPE "BackupTrigger" AS ENUM ('MANUAL', 'SCHEDULE');

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "address" TEXT,
    "phone" VARCHAR(40),
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "username" VARCHAR(60) NOT NULL,
    "email" VARCHAR(160),
    "passwordHash" TEXT NOT NULL,
    "fullName" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(40),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMPTZ(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "avatarId" UUID,
    "branchId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "group" VARCHAR(40) NOT NULL,
    "label" VARCHAR(160) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" UUID NOT NULL,
    "roleId" UUID NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "familyId" UUID NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "userAgent" VARCHAR(400),
    "ip" VARCHAR(60),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persons" (
    "id" UUID NOT NULL,
    "fullName" VARCHAR(200) NOT NULL,
    "nameNormalized" VARCHAR(200) NOT NULL DEFAULT '',
    "latinName" VARCHAR(200),
    "birthDate" DATE,
    "deathDate" DATE,
    "biography" TEXT,
    "website" VARCHAR(300),
    "nationality" VARCHAR(80),
    "photoId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publishers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "nameNormalized" VARCHAR(200) NOT NULL DEFAULT '',
    "latinName" VARCHAR(200),
    "city" VARCHAR(120),
    "address" TEXT,
    "phone" VARCHAR(40),
    "email" VARCHAR(160),
    "website" VARCHAR(300),
    "logoId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "publishers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "series" (
    "id" UUID NOT NULL,
    "title" VARCHAR(250) NOT NULL,
    "titleNormalized" VARCHAR(250) NOT NULL DEFAULT '',
    "description" TEXT,
    "totalPlanned" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "parentId" UUID,
    "kind" "CategoryKind" NOT NULL DEFAULT 'SUBJECT',
    "name" VARCHAR(160) NOT NULL,
    "nameNormalized" VARCHAR(160) NOT NULL DEFAULT '',
    "code" VARCHAR(40),
    "path" VARCHAR(1000) NOT NULL DEFAULT '',
    "depth" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "colorHex" VARCHAR(9),
    "description" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "nameNormalized" VARCHAR(80) NOT NULL DEFAULT '',
    "colorHex" VARCHAR(9),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "donors" (
    "id" UUID NOT NULL,
    "fullName" VARCHAR(200) NOT NULL,
    "nameNormalized" VARCHAR(200) NOT NULL DEFAULT '',
    "phone" VARCHAR(40),
    "email" VARCHAR(160),
    "address" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "donors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "books" (
    "id" UUID NOT NULL,
    "title" VARCHAR(400) NOT NULL,
    "subtitle" VARCHAR(400),
    "titleEn" VARCHAR(400),
    "originalTitle" VARCHAR(400),
    "titleNormalized" VARCHAR(400) NOT NULL DEFAULT '',
    "searchVector" tsvector,
    "publisherId" UUID,
    "publicationPlace" VARCHAR(120),
    "publicationYear" INTEGER,
    "publicationCalendar" "CalendarType" NOT NULL DEFAULT 'SOLAR_HIJRI',
    "edition" INTEGER,
    "editionNote" VARCHAR(200),
    "isbn13" VARCHAR(13),
    "isbnRaw" VARCHAR(40),
    "issn" VARCHAR(20),
    "nationalBibNumber" VARCHAR(40),
    "language" VARCHAR(12) NOT NULL DEFAULT 'fa',
    "pageCount" INTEGER,
    "format" "BookFormat",
    "bindingType" "BindingType",
    "summary" TEXT,
    "description" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ageRating" VARCHAR(40),
    "deweyCode" VARCHAR(40),
    "congressCode" VARCHAR(40),
    "seriesId" UUID,
    "seriesOrder" INTEGER,
    "parentBookId" UUID,
    "volumeNumber" INTEGER,
    "volumeTitle" VARCHAR(300),
    "totalVolumes" INTEGER,
    "coverImageId" UUID,
    "internalNote" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_contributors" (
    "id" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "role" "ContributorRole" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "book_contributors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_categories" (
    "bookId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "book_categories_pkey" PRIMARY KEY ("bookId","categoryId")
);

-- CreateTable
CREATE TABLE "book_tags" (
    "bookId" UUID NOT NULL,
    "tagId" UUID NOT NULL,

    CONSTRAINT "book_tags_pkey" PRIMARY KEY ("bookId","tagId")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "parentId" UUID,
    "kind" "LocationKind" NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "nameNormalized" VARCHAR(160) NOT NULL DEFAULT '',
    "code" VARCHAR(40) NOT NULL,
    "fullCode" VARCHAR(300) NOT NULL,
    "path" VARCHAR(1000) NOT NULL DEFAULT '',
    "depth" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "capacity" INTEGER,
    "qrToken" UUID NOT NULL,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_copies" (
    "id" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "copyNumber" INTEGER NOT NULL,
    "accessionNumber" VARCHAR(60) NOT NULL,
    "libraryCode" VARCHAR(60),
    "assetNumber" VARCHAR(60),
    "barcode" VARCHAR(60) NOT NULL,
    "qrToken" UUID NOT NULL,
    "status" "CopyStatus" NOT NULL DEFAULT 'AVAILABLE',
    "condition" "CopyCondition" NOT NULL DEFAULT 'GOOD',
    "isLoanable" BOOLEAN NOT NULL DEFAULT true,
    "isReference" BOOLEAN NOT NULL DEFAULT false,
    "locationId" UUID,
    "positionCode" VARCHAR(20),
    "acquisitionSource" "AcquisitionSource" NOT NULL DEFAULT 'PURCHASE',
    "acquiredAt" DATE,
    "donorId" UUID,
    "supplier" VARCHAR(200),
    "purchasePrice" DECIMAL(14,2),
    "currentValue" DECIMAL(14,2),
    "internalNote" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "book_copies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_movements" (
    "id" UUID NOT NULL,
    "copyId" UUID NOT NULL,
    "fromLocationId" UUID,
    "toLocationId" UUID,
    "fromPosition" VARCHAR(20),
    "toPosition" VARCHAR(20),
    "reason" VARCHAR(300),
    "movedById" UUID,
    "movedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "book_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "membership_types" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "maxLoans" INTEGER,
    "loanDays" INTEGER,
    "maxRenewals" INTEGER,
    "maxReservations" INTEGER,
    "dailyFineAmount" DECIMAL(14,2),
    "durationDays" INTEGER,
    "canReserve" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "membership_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "members" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "memberCode" VARCHAR(40) NOT NULL,
    "firstName" VARCHAR(100) NOT NULL,
    "lastName" VARCHAR(120) NOT NULL,
    "nameNormalized" VARCHAR(240) NOT NULL DEFAULT '',
    "nationalId" VARCHAR(20),
    "phone" VARCHAR(40),
    "mobile" VARCHAR(40),
    "email" VARCHAR(160),
    "address" TEXT,
    "postalCode" VARCHAR(20),
    "birthDate" DATE,
    "gender" "Gender" NOT NULL DEFAULT 'UNSPECIFIED',
    "photoId" UUID,
    "membershipTypeId" UUID,
    "status" "MemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3),
    "referrerName" VARCHAR(200),
    "emergencyContactName" VARCHAR(200),
    "emergencyContactPhone" VARCHAR(40),
    "note" TEXT,
    "qrToken" UUID NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loans" (
    "id" UUID NOT NULL,
    "loanNumber" VARCHAR(40) NOT NULL,
    "branchId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "copyId" UUID NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "loanedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "originalDueAt" TIMESTAMPTZ(3) NOT NULL,
    "returnedAt" TIMESTAMPTZ(3),
    "renewalCount" INTEGER NOT NULL DEFAULT 0,
    "lastRenewedAt" TIMESTAMPTZ(3),
    "checkoutBatchId" UUID,
    "loanedById" UUID,
    "returnedById" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
    "queuePosition" INTEGER NOT NULL DEFAULT 1,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "reservedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "notifiedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "holdCopyId" UUID,
    "fulfilledLoanId" UUID,
    "createdById" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fines" (
    "id" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "loanId" UUID,
    "type" "FineType" NOT NULL,
    "status" "FineStatus" NOT NULL DEFAULT 'UNPAID',
    "amount" DECIMAL(14,2) NOT NULL,
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'IRT',
    "reason" VARCHAR(400) NOT NULL,
    "note" TEXT,
    "overdueDays" INTEGER,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMPTZ(3),
    "settledAt" TIMESTAMPTZ(3),
    "waivedById" UUID,
    "waiveReason" VARCHAR(400),
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "fineId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "reference" VARCHAR(120),
    "paidAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lost_reports" (
    "id" UUID NOT NULL,
    "copyId" UUID NOT NULL,
    "loanId" UUID,
    "memberId" UUID,
    "status" "LostReportStatus" NOT NULL DEFAULT 'OPEN',
    "reportedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assessedAmount" DECIMAL(14,2),
    "replacementCopyId" UUID,
    "closedAt" TIMESTAMPTZ(3),
    "description" TEXT,
    "reportedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lost_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_sessions" (
    "id" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" "InventorySessionStatus" NOT NULL DEFAULT 'DRAFT',
    "scopeLocationId" UUID,
    "expectedCount" INTEGER NOT NULL DEFAULT 0,
    "scannedCount" INTEGER NOT NULL DEFAULT 0,
    "foundCount" INTEGER NOT NULL DEFAULT 0,
    "missingCount" INTEGER NOT NULL DEFAULT 0,
    "movedCount" INTEGER NOT NULL DEFAULT 0,
    "unexpectedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "startedById" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_scans" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "barcode" VARCHAR(60) NOT NULL,
    "copyId" UUID,
    "result" "InventoryScanResult" NOT NULL,
    "foundLocationId" UUID,
    "scannedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scannedById" UUID,

    CONSTRAINT "inventory_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
    "id" UUID NOT NULL,
    "copyId" UUID NOT NULL,
    "fromBranchId" UUID NOT NULL,
    "toBranchId" UUID NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMPTZ(3),
    "dispatchedAt" TIMESTAMPTZ(3),
    "receivedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "requestedById" UUID,
    "approvedById" UUID,
    "receivedById" UUID,
    "note" TEXT,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "entityType" VARCHAR(40) NOT NULL,
    "entityId" UUID,
    "kind" "AttachmentKind" NOT NULL DEFAULT 'OTHER',
    "storageKey" VARCHAR(400) NOT NULL,
    "thumbnailKey" VARCHAR(400),
    "originalName" VARCHAR(300) NOT NULL,
    "mimeType" VARCHAR(120) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" VARCHAR(80),
    "width" INTEGER,
    "height" INTEGER,
    "uploadedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" UUID NOT NULL,
    "entityType" VARCHAR(40) NOT NULL,
    "entityId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(80) NOT NULL,
    "value" JSONB NOT NULL,
    "group" VARCHAR(40) NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "numbering_rules" (
    "id" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "target" "NumberingTarget" NOT NULL,
    "pattern" VARCHAR(80) NOT NULL,
    "prefix" VARCHAR(20),
    "currentSequence" INTEGER NOT NULL DEFAULT 0,
    "resetPolicy" "NumberingReset" NOT NULL DEFAULT 'NEVER',
    "currentPeriod" VARCHAR(20),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "numbering_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "userLabel" VARCHAR(160),
    "action" VARCHAR(60) NOT NULL,
    "entityType" VARCHAR(40) NOT NULL,
    "entityId" VARCHAR(80),
    "entityLabel" VARCHAR(300),
    "oldData" JSONB,
    "newData" JSONB,
    "ip" VARCHAR(60),
    "userAgent" VARCHAR(400),
    "requestId" VARCHAR(60),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "memberId" UUID,
    "userId" UUID,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "type" "NotificationType" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "scheduledFor" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "readAt" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "type" "NotificationType" NOT NULL,
    "subject" VARCHAR(200),
    "body" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_records" (
    "id" UUID NOT NULL,
    "kind" "JobKind" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "title" VARCHAR(200) NOT NULL,
    "queueJobId" VARCHAR(80),
    "progress" INTEGER NOT NULL DEFAULT 0,
    "params" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "resultFileKey" VARCHAR(400),
    "error" TEXT,
    "createdById" UUID,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "type" "ImportType" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "fileKey" VARCHAR(400) NOT NULL,
    "originalName" VARCHAR(300) NOT NULL,
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "options" JSONB NOT NULL DEFAULT '{}',
    "headers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "processedRows" INTEGER NOT NULL DEFAULT 0,
    "successRows" INTEGER NOT NULL DEFAULT 0,
    "errorRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_errors" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "column" VARCHAR(120),
    "message" VARCHAR(500) NOT NULL,
    "rawRow" JSONB,

    CONSTRAINT "import_errors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_records" (
    "id" UUID NOT NULL,
    "type" "BackupType" NOT NULL DEFAULT 'FULL',
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "trigger" "BackupTrigger" NOT NULL DEFAULT 'MANUAL',
    "fileKey" VARCHAR(400),
    "fileName" VARCHAR(300),
    "sizeBytes" BIGINT,
    "checksum" VARCHAR(80),
    "schemaVersion" VARCHAR(80),
    "error" TEXT,
    "createdById" UUID,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "retentionUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backup_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_filters" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "entityType" VARCHAR(40) NOT NULL,
    "query" JSONB NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "saved_filters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "branches_code_key" ON "branches"("code");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");

-- CreateIndex
CREATE INDEX "users_isActive_idx" ON "users"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "roles_key_key" ON "roles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "permissions_group_idx" ON "permissions"("group");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "refresh_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "persons_deletedAt_idx" ON "persons"("deletedAt");

-- CreateIndex
CREATE INDEX "publishers_deletedAt_idx" ON "publishers"("deletedAt");

-- CreateIndex
CREATE INDEX "series_deletedAt_idx" ON "series"("deletedAt");

-- CreateIndex
CREATE INDEX "categories_path_idx" ON "categories"("path");

-- CreateIndex
CREATE INDEX "categories_parentId_idx" ON "categories"("parentId");

-- CreateIndex
CREATE INDEX "categories_deletedAt_idx" ON "categories"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "categories_parentId_name_kind_key" ON "categories"("parentId", "name", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "tags_name_key" ON "tags"("name");

-- CreateIndex
CREATE INDEX "donors_deletedAt_idx" ON "donors"("deletedAt");

-- CreateIndex
CREATE INDEX "books_deletedAt_idx" ON "books"("deletedAt");

-- CreateIndex
CREATE INDEX "books_publisherId_idx" ON "books"("publisherId");

-- CreateIndex
CREATE INDEX "books_seriesId_idx" ON "books"("seriesId");

-- CreateIndex
CREATE INDEX "books_parentBookId_idx" ON "books"("parentBookId");

-- CreateIndex
CREATE INDEX "books_isbn13_idx" ON "books"("isbn13");

-- CreateIndex
CREATE INDEX "books_createdAt_idx" ON "books"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "books_publicationYear_idx" ON "books"("publicationYear");

-- CreateIndex
CREATE INDEX "books_language_idx" ON "books"("language");

-- CreateIndex
CREATE INDEX "book_contributors_personId_role_idx" ON "book_contributors"("personId", "role");

-- CreateIndex
CREATE INDEX "book_contributors_bookId_idx" ON "book_contributors"("bookId");

-- CreateIndex
CREATE UNIQUE INDEX "book_contributors_bookId_personId_role_key" ON "book_contributors"("bookId", "personId", "role");

-- CreateIndex
CREATE INDEX "book_categories_categoryId_idx" ON "book_categories"("categoryId");

-- CreateIndex
CREATE INDEX "book_tags_tagId_idx" ON "book_tags"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "locations_qrToken_key" ON "locations"("qrToken");

-- CreateIndex
CREATE INDEX "locations_path_idx" ON "locations"("path");

-- CreateIndex
CREATE INDEX "locations_parentId_idx" ON "locations"("parentId");

-- CreateIndex
CREATE INDEX "locations_branchId_kind_idx" ON "locations"("branchId", "kind");

-- CreateIndex
CREATE INDEX "locations_deletedAt_idx" ON "locations"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "locations_branchId_fullCode_key" ON "locations"("branchId", "fullCode");

-- CreateIndex
CREATE UNIQUE INDEX "book_copies_qrToken_key" ON "book_copies"("qrToken");

-- CreateIndex
CREATE INDEX "book_copies_bookId_idx" ON "book_copies"("bookId");

-- CreateIndex
CREATE INDEX "book_copies_status_idx" ON "book_copies"("status");

-- CreateIndex
CREATE INDEX "book_copies_locationId_idx" ON "book_copies"("locationId");

-- CreateIndex
CREATE INDEX "book_copies_branchId_status_idx" ON "book_copies"("branchId", "status");

-- CreateIndex
CREATE INDEX "book_copies_deletedAt_idx" ON "book_copies"("deletedAt");

-- CreateIndex
CREATE INDEX "book_copies_createdAt_idx" ON "book_copies"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "book_copies_assetNumber_idx" ON "book_copies"("assetNumber");

-- CreateIndex
CREATE INDEX "book_copies_libraryCode_idx" ON "book_copies"("libraryCode");

-- CreateIndex
CREATE UNIQUE INDEX "book_copies_barcode_key" ON "book_copies"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "book_copies_branchId_accessionNumber_key" ON "book_copies"("branchId", "accessionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "book_copies_bookId_copyNumber_key" ON "book_copies"("bookId", "copyNumber");

-- CreateIndex
CREATE INDEX "book_movements_copyId_movedAt_idx" ON "book_movements"("copyId", "movedAt" DESC);

-- CreateIndex
CREATE INDEX "book_movements_movedAt_idx" ON "book_movements"("movedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "membership_types_name_key" ON "membership_types"("name");

-- CreateIndex
CREATE UNIQUE INDEX "members_memberCode_key" ON "members"("memberCode");

-- CreateIndex
CREATE UNIQUE INDEX "members_nationalId_key" ON "members"("nationalId");

-- CreateIndex
CREATE UNIQUE INDEX "members_qrToken_key" ON "members"("qrToken");

-- CreateIndex
CREATE INDEX "members_status_idx" ON "members"("status");

-- CreateIndex
CREATE INDEX "members_expiresAt_idx" ON "members"("expiresAt");

-- CreateIndex
CREATE INDEX "members_deletedAt_idx" ON "members"("deletedAt");

-- CreateIndex
CREATE INDEX "members_branchId_status_idx" ON "members"("branchId", "status");

-- CreateIndex
CREATE INDEX "members_createdAt_idx" ON "members"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "loans_loanNumber_key" ON "loans"("loanNumber");

-- CreateIndex
CREATE INDEX "loans_memberId_status_idx" ON "loans"("memberId", "status");

-- CreateIndex
CREATE INDEX "loans_copyId_status_idx" ON "loans"("copyId", "status");

-- CreateIndex
CREATE INDEX "loans_status_dueAt_idx" ON "loans"("status", "dueAt");

-- CreateIndex
CREATE INDEX "loans_loanedAt_idx" ON "loans"("loanedAt" DESC);

-- CreateIndex
CREATE INDEX "loans_branchId_loanedAt_idx" ON "loans"("branchId", "loanedAt");

-- CreateIndex
CREATE INDEX "loans_returnedAt_idx" ON "loans"("returnedAt");

-- CreateIndex
CREATE INDEX "loans_checkoutBatchId_idx" ON "loans"("checkoutBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_fulfilledLoanId_key" ON "reservations"("fulfilledLoanId");

-- CreateIndex
CREATE INDEX "reservations_bookId_status_queuePosition_idx" ON "reservations"("bookId", "status", "queuePosition");

-- CreateIndex
CREATE INDEX "reservations_memberId_status_idx" ON "reservations"("memberId", "status");

-- CreateIndex
CREATE INDEX "reservations_status_expiresAt_idx" ON "reservations"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "fines_memberId_status_idx" ON "fines"("memberId", "status");

-- CreateIndex
CREATE INDEX "fines_loanId_idx" ON "fines"("loanId");

-- CreateIndex
CREATE INDEX "fines_status_idx" ON "fines"("status");

-- CreateIndex
CREATE INDEX "fines_issuedAt_idx" ON "fines"("issuedAt" DESC);

-- CreateIndex
CREATE INDEX "payments_fineId_idx" ON "payments"("fineId");

-- CreateIndex
CREATE INDEX "payments_paidAt_idx" ON "payments"("paidAt" DESC);

-- CreateIndex
CREATE INDEX "lost_reports_copyId_idx" ON "lost_reports"("copyId");

-- CreateIndex
CREATE INDEX "lost_reports_status_idx" ON "lost_reports"("status");

-- CreateIndex
CREATE INDEX "lost_reports_memberId_idx" ON "lost_reports"("memberId");

-- CreateIndex
CREATE INDEX "inventory_sessions_branchId_status_idx" ON "inventory_sessions"("branchId", "status");

-- CreateIndex
CREATE INDEX "inventory_sessions_createdAt_idx" ON "inventory_sessions"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "inventory_scans_sessionId_result_idx" ON "inventory_scans"("sessionId", "result");

-- CreateIndex
CREATE INDEX "inventory_scans_copyId_idx" ON "inventory_scans"("copyId");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_scans_sessionId_barcode_key" ON "inventory_scans"("sessionId", "barcode");

-- CreateIndex
CREATE INDEX "transfers_copyId_idx" ON "transfers"("copyId");

-- CreateIndex
CREATE INDEX "transfers_status_idx" ON "transfers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storageKey_key" ON "attachments"("storageKey");

-- CreateIndex
CREATE INDEX "attachments_entityType_entityId_idx" ON "attachments"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "attachments_deletedAt_idx" ON "attachments"("deletedAt");

-- CreateIndex
CREATE INDEX "notes_entityType_entityId_createdAt_idx" ON "notes"("entityType", "entityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "settings_group_idx" ON "settings"("group");

-- CreateIndex
CREATE UNIQUE INDEX "numbering_rules_key_key" ON "numbering_rules"("key");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "notifications_memberId_status_idx" ON "notifications"("memberId", "status");

-- CreateIndex
CREATE INDEX "notifications_userId_status_idx" ON "notifications"("userId", "status");

-- CreateIndex
CREATE INDEX "notifications_status_scheduledFor_idx" ON "notifications"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "notifications_createdAt_idx" ON "notifications"("createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_key_channel_key" ON "notification_templates"("key", "channel");

-- CreateIndex
CREATE INDEX "job_records_kind_status_idx" ON "job_records"("kind", "status");

-- CreateIndex
CREATE INDEX "job_records_createdById_createdAt_idx" ON "job_records"("createdById", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "job_records_createdAt_idx" ON "job_records"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "import_jobs_status_idx" ON "import_jobs"("status");

-- CreateIndex
CREATE INDEX "import_jobs_createdAt_idx" ON "import_jobs"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "import_errors_jobId_rowNumber_idx" ON "import_errors"("jobId", "rowNumber");

-- CreateIndex
CREATE INDEX "backup_records_status_idx" ON "backup_records"("status");

-- CreateIndex
CREATE INDEX "backup_records_createdAt_idx" ON "backup_records"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "saved_filters_entityType_isShared_idx" ON "saved_filters"("entityType", "isShared");

-- CreateIndex
CREATE UNIQUE INDEX "saved_filters_userId_entityType_name_key" ON "saved_filters"("userId", "entityType", "name");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "publishers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "books" ADD CONSTRAINT "books_parentBookId_fkey" FOREIGN KEY ("parentBookId") REFERENCES "books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_contributors" ADD CONSTRAINT "book_contributors_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_contributors" ADD CONSTRAINT "book_contributors_personId_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_categories" ADD CONSTRAINT "book_categories_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_categories" ADD CONSTRAINT "book_categories_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_tags" ADD CONSTRAINT "book_tags_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_tags" ADD CONSTRAINT "book_tags_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_copies" ADD CONSTRAINT "book_copies_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_copies" ADD CONSTRAINT "book_copies_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_copies" ADD CONSTRAINT "book_copies_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_copies" ADD CONSTRAINT "book_copies_donorId_fkey" FOREIGN KEY ("donorId") REFERENCES "donors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_movements" ADD CONSTRAINT "book_movements_copyId_fkey" FOREIGN KEY ("copyId") REFERENCES "book_copies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_movements" ADD CONSTRAINT "book_movements_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_movements" ADD CONSTRAINT "book_movements_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_membershipTypeId_fkey" FOREIGN KEY ("membershipTypeId") REFERENCES "membership_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_copyId_fkey" FOREIGN KEY ("copyId") REFERENCES "book_copies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_holdCopyId_fkey" FOREIGN KEY ("holdCopyId") REFERENCES "book_copies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_fulfilledLoanId_fkey" FOREIGN KEY ("fulfilledLoanId") REFERENCES "loans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fines" ADD CONSTRAINT "fines_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fines" ADD CONSTRAINT "fines_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_fineId_fkey" FOREIGN KEY ("fineId") REFERENCES "fines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lost_reports" ADD CONSTRAINT "lost_reports_copyId_fkey" FOREIGN KEY ("copyId") REFERENCES "book_copies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lost_reports" ADD CONSTRAINT "lost_reports_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lost_reports" ADD CONSTRAINT "lost_reports_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_sessions" ADD CONSTRAINT "inventory_sessions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_sessions" ADD CONSTRAINT "inventory_sessions_scopeLocationId_fkey" FOREIGN KEY ("scopeLocationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_scans" ADD CONSTRAINT "inventory_scans_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "inventory_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_scans" ADD CONSTRAINT "inventory_scans_copyId_fkey" FOREIGN KEY ("copyId") REFERENCES "book_copies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_scans" ADD CONSTRAINT "inventory_scans_foundLocationId_fkey" FOREIGN KEY ("foundLocationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_copyId_fkey" FOREIGN KEY ("copyId") REFERENCES "book_copies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_fromBranchId_fkey" FOREIGN KEY ("fromBranchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_toBranchId_fkey" FOREIGN KEY ("toBranchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_filters" ADD CONSTRAINT "saved_filters_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
