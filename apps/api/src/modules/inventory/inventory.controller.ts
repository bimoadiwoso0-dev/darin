import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  ClientIp,
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '../../common/decorators/auth.decorators';
import { ZodValidationPipe, zodBody } from '../../common/pipes/zod-validation.pipe';
import { InventoryService } from './inventory.service';

@ApiTags('شمارش موجودی')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @RequirePermissions('inventory.view')
  @ApiOperation({ summary: 'فهرست جلسات شمارش' })
  list(
    @Query(new ZodValidationPipe(z.object({
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(100).optional(),
      status: z.enum(['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
    })))
    query: Record<string, unknown>,
  ) {
    return this.inventory.list(query);
  }

  @Post()
  @RequirePermissions('inventory.manage')
  @ApiOperation({ summary: 'ایجاد جلسه شمارش جدید' })
  create(
    @Body(zodBody(z.object({
      name: z.string().min(1, 'نام جلسه شمارش الزامی است.').max(200),
      scopeLocationId: z.string().uuid().nullable().optional(),
      note: z.string().max(2000).optional(),
    })))
    body: { name: string; scopeLocationId?: string | null; note?: string },
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.inventory.createSession(body, user, ip);
  }

  @Get(':id')
  @RequirePermissions('inventory.view')
  @ApiOperation({ summary: 'پیشرفت زنده جلسه شمارش' })
  progress(@Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.progress(id);
  }

  @Get(':id/scans')
  @RequirePermissions('inventory.view')
  @ApiOperation({ summary: 'آخرین اسکن‌های ثبت‌شده' })
  scans(@Param('id', ParseUUIDPipe) id: string, @Query('limit') limit?: string) {
    return this.inventory.recentScans(id, limit ? Number(limit) : 20);
  }

  /** گزارش مغایرت — قلب ماژول شمارش (قانون ۴۰). */
  @Get(':id/report')
  @RequirePermissions('inventory.view')
  @ApiOperation({ summary: 'گزارش مغایرت: گم‌شده، جابه‌جا، اضافه' })
  report(@Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.discrepancyReport(id);
  }

  @Post(':id/start')
  @RequirePermissions('inventory.manage')
  @ApiOperation({ summary: 'شروع شمارش' })
  start(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.inventory.start(id, user, ip);
  }

  /** ثبت یک اسکن — در حلقه اسکن پشت سر هم صدا زده می‌شود. */
  @Post(':id/scan')
  @RequirePermissions('inventory.manage')
  @ApiOperation({ summary: 'ثبت اسکن یک بارکد' })
  scan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(z.object({ barcode: z.string().min(1, 'بارکد خالی است.').max(60) })))
    body: { barcode: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventory.scan(id, body.barcode, user);
  }

  @Post(':id/scan-batch')
  @RequirePermissions('inventory.manage')
  @ApiOperation({ summary: 'ثبت گروهی اسکن (برای دستگاه‌های آفلاین)' })
  scanBatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(z.object({ barcodes: z.array(z.string().min(1).max(60)).min(1).max(2000) })))
    body: { barcodes: string[] },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.inventory.scanBatch(id, body.barcodes, user);
  }

  @Post(':id/complete')
  @RequirePermissions('inventory.manage')
  @ApiOperation({ summary: 'بستن جلسه شمارش' })
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.inventory.complete(id, user, ip);
  }

  @Post(':id/cancel')
  @RequirePermissions('inventory.manage')
  @ApiOperation({ summary: 'لغو جلسه شمارش' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.inventory.cancel(id, user, ip);
  }

  /**
   * مفقود اعلام کردن نسخه‌های پیدانشده.
   * عمداً یک عمل جداگانه است، نه بخشی از بستن جلسه — چون تصمیمی است با
   * پیامد مالی و کاتالوگی که باید آگاهانه گرفته شود.
   */
  @Post(':id/mark-lost')
  @RequirePermissions('copies.change_status')
  @ApiOperation({ summary: 'مفقود اعلام کردن نسخه‌های یافت‌نشده' })
  markLost(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(z.object({ copyIds: z.array(z.string().uuid()).min(1).max(5000) })))
    body: { copyIds: string[] },
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.inventory.markMissingAsLost(id, body.copyIds, user, ip);
  }

  @Post(':id/apply-locations')
  @RequirePermissions('copies.move')
  @ApiOperation({ summary: 'اصلاح محل نسخه‌های جابه‌جاشده بر اساس شمارش' })
  applyLocations(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.inventory.applyMovedLocations(id, user, ip);
  }
}
