import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FINE_TYPE, LOAN_STATUS, PAYMENT_METHOD, type FineType } from '@darin/shared';
import { z } from 'zod';
import { booleanQuery } from '../../common/dto/query.schema';
import {
  ClientIp,
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '../../common/decorators/auth.decorators';
import { ZodValidationPipe, zodBody } from '../../common/pipes/zod-validation.pipe';
import { FinesService } from './fines.service';
import { LoanPolicyService } from './loan-policy.service';
import { LoansService } from './loans.service';
import { ReservationsService } from './reservations.service';

const loanStatuses = Object.keys(LOAN_STATUS) as [string, ...string[]];
const fineTypes = Object.keys(FINE_TYPE) as [string, ...string[]];
const paymentMethods = Object.keys(PAYMENT_METHOD) as [string, ...string[]];

const CheckoutSchema = z
  .object({
    memberId: z.string().uuid('عضو انتخاب نشده است.'),
    barcodes: z.array(z.string().min(1).max(60)).max(50).optional().default([]),
    copyIds: z.array(z.string().uuid()).max(50).optional(),
    loanDays: z.number().int().min(1).max(365).optional(),
    note: z.string().max(1000).optional(),
    override: z.boolean().optional(),
  })
  .refine((d) => (d.barcodes?.length ?? 0) + (d.copyIds?.length ?? 0) > 0, {
    path: ['barcodes'],
    message: 'حداقل یک کتاب برای امانت انتخاب کنید.',
  });

const ReturnSchema = z.object({
  barcode: z.string().min(1, 'بارکد را وارد یا اسکن کنید.').max(60),
  condition: z.enum(['GOOD', 'DAMAGED']).optional(),
  note: z.string().max(1000).optional(),
});

const LoanListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  memberId: z.string().uuid().optional(),
  copyId: z.string().uuid().optional(),
  bookId: z.string().uuid().optional(),
  status: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(',')).filter(Boolean))
    .pipe(z.array(z.enum(loanStatuses)))
    .optional(),
  overdueOnly: booleanQuery,
  dueBefore: z.coerce.date().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().max(120).optional(),
  sort: z.enum(['loanedAt', 'dueAt', 'returnedAt']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

@ApiTags('امانت')
@Controller('loans')
export class LoansController {
  constructor(
    private readonly loans: LoansService,
    private readonly policy: LoanPolicyService,
  ) {}

  @Get()
  @RequirePermissions('loans.view')
  @ApiOperation({ summary: 'فهرست امانت‌ها با فیلتر' })
  list(@Query(new ZodValidationPipe(LoanListQuerySchema)) query: z.infer<typeof LoanListQuerySchema>) {
    return this.loans.list(query as never);
  }

  /** بررسی صلاحیت عضو پیش از اسکن کتاب — UI هشدارها را زودتر نشان می‌دهد. */
  @Get('eligibility/:memberId')
  @RequirePermissions('loans.create')
  @ApiOperation({ summary: 'بررسی صلاحیت عضو برای امانت' })
  async eligibility(
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Query('items') items?: string,
  ) {
    const policy = await this.policy.forMember(memberId);
    const violations = await this.policy.checkMemberEligibility(
      memberId,
      items ? Number(items) : 1,
      policy,
    );
    return {
      policy,
      violations,
      canProceed: violations.length === 0,
      canOverride: violations.length > 0 && violations.every((v) => v.overridable),
    };
  }

  @Get(':id')
  @RequirePermissions('loans.view')
  @ApiOperation({ summary: 'جزئیات یک امانت' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.loans.findOne(id);
  }

  @Post('checkout')
  @RequirePermissions('loans.create')
  @ApiOperation({ summary: 'ثبت امانت (یک یا چند کتاب)' })
  checkout(
    @Body(zodBody(CheckoutSchema)) body: z.infer<typeof CheckoutSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.loans.checkout(body, user, ip);
  }

  /** بازگشت با یک اسکن — سریع‌ترین مسیر (قانون ۹۰). */
  @Post('return')
  @RequirePermissions('loans.return')
  @ApiOperation({ summary: 'ثبت بازگشت با بارکد' })
  returnByBarcode(
    @Body(zodBody(ReturnSchema)) body: z.infer<typeof ReturnSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.loans.returnByBarcode(
      body.barcode,
      { condition: body.condition, note: body.note },
      user,
      ip,
    );
  }

  @Post(':id/return')
  @RequirePermissions('loans.return')
  @ApiOperation({ summary: 'ثبت بازگشت یک امانت مشخص' })
  returnLoan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(ReturnSchema.omit({ barcode: true })))
    body: { condition?: 'GOOD' | 'DAMAGED'; note?: string },
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.loans.returnLoan(id, body, user, ip);
  }

  @Post(':id/renew')
  @RequirePermissions('loans.renew')
  @ApiOperation({ summary: 'تمدید امانت' })
  renew(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(z.object({
      days: z.number().int().min(1).max(365).optional(),
      override: z.boolean().optional(),
    })))
    body: { days?: number; override?: boolean },
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.loans.renew(id, body, user, ip);
  }
}

