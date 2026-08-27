import { Global, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

/**
 * Global است چون قوانین امانت، جریمه و شماره‌گذاری در بیشتر ماژول‌های دامنه
 * خوانده می‌شوند و تزریق دستی آن در همه‌جا فقط تکرار است.
 */
@Global()
@Module({
  imports: [AuditModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
