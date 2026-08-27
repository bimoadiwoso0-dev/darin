import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { COPY_STATUS, COPY_CONDITION, ACQUISITION_SOURCE, type CopyStatus } from '@darin/shared';
import { z } from 'zod';
import { booleanQuery } from '../../common/dto/query.schema';
import {
  ClientIp,
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '../../common/decorators/auth.decorators';
import { ZodValidationPipe, zodBody } from '../../common/pipes/zod-validation.pipe';
import { NumberingService } from '../numbering/numbering.service';
import { CopiesService } from './copies.service';

const statuses = Object.keys(COPY_STATUS) as [string, ...string[]];
const conditions = Object.keys(COPY_CONDITION) as [string, ...string[]];
const sources = Object.keys(ACQUISITION_SOURCE) as [string, ...string[]];

const CreateCopiesSchema = z.object({
  bookId: z.string().uuid(),
  count: z.number().int().min(1, 'حداقل یک نسخه.').max(500, 'حداکثر ۵۰۰ نسخه در یک درخواست.'),
  locationId: z.string().uuid().nullable().optional(),
  positionCode: z.string().max(20).nullable().optional(),
  accessionNumbers: z.array(z.string().max(60)).max(500).optional(),
  barcodes: z.array(z.string().max(60)).max(500).optional(),
  assetNumbers: z.array(z.string().max(60)).max(500).optional(),
  libraryCodes: z.array(z.string().max(60)).max(500).optional(),
  condition: z.enum(conditions).optional(),
  isLoanable: z.boolean().optional(),
  isReference: z.boolean().optional(),
  acquisitionSource: z.enum(sources).optional(),
  acquiredAt: z.coerce.date().nullable().optional(),
  donorId: z.string().uuid().nullable().optional(),
  donorName: z.string().max(200).nullable().optional(),
  supplier: z.string().max(200).nullable().optional(),
  purchasePrice: z.number().min(0).max(1e12).nullable().optional(),
  internalNote: z.string().max(4000).nullable().optional(),
});

const UpdateCopySchema = z.object({
  accessionNumber: z.string().max(60).optional(),
  barcode: z.string().max(60).optional(),
  libraryCode: z.string().max(60).nullable().optional(),
  assetNumber: z.string().max(60).nullable().optional(),
  condition: z.enum(conditions).optional(),
  isLoanable: z.boolean().optional(),
  isReference: z.boolean().optional(),
  positionCode: z.string().max(20).nullable().optional(),
  acquisitionSource: z.enum(sources).optional(),
  acquiredAt: z.coerce.date().nullable().optional(),
  donorId: z.string().uuid().nullable().optional(),
  supplier: z.string().max(200).nullable().optional(),
  purchasePrice: z.number().min(0).max(1e12).nullable().optional(),
  currentValue: z.number().min(0).max(1e12).nullable().optional(),
  internalNote: z.string().max(4000).nullable().optional(),
});

const CopyListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  bookId: z.string().uuid().optional(),
  locationId: z.string().uuid().optional(),
  locationSubtree: booleanQuery,
  // وضعیت‌ها به‌صورت `status=AVAILABLE&status=ON_LOAN` یا `status=AVAILABLE,ON_LOAN`
  status: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(',')).filter(Boolean))
    .pipe(z.array(z.enum(statuses)))
    .optional(),
  condition: z.enum(conditions).optional(),
  acquisitionSource: z.enum(sources).optional(),
  donorId: z.string().uuid().optional(),
  q: z.string().max(120).optional(),
  overdueOnly: booleanQuery,
  sort: z.enum(['accessionNumber', 'createdAt', 'status']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  includeDeleted: booleanQuery,
});

const MoveCopiesSchema = z.object({
  copyIds: z.array(z.string().uuid()).min(1, 'حداقل یک نسخه انتخاب کنید.').max(2000),
  toLocationId: z.string().uuid(),
  positionCode: z.string().max(20).nullable().optional(),
  reason: z.string().max(300).optional(),
});

@ApiTags('نسخه‌های فیزیکی')
@Controller('copies')
export class CopiesController {
  constructor(
    private readonly copies: CopiesService,
    private readonly numbering: NumberingService,
  ) {}

  @Get()
  @RequirePermissions('copies.view')
  @ApiOperation({ summary: 'فهرست نسخه‌ها با فیلتر' })
  list(@Query(new ZodValidationPipe(CopyListQuerySchema)) query: z.infer<typeof CopyListQuerySchema>) {
    return this.copies.list(query as never);
  }

