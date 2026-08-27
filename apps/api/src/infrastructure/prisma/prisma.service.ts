import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

/**
 * تنها نقطه دسترسی به دیتابیس در کل برنامه.
 *
 * سرویس‌های دامنه این کلاس را تزریق می‌کنند؛ هیچ ماژولی `PrismaClient` خودش
 * را نمی‌سازد (در غیر این صورت هر ماژول یک استخر اتصال جدا باز می‌کند).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    const connectionString = config.getOrThrow<string>('DATABASE_URL');
    super({
      adapter: new PrismaPg({ connectionString }),
      log:
        config.get<string>('NODE_ENV') === 'development'
          ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
          : [{ emit: 'event', level: 'error' }],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('اتصال به پایگاه داده برقرار شد');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * سلامت اتصال دیتابیس به‌همراه زمان پاسخ — برای Health Check.
   */
  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const started = Date.now();
    try {
      await this.$queryRaw`SELECT 1`;
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
