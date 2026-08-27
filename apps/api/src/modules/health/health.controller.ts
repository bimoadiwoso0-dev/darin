import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { access, constants, statfs } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Public } from '../../common/decorators/auth.decorators';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QueueService } from '../../infrastructure/queue/queue.service';

interface CheckResult {
  status: 'ok' | 'degraded' | 'down';
  message?: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
}

/**
 * Health Check (قانون ۱۱۲).
 *
 * سه سطح:
 *  - `/health/live`  → آیا فرایند زنده است؟ (برای Restart خودکار)
 *  - `/health/ready` → آیا آماده پذیرش ترافیک است؟ (دیتابیس لازم است)
 *  - `/health`       → گزارش کامل برای صفحه وضعیت مدیر
 *
 * تفاوت `degraded` و `down` مهم است: اگر صف کار نکند، سامانه همچنان می‌تواند
 * کتاب امانت بدهد (فقط اعلان‌ها تأخیر می‌گیرند) → degraded.
 * اگر دیتابیس قطع باشد، هیچ کاری ممکن نیست → down.
 */
@ApiTags('سلامت سیستم')
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly queue: QueueService,
  ) {}

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'زنده بودن فرایند' })
  live() {
    return { status: 'ok', uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000) };
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'آمادگی پذیرش ترافیک' })
  async ready(@Res({ passthrough: true }) res: Response) {
    const db = await this.prisma.healthCheck();
    if (!db.ok) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'down', database: 'unreachable' };
    }
    return { status: 'ok', database: 'ok', latencyMs: db.latencyMs };
  }

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'گزارش کامل سلامت سیستم' })
  async full(@Res({ passthrough: true }) res: Response) {
    const [database, storage, queue] = await Promise.all([
      this.checkDatabase(),
      this.checkStorage(),
      this.checkQueue(),
    ]);

    const checks = { database, storage, queue, application: this.checkApplication() };
    const statuses = Object.values(checks).map((c) => c.status);
    const overall = statuses.includes('down')
      ? 'down'
      : statuses.includes('degraded')
        ? 'degraded'
        : 'ok';

    if (overall === 'down') res.status(HttpStatus.SERVICE_UNAVAILABLE);

    return {
      status: overall,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      checks,
    };
  }

  private async checkDatabase(): Promise<CheckResult> {
    const health = await this.prisma.healthCheck();
    if (!health.ok) {
      return { status: 'down', message: 'اتصال به پایگاه داده برقرار نیست', latencyMs: health.latencyMs };
    }

    // تعداد اتصالات باز — نشانه زودهنگام نشت اتصال یا فشار بار
    const [connections] = await this.prisma.$queryRaw<Array<{ used: bigint; max: number }>>`
      SELECT count(*)::bigint AS used,
             current_setting('max_connections')::int AS max
      FROM pg_stat_activity WHERE datname = current_database()
    `;
    const used = Number(connections?.used ?? 0);
    const max = connections?.max ?? 100;
    const ratio = used / max;

    return {
      status: ratio > 0.9 ? 'degraded' : 'ok',
      latencyMs: health.latencyMs,
      message: ratio > 0.9 ? 'تعداد اتصالات دیتابیس به حد بحرانی نزدیک است' : undefined,
      details: { connectionsUsed: used, connectionsMax: max },
    };
  }

  private async checkStorage(): Promise<CheckResult> {
    const path = resolve(this.config.get<string>('STORAGE_LOCAL_PATH', './storage'));
    try {
      await access(path, constants.W_OK);
      const stats = await statfs(path);
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      const totalBytes = Number(stats.blocks) * Number(stats.bsize);
      const freeRatio = totalBytes > 0 ? freeBytes / totalBytes : 1;

      return {
        // فضای کم یعنی پشتیبان‌گیری و آپلود جلد به‌زودی شکست می‌خورند
        status: freeRatio < 0.05 ? 'degraded' : 'ok',
        message: freeRatio < 0.05 ? 'فضای دیسک رو به اتمام است' : undefined,
        details: {
          path,
          freeMB: Math.round(freeBytes / 1_048_576),
          totalMB: Math.round(totalBytes / 1_048_576),
        },
      };
    } catch (err) {
      return {
        status: 'down',
        message: 'مسیر ذخیره‌سازی قابل نوشتن نیست',
        details: { path, error: err instanceof Error ? err.message : String(err) },
      };
    }
  }

  private async checkQueue(): Promise<CheckResult> {
    if (!this.queue.isEnabled) {
      return {
        status: 'ok',
        message: 'صف غیرفعال است — کارهای پس‌زمینه به‌صورت همزمان اجرا می‌شوند',
        details: { enabled: false },
      };
    }
    const health = await this.queue.healthCheck();
    return health.ok
      ? { status: 'ok', latencyMs: health.latencyMs, details: { enabled: true } }
      : {
          status: 'degraded',
          message: 'اتصال به Redis برقرار نیست — اعلان‌ها و خروجی‌های بزرگ تأخیر خواهند داشت',
          details: { enabled: true, error: health.error },
        };
  }

  private checkApplication(): CheckResult {
    const mem = process.memoryUsage();
    const heapRatio = mem.heapUsed / mem.heapTotal;
    return {
      status: heapRatio > 0.95 ? 'degraded' : 'ok',
      details: {
        nodeVersion: process.version,
        environment: this.config.get<string>('NODE_ENV'),
        heapUsedMB: Math.round(mem.heapUsed / 1_048_576),
        rssMB: Math.round(mem.rss / 1_048_576),
      },
    };
  }
}