  /**
   * جستجو با بارکد — پرکاربردترین Endpoint سیستم.
   * روی مسیر جدا از `:id` است تا با ParseUUIDPipe تداخل نکند.
   */
  @Get('by-barcode/:barcode')
  @RequirePermissions('copies.view')
  @ApiOperation({ summary: 'یافتن نسخه با بارکد، شماره ثبت یا کد کتابخانه' })
  byBarcode(@Param('barcode') barcode: string) {
    return this.copies.findByBarcode(barcode);
  }

  @Get('by-qr/:token')
  @RequirePermissions('copies.view')
  @ApiOperation({ summary: 'یافتن نسخه با توکن QR' })
  byQr(@Param('token', ParseUUIDPipe) token: string) {
    return this.copies.findByQrToken(token);
  }

  /** پیش‌نمایش شماره بعدی — فرم ثبت نسخه آن را نمایش می‌دهد (بدون مصرف شماره). */
  @Get('next-numbers')
  @RequirePermissions('copies.create')
  @ApiOperation({ summary: 'پیش‌نمایش شماره‌های بعدی' })
  async nextNumbers() {
    const [accession, barcode, libraryCode, asset] = await Promise.all([
      this.numbering.preview('accession'),
      this.numbering.preview('barcode'),
      this.numbering.preview('library_code'),
      this.numbering.preview('asset'),
    ]);
    return { accession, barcode, libraryCode, asset };
  }

  /** بررسی آزاد بودن شماره‌ای که کاربر دستی وارد کرده (قانون ۸). */
  @Get('check-number')
  @RequirePermissions('copies.create')
  @ApiOperation({ summary: 'بررسی تکراری نبودن شماره واردشده' })
  checkNumber(
    @Query('target') target: 'BARCODE' | 'ACCESSION' | 'ASSET' | 'LIBRARY_CODE',
    @Query('value') value: string,
    @CurrentUser('branchId') branchId: string | null,
    @Query('excludeCopyId') excludeCopyId?: string,
  ) {
    return this.numbering.checkAvailability(target, value, branchId ?? '', excludeCopyId);
  }

  @Get(':id')
  @RequirePermissions('copies.view')
  @ApiOperation({ summary: 'جزئیات نسخه با تاریخچه امانت و جابه‌جایی' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.copies.findOne(id);
  }

  @Post()
  @RequirePermissions('copies.create')
  @ApiOperation({ summary: 'ثبت یک یا چند نسخه فیزیکی' })
  create(
    @Body(zodBody(CreateCopiesSchema)) body: z.infer<typeof CreateCopiesSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.copies.createMany(body as never, user, ip);
  }

  @Patch(':id')
  @RequirePermissions('copies.edit')
  @ApiOperation({ summary: 'ویرایش نسخه' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(UpdateCopySchema)) body: z.infer<typeof UpdateCopySchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.copies.update(id, body as never, user, ip);
  }

  @Post(':id/status')
  @RequirePermissions('copies.change_status')
  @ApiOperation({ summary: 'تغییر وضعیت نسخه' })
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(z.object({ status: z.enum(statuses), reason: z.string().max(300).optional() })))
    body: { status: string; reason?: string },
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.copies.changeStatus(id, body.status as CopyStatus, body.reason, user, ip);
  }

  @Post('move')
  @RequirePermissions('copies.move')
  @ApiOperation({ summary: 'جابه‌جایی نسخه‌ها به مکان جدید' })
  move(
    @Body(zodBody(MoveCopiesSchema)) body: z.infer<typeof MoveCopiesSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.copies.move(
      body.copyIds, body.toLocationId, body.positionCode ?? null, body.reason, user, ip,
    );
  }

  @Post('bulk-status')
  @RequirePermissions('copies.change_status')
  @ApiOperation({ summary: 'تغییر گروهی وضعیت نسخه‌ها' })
  bulkStatus(
    @Body(zodBody(z.object({
      copyIds: z.array(z.string().uuid()).min(1).max(2000),
      status: z.enum(statuses),
    })))
    body: { copyIds: string[]; status: string },
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.copies.bulkChangeStatus(body.copyIds, body.status as CopyStatus, user, ip);
  }

  @Delete(':id')
  @RequirePermissions('copies.delete')
  @ApiOperation({ summary: 'حذف (بایگانی) نسخه' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.copies.remove(id, user, ip);
  }
}
