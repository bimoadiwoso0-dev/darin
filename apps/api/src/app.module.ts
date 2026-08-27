import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { validateEnv } from './config/configuration';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { BackupModule } from './modules/backup/backup.module';
import { CirculationModule } from './modules/circulation/circulation.module';
import { ExportsModule } from './modules/exports/exports.module';
import { ImportsModule } from './modules/imports/imports.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { LabelsModule } from './modules/labels/labels.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SearchModule } from './modules/search/search.module';
import { HoldingsModule } from './modules/holdings/holdings.module';
import { LocationsModule } from './modules/locations/locations.module';
import { MembersModule } from './modules/members/members.module';
import { NumberingModule } from './modules/numbering/numbering.module';
import { HealthModule } from './modules/health/health.module';
import { SettingsModule } from './modules/settings/settings.module';
import { SetupModule } from './modules/setup/setup.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // فایل .env در ریشه Monorepo است تا API و Web یک منبع تنظیمات داشته باشند
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
      cache: true,
    }),

    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('LOG_LEVEL', 'info'),
          // هر درخواست یک شناسه می‌گیرد که در پاسخ خطا هم برمی‌گردد؛
          // کتابدار می‌تواند همان شناسه را به پشتیبانی بدهد.
          genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
          transport: config.get<boolean>('LOG_PRETTY', false)
            ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } }
            : undefined,
          // هرگز رمز عبور، کوکی یا توکن در لاگ ثبت نمی‌شود
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              'req.body.password',
              'req.body.newPassword',
              'req.body.currentPassword',
            ],
            censor: '[حذف‌شده]',
          },
          autoLogging: {
            ignore: (req) => req.url?.startsWith('/api/health') === true,
          },
        },
      }),
    }),

    /**
     * محدودیت نرخ درخواست.
     *
     * فقط **یک** محدودکننده سراسری تعریف می‌شود. علت: NestJS Throttler هر
     * محدودکننده نام‌دار را روی **همه** مسیرها اعمال می‌کند، نه فقط جایی که
     * صدا زده شده. تعریف یک محدودکننده دوم به‌نام `login` با سقف ۱۰،
     * عملاً کل API را به ۱۰ درخواست در دقیقه محدود می‌کرد.
     *
     * مسیرهای حساس (ورود، Setup) با
     * `@Throttle({ default: { limit, ttl } })` سقف سخت‌گیرانه‌تر خودشان را
     * روی همین محدودکننده بازنویسی می‌کنند.
     */
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.get<number>('RATE_LIMIT_TTL', 60) * 1000,
            limit: config.get<number>('RATE_LIMIT_MAX', 300),
          },
        ],
      }),
    }),

    ScheduleModule.forRoot(),

    InfrastructureModule,
    SettingsModule,
    AuditModule,
    AuthModule,
    SetupModule,
    HealthModule,

    // ── ماژول‌های دامنه ──────────────────────────────────────────────
    NumberingModule,
    LocationsModule,
    CatalogModule,
    HoldingsModule,
    MembersModule,
    CirculationModule,
    SearchModule,
    ReportsModule,
    ExportsModule,
    InventoryModule,
    ImportsModule,
    LabelsModule,
    BackupModule,
    MaintenanceModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // ترتیب مهم است: محدودیت نرخ → احراز هویت → مجوز
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
