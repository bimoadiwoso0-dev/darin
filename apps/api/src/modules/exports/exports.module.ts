import { Global, Module } from '@nestjs/common';
import { ExportService } from './export.service';

/** Global است چون گزارش‌ها، کتاب‌ها و اعضا همگی خروجی می‌گیرند. */
@Global()
@Module({ providers: [ExportService], exports: [ExportService] })
export class ExportsModule {}
