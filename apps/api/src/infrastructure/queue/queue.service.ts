import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job, type JobsOptions } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';

export const QUEUE_NAMES = {
  IMPORTS: 'imports',
  EXPORTS: 'exports',
  BACKUPS: 'backups',
  NOTIFICATIONS: 'notifications',
  IMAGES: 'images',
  MAINTENANCE: 'maintenance',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export type JobHandler<T = unknown> = (data: T, job?: Job<T>) => Promise<unknown>;

/**
 * صف کارهای پس‌زمینه.
 *
 * **تصمیم طراحی مهم:** سامانه باید بدون Redis هم کاملاً کار کند.
 *
 * یک کتابخانه ۱۰٬۰۰۰ جلدی ممکن است روی یک سرور ساده مستقر شود که مدیرش
 * نمی‌خواهد Redis نصب و نگهداری کند. اگر `QUEUE_ENABLED=false` باشد، همین
 * کلاس کارها را **درجا (inline)** اجرا می‌کند: پشتیبان‌گیری، Import و خروجی
 * همچنان واقعاً انجام می‌شوند، فقط درخواست HTTP منتظر می‌ماند.
 *
 * این «قابلیت جعلی» (قانون ۱۳۴) نیست — رفتار در هر دو حالت واقعی است و
 * تفاوتش در مستندات و در پاسخ Health Check شفاف اعلام می‌شود.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private connection: Redis | null = null;
  private readonly queues = new Map<QueueName, Queue>();
  private readonly workers: Worker[] = [];
  private readonly inlineHandlers = new Map<string, JobHandler>();

  readonly isEnabled: boolean;

  constructor(private readonly config: ConfigService) {
    this.isEnabled =
      config.get<boolean>('QUEUE_ENABLED', false) === true && Boolean(config.get<string>('REDIS_URL'));
  }

  onModuleInit(): void {
    if (!this.isEnabled) {
      this.logger.log('صف غیرفعال است — کارهای پس‌زمینه به‌صورت همزمان اجرا می‌شوند');
      return;
    }

    this.connection = new IORedis(this.config.getOrThrow<string>('REDIS_URL'), {
      // BullMQ این تنظیم را الزامی می‌داند تا Worker روی خطای موقت متوقف نشود
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });

    this.connection.on('error', (err) => {
      this.logger.error({ err }, 'خطای اتصال Redis');
    });

    for (const name of Object.values(QUEUE_NAMES)) {
      this.queues.set(
        name,
        new Queue(name, {
          connection: this.connection,
          defaultJobOptions: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5_000 },
            // نگه‌داشتن تاریخچه محدود تا Redis پر نشود
            removeOnComplete: { age: 86_400, count: 500 },
            removeOnFail: { age: 7 * 86_400 },
          },
        }),
      );
    }
    this.logger.log(`صف فعال شد (${this.queues.size} صف)`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    await this.connection?.quit();
  }

  /**
   * افزودن کار به صف.
   * در حالت inline، کار همین‌جا اجرا می‌شود و نتیجه‌اش برگردانده می‌شود.
   */
  async add<T>(queue: QueueName, jobName: string, data: T, opts?: JobsOptions): Promise<string> {
    if (!this.isEnabled) {
      const handler = this.inlineHandlers.get(`${queue}:${jobName}`);
      if (!handler) {
        this.logger.warn(`کار «${jobName}» در صف «${queue}» پردازشگری ندارد و نادیده گرفته شد`);
        return 'inline-no-handler';
      }
      try {
        await handler(data);
        return 'inline-completed';
      } catch (err) {
        this.logger.error({ err, queue, jobName }, 'اجرای همزمان کار ناموفق بود');
        throw err;
      }
    }

    const q = this.queues.get(queue);
    if (!q) throw new Error(`صف ناشناخته: ${queue}`);
    const job = await q.add(jobName, data, opts);
    return job.id ?? 'unknown';
  }

  /**
   * ثبت پردازشگر یک نوع کار.
   * ماژول‌ها در `onModuleInit` خودشان این را صدا می‌زنند.
   */
  register<T>(queue: QueueName, jobName: string, handler: JobHandler<T>): void {
    this.inlineHandlers.set(`${queue}:${jobName}`, handler as JobHandler);

    if (!this.isEnabled || !this.connection) return;

    const worker = new Worker(
      queue,
      async (job: Job) => {
        if (job.name !== jobName) return undefined;
        return handler(job.data as T, job as Job<T>);
      },
      { connection: this.connection, concurrency: 2 },
    );

    worker.on('failed', (job, err) => {
      this.logger.error({ err, jobId: job?.id, jobName: job?.name }, 'اجرای کار پس‌زمینه ناموفق بود');
    });

    this.workers.push(worker);
  }

  /** کار زمان‌بندی‌شده تکرارشونده (مثل پشتیبان‌گیری شبانه). */
  async schedule<T>(queue: QueueName, jobName: string, data: T, cron: string): Promise<void> {
    if (!this.isEnabled) {
      // در حالت inline از @nestjs/schedule استفاده می‌شود، نه از این متد.
      return;
    }
    const q = this.queues.get(queue);
    if (!q) return;
    // BullMQ v5: کارهای تکرارشونده از `upsertJobScheduler` ثبت می‌شوند، نه
    // از گزینه `repeat` در `add`. کلید ثابت باعث می‌شود Restart برنامه
    // زمان‌بندی تکراری نسازد.
    await q.upsertJobScheduler(
      `scheduled:${jobName}`,
      { pattern: cron },
      { name: jobName, data: data as object },
    );
  }

  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    if (!this.isEnabled || !this.connection) return { ok: true, latencyMs: 0 };
    const started = Date.now();
    try {
      await this.connection.ping();
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** آمار صف — برای صفحه وضعیت سیستم. */
  async stats(): Promise<Record<string, { waiting: number; active: number; failed: number }>> {
    if (!this.isEnabled) return {};
    const out: Record<string, { waiting: number; active: number; failed: number }> = {};
    for (const [name, q] of this.queues) {
      const [waiting, active, failed] = await Promise.all([
        q.getWaitingCount(),
        q.getActiveCount(),
        q.getFailedCount(),
      ]);
      out[name] = { waiting, active, failed };
    }
    return out;
  }
}
