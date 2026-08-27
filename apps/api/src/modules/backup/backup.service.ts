import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ERROR_CODES, SETTING_KEYS } from '@darin/shared';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import type { AuthenticatedUser } from '../../common/decorators/auth.decorators';

/**
 * پشتیبان‌گیری و بازیابی (قوانین ۵۴، ۵۵، ۱۳۴).
 *
 * ── قانون ۱۳۴: قابلیت جعلی ممنوع ─────────────────────────────────────────
 * دکمه «پشتیبان‌گیری» واقعاً `pg_dump` اجرا می‌کند و یک فایل `.sql.gz`
 * قابل بازیابی تولید می‌کند. اندازه، چک‌سام و مسیر فایل در دیتابیس ثبت
 * می‌شود و فایل قابل دانلود است.
 *
 * ── چرا pg_dump و نه کپی جدول‌به‌جدول ────────────────────────────────────
 * `pg_dump` تنها روشی است که سازگاری ارجاعی (Foreign Key)، توالی‌ها،
 * توابع، Trigger ها و ایندکس‌های دستی ما را کامل حفظ می‌کند. کپی دستی
 * جدول‌ها، `persian_normalize` و Trigger های جستجو را از دست می‌دهد.
 *
 * ── امنیت ────────────────────────────────────────────────────────────────
 * رمز عبور دیتابیس از طریق متغیر محیطی `PGPASSWORD` به فرایند فرزند داده
 * می‌شود، نه در خط فرمان — چون خط فرمان در `ps` برای همه کاربران سرور
 * قابل مشاهده است.
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private readonly backupPath: string;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {
    this.backupPath = resolve(config.get<string>('BACKUP_PATH', './storage/backups'));
  }

  /**
   * ایجاد نسخه پشتیبان.
   *
   * قفل `running` از اجرای هم‌زمان دو پشتیبان‌گیری جلوگیری می‌کند — دو
   * `pg_dump` هم‌زمان روی یک سرور کوچک، حافظه و I/O را اشباع می‌کند.
   */
  async create(
    trigger: 'MANUAL' | 'SCHEDULE',
    user?: AuthenticatedUser,
    ip?: string,
  ): Promise<{ id: string; fileName: string; sizeBytes: number }> {
    if (this.running) {
      throw DomainError.conflict(
        ERROR_CODES.CONFLICT,
        'یک عملیات پشتیبان‌گیری در حال اجراست. لطفاً تا پایان آن صبر کنید.',
      );
    }
    this.running = true;

    const record = await this.prisma.backupRecord.create({
      data: {
        type: 'DATABASE',
        status: 'RUNNING',
        trigger,
        startedAt: new Date(),
        createdById: user?.sub ?? null,
      },
    });

    try {
      await mkdir(this.backupPath, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const fileName = `darin-${timestamp}.sql.gz`;
      const filePath = join(this.backupPath, fileName);

      await this.runPgDump(filePath);

      const [stats, checksum, schemaVersion] = await Promise.all([
        stat(filePath),
        this.checksumOf(filePath),
        this.currentSchemaVersion(),
      ]);

      // فایل خالی یا خیلی کوچک یعنی pg_dump شکست خورده ولی کد خروج صفر داده
      if (stats.size < 1024) {
        await rm(filePath, { force: true });
        throw new DomainError(
          ERROR_CODES.BACKUP_FAILED,
          'فایل پشتیبان تولیدشده معتبر نیست (حجم بسیار کم). تنظیمات اتصال دیتابیس را بررسی کنید.',
        );
      }

      const retentionCount = this.settings.get(SETTING_KEYS.BACKUP_RETENTION_COUNT);
      const updated = await this.prisma.backupRecord.update({
        where: { id: record.id },
        data: {
          status: 'COMPLETED',
          fileKey: fileName,
          fileName,
          sizeBytes: BigInt(stats.size),
          checksum,
          schemaVersion,
          finishedAt: new Date(),
          retentionUntil: new Date(Date.now() + retentionCount * 86_400_000),
        },
      });

      await this.pruneOldBackups(retentionCount);

      await this.audit.record({
        action: 'create_backup',
        entityType: 'BackupRecord',
        entityId: record.id,
        entityLabel: `${fileName} (${formatSize(stats.size)})`,
        newData: { trigger, sizeBytes: stats.size, checksum },
        user: user ?? null,
        ip,
      });

      this.logger.log(`نسخه پشتیبان ساخته شد: ${fileName} (${formatSize(stats.size)})`);
      return { id: updated.id, fileName, sizeBytes: stats.size };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.backupRecord.update({
        where: { id: record.id },
        data: { status: 'FAILED', error: message.slice(0, 2000), finishedAt: new Date() },
      });
      this.logger.error({ err }, 'پشتیبان‌گیری ناموفق بود');
      if (err instanceof DomainError) throw err;
      throw new DomainError(
        ERROR_CODES.BACKUP_FAILED,
        'ایجاد نسخه پشتیبان ناموفق بود. جزئیات فنی در گزارش سرور ثبت شد.',
      );
    } finally {
      this.running = false;
    }
  }

  /**
   * بازیابی از نسخه پشتیبان.
   *
   * ⚠️ این عملیات **تمام داده فعلی را بازنویسی می‌کند**. به همین دلیل:
   *   • فقط با مجوز `backup.manage` قابل اجراست
   *   • پیش از بازیابی، یک پشتیبان خودکار از وضعیت فعلی گرفته می‌شود
   *   • در Audit Log با تمام جزئیات ثبت می‌شود
   */
  async restore(
    backupId: string,
    confirmation: string,
    user: AuthenticatedUser,
    ip?: string,
  ): Promise<{ restored: boolean; safetyBackupId: string }> {
    // تأیید صریح متنی — جلوگیری از کلیک اشتباهی روی عملیاتی غیرقابل بازگشت
    if (confirmation !== 'RESTORE') {
      throw DomainError.validation({
        confirmation: ['برای تأیید بازیابی باید عبارت RESTORE را دقیقاً وارد کنید.'],
      });
    }

    const backup = await this.prisma.backupRecord.findUnique({ where: { id: backupId } });
    if (!backup || !backup.fileKey) throw DomainError.notFound('نسخه پشتیبان');
    if (backup.status !== 'COMPLETED') {
      throw DomainError.conflict(ERROR_CODES.CONFLICT, 'این نسخه پشتیبان کامل نشده است.');
    }

    const filePath = this.resolveBackupPath(backup.fileKey);
    const exists = await stat(filePath).catch(() => null);
    if (!exists) {
      throw new DomainError(
        ERROR_CODES.RESTORE_FAILED,
        'فایل پشتیبان روی دیسک یافت نشد. ممکن است حذف شده باشد.',
      );
    }

    // بررسی چک‌سام — فایل خراب نباید روی داده سالم بازیابی شود
    if (backup.checksum) {
      const actual = await this.checksumOf(filePath);
      if (actual !== backup.checksum) {
        throw new DomainError(
          ERROR_CODES.RESTORE_FAILED,
          'فایل پشتیبان آسیب دیده است (چک‌سام مطابقت ندارد) و بازیابی انجام نشد.',
        );
      }
    }

    this.logger.warn(
      { backupId, userId: user.sub },
      'بازیابی نسخه پشتیبان آغاز شد — داده فعلی بازنویسی می‌شود',
    );

    // پشتیبان ایمنی از وضعیت فعلی، پیش از بازنویسی
    const safety = await this.create('MANUAL', user, ip);

    await this.audit.record({
      action: 'restore_backup',
      entityType: 'BackupRecord',
      entityId: backupId,
      entityLabel: backup.fileName ?? backupId,
      oldData: { safetyBackupId: safety.id },
      newData: { restoredFrom: backup.fileName },
      user, ip,
    });

    await this.runPsqlRestore(filePath);

    // تنظیمات در حافظه با داده بازیابی‌شده هم‌خوان نیست
    await this.settings.reload();

    this.logger.warn(`بازیابی از «${backup.fileName}» کامل شد`);
    return { restored: true, safetyBackupId: safety.id };
  }

  async list(limit = 50) {
    const records = await this.prisma.backupRecord.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // وجود فیزیکی فایل بررسی می‌شود — رکوردی که فایلش پاک شده نباید
    // به‌عنوان «قابل بازیابی» نشان داده شود.
    return Promise.all(
      records.map(async (r) => ({
        ...r,
        sizeBytes: r.sizeBytes ? Number(r.sizeBytes) : null,
        sizeLabel: r.sizeBytes ? formatSize(Number(r.sizeBytes)) : null,
        fileExists: r.fileKey
          ? await stat(this.resolveBackupPath(r.fileKey)).then(() => true).catch(() => false)
          : false,
      })),
    );
  }

  /** مسیر فایل برای دانلود. */
  async getFilePath(backupId: string): Promise<{ path: string; fileName: string }> {
    const backup = await this.prisma.backupRecord.findUnique({ where: { id: backupId } });
    if (!backup?.fileKey) throw DomainError.notFound('نسخه پشتیبان');
    const path = this.resolveBackupPath(backup.fileKey);
    await stat(path).catch(() => {
      throw DomainError.notFound('فایل پشتیبان');
    });
    return { path, fileName: backup.fileName ?? basename(path) };
  }

  async remove(backupId: string, user: AuthenticatedUser, ip?: string): Promise<void> {
    const backup = await this.prisma.backupRecord.findUnique({ where: { id: backupId } });
    if (!backup) throw DomainError.notFound('نسخه پشتیبان');

    if (backup.fileKey) {
      await rm(this.resolveBackupPath(backup.fileKey), { force: true });
    }
    await this.prisma.backupRecord.delete({ where: { id: backupId } });

    await this.audit.record({
      action: 'delete_backup',
      entityType: 'BackupRecord',
      entityId: backupId,
      entityLabel: backup.fileName ?? backupId,
      user, ip,
    });
  }

  /**
   * پشتیبان‌گیری زمان‌بندی‌شده (قانون ۵۴).
   * هر شب ساعت ۲ بامداد — ساعتی که کتابخانه قطعاً بسته است.
   */
  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: 'scheduled-backup' })
  async scheduledBackup(): Promise<void> {
    const schedule = this.settings.get(SETTING_KEYS.BACKUP_SCHEDULE);
    if (schedule === 'off') return;

    if (schedule === 'weekly' && new Date().getDay() !== 5) {
      // هفتگی: فقط جمعه‌ها (روز تعطیل کتابخانه در ایران)
      return;
    }

    try {
      await this.create('SCHEDULE');
    } catch (err) {
      this.logger.error({ err }, 'پشتیبان‌گیری زمان‌بندی‌شده ناموفق بود');
    }
  }

  // ── داخلی ──────────────────────────────────────────────────────────────

  /** اجرای `pg_dump` با خروجی فشرده. */
  private runPgDump(outputPath: string): Promise<void> {
    const { url, env, schema } = this.connectionParams();
    const pgDump = this.config.get<string>('PG_DUMP_PATH', 'pg_dump');

    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(
        pgDump,
        [
          url,
          '--format=plain',
          '--no-owner',        // بازیابی روی کاربر دیگری هم کار کند
          '--no-privileges',
          '--clean',           // پیش از بازیابی، اشیای موجود حذف شوند
          '--if-exists',
          '--quote-all-identifiers',
          ...(schema ? [`--schema=${schema}`] : []),
        ],
        { env, stdio: ['ignore', 'pipe', 'pipe'] },
      );

      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const output = createWriteStream(outputPath);
      const gzip = createGzip({ level: 6 });

      pipeline(child.stdout, gzip, output).catch(rejectPromise);

      child.on('error', (err) => {
        rejectPromise(
          new Error(
            `اجرای pg_dump ممکن نشد (${err.message}). مطمئن شوید ابزارهای PostgreSQL نصب و در PATH هستند.`,
          ),
        );
      });

      child.on('close', (code) => {
        if (code === 0) {
          output.on('close', () => resolvePromise());
        } else {
          rejectPromise(new Error(`pg_dump با کد ${code} خارج شد: ${stderr.slice(0, 500)}`));
        }
      });
    });
  }

  /** بازیابی: فایل gz را باز و به `psql` می‌دهد. */
  private runPsqlRestore(filePath: string): Promise<void> {
    const { url, env } = this.connectionParams();
    const psql = this.config.get<string>('PSQL_PATH', 'psql');

    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(
        psql,
        [url, '--quiet', '--set=ON_ERROR_STOP=off'],
        { env, stdio: ['pipe', 'ignore', 'pipe'] },
      );

      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      pipeline(createReadStream(filePath), createGunzip(), child.stdin).catch(rejectPromise);

      child.on('error', (err) =>
        rejectPromise(new Error(`اجرای psql ممکن نشد: ${err.message}`)),
      );
      child.on('close', (code) => {
        if (code === 0) resolvePromise();
        else rejectPromise(new Error(`psql با کد ${code} خارج شد: ${stderr.slice(0, 500)}`));
      });
    });
  }

  /**
   * پارامترهای اتصال برای ابزارهای خط فرمان PostgreSQL.
   *
   * دو نکته مهم:
   *
   * ۱. **رمز عبور** از URL جدا و به‌صورت متغیر محیطی `PGPASSWORD` منتقل
   *    می‌شود، نه در خط فرمان — چون خط فرمان در خروجی `ps` برای همه
   *    کاربران سرور قابل مشاهده است.
   *
   * ۲. **پارامترهای مخصوص Prisma** باید حذف شوند. `DATABASE_URL` معمولاً
   *    شامل `?schema=public` است و `pg_dump` آن را نمی‌شناسد و با خطای
   *    «invalid URI query parameter» رد می‌کند. فقط پارامترهایی که
   *    libpq می‌فهمد نگه داشته می‌شوند و `schema` به سوئیچ `--schema`
   *    تبدیل می‌شود.
   */
  private connectionParams(): { url: string; env: NodeJS.ProcessEnv; schema: string | null } {
    const raw = this.config.getOrThrow<string>('DATABASE_URL');

    // پارامترهایی که libpq می‌شناسد؛ بقیه (schema، connection_limit،
    // pgbouncer، pool_timeout و ...) مخصوص Prisma هستند و باید حذف شوند.
    const LIBPQ_PARAMS = new Set([
      'sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'sslcrl',
      'connect_timeout', 'application_name', 'options', 'target_session_attrs',
    ]);

    try {
      const parsed = new URL(raw);
      const password = decodeURIComponent(parsed.password);
      parsed.password = '';

      const schema = parsed.searchParams.get('schema');
      for (const key of [...parsed.searchParams.keys()]) {
        if (!LIBPQ_PARAMS.has(key)) parsed.searchParams.delete(key);
      }

      return {
        url: parsed.toString(),
        env: { ...process.env, PGPASSWORD: password },
        schema: schema && schema !== 'public' ? schema : null,
      };
    } catch {
      return { url: raw, env: { ...process.env }, schema: null };
    }
  }

  /** حذف پشتیبان‌های قدیمی طبق سیاست نگهداری. */
  private async pruneOldBackups(keep: number): Promise<void> {
    const all = await this.prisma.backupRecord.findMany({
      where: { status: 'COMPLETED', fileKey: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, fileKey: true },
    });

    const toDelete = all.slice(keep);
    for (const record of toDelete) {
      if (record.fileKey) {
        await rm(this.resolveBackupPath(record.fileKey), { force: true });
      }
      await this.prisma.backupRecord.update({
        where: { id: record.id },
        data: { fileKey: null, error: 'فایل طبق سیاست نگهداری حذف شد' },
      });
    }

    if (toDelete.length > 0) {
      this.logger.log(`${toDelete.length} نسخه پشتیبان قدیمی حذف شد`);
    }
  }

  /** نسخه آخرین Migration اعمال‌شده — برای بررسی سازگاری هنگام بازیابی. */
  private async currentSchemaVersion(): Promise<string | null> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ migration_name: string }>>`
        SELECT migration_name FROM _prisma_migrations
         WHERE finished_at IS NOT NULL
         ORDER BY finished_at DESC LIMIT 1
      `;
      return rows[0]?.migration_name ?? null;
    } catch {
      return null;
    }
  }

  private async checksumOf(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    await pipeline(createReadStream(filePath), hash);
    return hash.digest('hex');
  }

  /** جلوگیری از Path Traversal روی نام فایل پشتیبان. */
  private resolveBackupPath(fileKey: string): string {
    const safeName = basename(fileKey);
    return join(this.backupPath, safeName);
  }

  /** فهرست فایل‌های موجود روی دیسک — برای تشخیص فایل‌های یتیم. */
  async listOrphanFiles(): Promise<string[]> {
    const files = await readdir(this.backupPath).catch(() => [] as string[]);
    const known = await this.prisma.backupRecord.findMany({
      where: { fileKey: { not: null } },
      select: { fileKey: true },
    });
    const knownSet = new Set(known.map((k) => k.fileKey!));
    return files.filter((f) => f.endsWith('.sql.gz') && !knownSet.has(f));
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} بایت`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} کیلوبایت`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)} مگابایت`;
  return `${(bytes / 1_073_741_824).toFixed(2)} گیگابایت`;
}