@ApiTags('رزرو')
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Get()
  @RequirePermissions('reservations.view')
  @ApiOperation({ summary: 'فهرست رزروها' })
  list(
    @Query(new ZodValidationPipe(z.object({
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(200).optional(),
      bookId: z.string().uuid().optional(),
      memberId: z.string().uuid().optional(),
      readyOnly: booleanQuery,
      status: z
        .union([z.string(), z.array(z.string())])
        .transform((v) => (Array.isArray(v) ? v : v.split(',')).filter(Boolean))
        .pipe(z.array(z.enum(['PENDING', 'READY', 'FULFILLED', 'CANCELLED', 'EXPIRED'])))
        .optional(),
    })))
    query: Record<string, unknown>,
  ) {
    return this.reservations.list(query);
  }

  @Get('queue/:bookId')
  @RequirePermissions('reservations.view')
  @ApiOperation({ summary: 'صف انتظار یک عنوان' })
  queue(@Param('bookId', ParseUUIDPipe) bookId: string) {
    return this.reservations.queueForBook(bookId);
  }

  @Get(':id')
  @RequirePermissions('reservations.view')
  @ApiOperation({ summary: 'جزئیات رزرو' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.reservations.findOne(id);
  }

  @Post()
  @RequirePermissions('reservations.manage')
  @ApiOperation({ summary: 'ثبت رزرو جدید' })
  create(
    @Body(zodBody(z.object({
      bookId: z.string().uuid(),
      memberId: z.string().uuid(),
      note: z.string().max(1000).optional(),
      priority: z.number().int().min(0).max(10).optional(),
    })))
    body: { bookId: string; memberId: string; note?: string; priority?: number },
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.reservations.create(body, user, ip);
  }

  @Post(':id/cancel')
  @RequirePermissions('reservations.manage')
  @ApiOperation({ summary: 'لغو رزرو' })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(z.object({ reason: z.string().max(300).optional() })))
    body: { reason?: string },
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.reservations.cancel(id, body.reason, user, ip);
  }
}

@ApiTags('جریمه')
@Controller('fines')
export class FinesController {
  constructor(private readonly fines: FinesService) {}

  @Get()
  @RequirePermissions('fines.view')
  @ApiOperation({ summary: 'فهرست جریمه‌ها با جمع کل' })
  list(
    @Query(new ZodValidationPipe(z.object({
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(200).optional(),
      memberId: z.string().uuid().optional(),
      loanId: z.string().uuid().optional(),
      type: z.enum(fineTypes).optional(),
      unpaidOnly: booleanQuery,
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    })))
    query: Record<string, unknown>,
  ) {
    return this.fines.list(query);
  }

  @Get('member/:memberId/summary')
  @RequirePermissions('fines.view')
  @ApiOperation({ summary: 'خلاصه مالی یک عضو' })
  memberSummary(@Param('memberId', ParseUUIDPipe) memberId: string) {
    return this.fines.memberSummary(memberId);
  }

  @Get(':id')
  @RequirePermissions('fines.view')
  @ApiOperation({ summary: 'جزئیات جریمه و پرداخت‌ها' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.fines.findOne(id);
  }

  @Post()
  @RequirePermissions('fines.create')
  @ApiOperation({ summary: 'ثبت جریمه دستی' })
  create(
    @Body(zodBody(z.object({
      memberId: z.string().uuid(),
      loanId: z.string().uuid().nullable().optional(),
      type: z.enum(fineTypes),
      amount: z.number().positive('مبلغ باید بزرگ‌تر از صفر باشد.').max(1e12),
      reason: z.string().min(1, 'علت جریمه را بنویسید.').max(400),
      note: z.string().max(2000).nullable().optional(),
      dueAt: z.coerce.date().nullable().optional(),
    })))
    body: Record<string, unknown>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.fines.create({ ...body, type: body['type'] as FineType } as never, user, ip);
  }

  @Post(':id/pay')
  @RequirePermissions('fines.collect')
  @ApiOperation({ summary: 'ثبت پرداخت جریمه' })
  pay(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(z.object({
      amount: z.number().positive('مبلغ باید بزرگ‌تر از صفر باشد.').max(1e12),
      method: z.enum(paymentMethods),
      reference: z.string().max(120).optional(),
      note: z.string().max(1000).optional(),
    })))
    body: { amount: number; method: string; reference?: string; note?: string },
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.fines.pay(id, body as never, user, ip);
  }

  @Post(':id/waive')
  @RequirePermissions('fines.waive')
  @ApiOperation({ summary: 'بخشش جریمه (نیازمند ثبت دلیل)' })
  waive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(z.object({ reason: z.string().min(3, 'دلیل بخشش را بنویسید.').max(400) })))
    body: { reason: string },
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.fines.waive(id, body.reason, user, ip);
  }

  @Post('member/:memberId/settle-all')
  @RequirePermissions('fines.collect')
  @ApiOperation({ summary: 'تسویه یکجای تمام بدهی عضو' })
  settleAll(
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body(zodBody(z.object({ method: z.enum(paymentMethods) })))
    body: { method: string },
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.fines.settleAllForMember(memberId, body.method as never, user, ip);
  }
}
