import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SETTING_KEYS } from '@darin/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { RequirePermissions } from '../../common/decorators/auth.decorators';
import { booleanQuery } from '../../common/dto/query.schema';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ExportService } from '../exports/export.service';
import { SettingsService } from '../settings/settings.service';
import { DashboardService } from './dashboard.service';
import { ReportsService } from './reports.service';

const ReportQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  locationId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  memberId: z.string().uuid().optional(),
});

const DashboardQuerySchema = z.object({
  range: z.enum(['today', 'week', 'month', 'year', 'custom']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  months: z.coerce.number().int().min(1).max(60).optional(),
});

@ApiTags('داشبورد')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @RequirePermissions('dashboard.view')
  @ApiOperation({ summary: 'آمار کلیدی داشبورد' })
  summary() {
    return this.dashboard.summary();
  }

  /**
   * تمام داده داشبورد در یک درخواست.
   * صفحه داشبورد ۸ بخش دارد؛ ۸ درخواست جدا یعنی ۸ رفت‌وبرگشت شبکه و
   * ۸ بار بررسی توکن. یک Endpoint با اجرای موازی سریع‌تر است.
   */
  @Get('overview')
  @RequirePermissions('dashboard.view')
  @ApiOperation({ summary: 'نمای کامل داشبورد در یک درخواست' })
  async overview(
    @Query(new ZodValidationPipe(DashboardQuerySchema)) query: z.infer<typeof DashboardQuerySchema>,
  ) {
    const range = DashboardService.resolveRange(query.range ?? 'month', query.from, query.to);
    const months = query.months ?? 12;

    const [
      summary, trend, growth, popularBooks, popularCategories,
      topMembers, topAuthors, activity, dueSoon,
    ] = await Promise.all([
      this.dashboard.summary(),
      this.dashboard.circulationTrend(months),
      this.dashboard.collectionGrowth(months),
      this.dashboard.popularBooks(range),
      this.dashboard.popularCategories(range),
      this.dashboard.topMembers(range),
      this.dashboard.topAuthors(range),
      this.dashboard.recentActivity(),
      this.dashboard.dueSoon(),
    ]);

    return {
      range: { from: range.from, to: range.to, label: range.label },
      summary, trend, growth, popularBooks, popularCategories,
      topMembers, topAuthors, activity, dueSoon,
    };
  }

  @Get('trend')
  @RequirePermissions('dashboard.view')
  @ApiOperation({ summary: 'روند ماهانه امانت و بازگشت' })
  trend(@Query('months') months?: string) {
    return this.dashboard.circulationTrend(months ? Number(months) : 12);
  }

  @Get('growth')
  @RequirePermissions('dashboard.view')
  @ApiOperation({ summary: 'روند رشد مجموعه' })
  growth(@Query('months') months?: string) {
    return this.dashboard.collectionGrowth(months ? Number(months) : 12);
  }

  @Get('activity')
  @RequirePermissions('dashboard.view')
  @ApiOperation({ summary: 'آخرین فعالیت‌ها' })
  activity(@Query('limit') limit?: string) {
    return this.dashboard.recentActivity(limit ? Number(limit) : 15);
  }
}

@ApiTags('گزارش‌ها')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly exports: ExportService,
    private readonly settings: SettingsService,
  ) {}

  @Get()
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'فهرست گزارش‌های موجود' })
  list() {
    return this.reports.listDefinitions();
  }

  @Get(':key')
  @RequirePermissions('reports.view')
  @ApiOperation({ summary: 'اجرای یک گزارش' })
  async run(
    @Param('key') key: string,
    @Query(new ZodValidationPipe(ReportQuerySchema)) query: z.infer<typeof ReportQuerySchema>,
  ) {
    const definition = this.reports.getDefinition(key);
    const result = await this.reports.run(key, query);
    return { definition, ...result };
  }

  /**
   * خروجی گزارش به Excel یا CSV (قوانین ۳۷، ۹۹).
   * پاسخ به‌صورت جریانی نوشته می‌شود تا حافظه سرور با ۱۰۰٬۰۰۰ ردیف پر نشود.
   */
  @Get(':key/export')
  @RequirePermissions('reports.export')
  @ApiOperation({ summary: 'خروجی Excel/CSV از گزارش' })
  async export(
    @Param('key') key: string,
    @Query(new ZodValidationPipe(ReportQuerySchema.extend({
      format: z.enum(['xlsx', 'csv']).optional(),
      persianDigits: booleanQuery,
    })))
    query: z.infer<typeof ReportQuerySchema> & { format?: 'xlsx' | 'csv' },
    @Res() res: Response,
  ): Promise<void> {
    const definition = this.reports.getDefinition(key);
    const format = query.format ?? 'xlsx';

    await this.exports.streamToResponse(res, {
      format,
      fileName: definition.title,
      title: definition.title,
      columns: ExportService.columnsFrom(definition),
      metadata: ExportService.buildMetadata(
        this.settings.get(SETTING_KEYS.LIBRARY_NAME),
        { from: query.from, to: query.to },
      ),
      // صفحه‌خوان: گزارش داده را دسته‌دسته می‌دهد تا در حافظه جمع نشود
      fetchPage: async (offset, limit) => {
        const page = await this.reports.run(key, {
          ...query,
          page: Math.floor(offset / limit) + 1,
          pageSize: limit,
        });
        return page.data;
      },
    });
  }
}
