import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { MEMBER_STATUS, type MemberStatus } from '@darin/shared';
import { z } from 'zod';
import { booleanQuery } from '../../common/dto/query.schema';
import {
  ClientIp,
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '../../common/decorators/auth.decorators';
import { ZodValidationPipe, zodBody } from '../../common/pipes/zod-validation.pipe';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MembersService } from './members.service';

const statuses = Object.keys(MEMBER_STATUS) as [string, ...string[]];

const MemberBodySchema = z.object({
  memberCode: z.string().max(40).optional(),
  firstName: z.string().min(1, 'نام الزامی است.').max(100),
  lastName: z.string().min(1, 'نام خانوادگی الزامی است.').max(120),
  nationalId: z.string().max(20).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  mobile: z.string().max(40).nullable().optional(),
  email: z.string().email('ایمیل معتبر نیست.').max(160).nullable().optional().or(z.literal('')),
  address: z.string().max(1000).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  birthDate: z.coerce.date().nullable().optional(),
  gender: z.enum(['MALE', 'FEMALE', 'UNSPECIFIED']).optional(),
  photoId: z.string().uuid().nullable().optional(),
  membershipTypeId: z.string().uuid().nullable().optional(),
  status: z.enum(statuses).optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  referrerName: z.string().max(200).nullable().optional(),
  emergencyContactName: z.string().max(200).nullable().optional(),
  emergencyContactPhone: z.string().max(40).nullable().optional(),
  note: z.string().max(4000).nullable().optional(),
});

const MemberListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  q: z.string().max(200).optional(),
  status: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(',')).filter(Boolean))
    .pipe(z.array(z.enum(statuses)))
    .optional(),
  membershipTypeId: z.string().uuid().optional(),
  hasOverdue: booleanQuery,
  hasUnpaidFines: booleanQuery,
  expiringWithinDays: z.coerce.number().int().min(0).max(365).optional(),
  sort: z.enum(['name', 'memberCode', 'joinedAt', 'expiresAt']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
  includeDeleted: booleanQuery,
});

@ApiTags('اعضا')
@Controller('members')
export class MembersController {
  constructor(
    private readonly members: MembersService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequirePermissions('members.view')
  @ApiOperation({ summary: 'فهرست اعضا با فیلتر' })
  list(@Query(new ZodValidationPipe(MemberListQuerySchema)) query: z.infer<typeof MemberListQuerySchema>) {
    return this.members.list(query as never);
  }

  /** جستجوی سریع برای میز امانت — با کد عضویت، نام یا موبایل. */
  @Get('search')
  @RequirePermissions('members.view')
  @ApiOperation({ summary: 'جستجوی سریع عضو' })
  search(@Query('q') q: string, @Query('limit') limit?: string) {
    return this.members.quickSearch(q ?? '', limit ? Number(limit) : 10);
  }

  @Get('membership-types')
  @RequirePermissions('members.view')
  @ApiOperation({ summary: 'انواع عضویت و قوانین هرکدام' })
  membershipTypes() {
    return this.prisma.membershipType.findMany({ orderBy: { name: 'asc' } });
  }

  @Get('by-qr/:token')
  @RequirePermissions('members.view')
  @ApiOperation({ summary: 'یافتن عضو با اسکن QR کارت عضویت' })
  byQr(@Param('token', ParseUUIDPipe) token: string) {
    return this.members.findByQrToken(token);
  }

  @Get(':id')
  @RequirePermissions('members.view')
  @ApiOperation({ summary: 'پروفایل کامل عضو' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.members.findOne(id);
  }

  @Get(':id/card')
  @RequirePermissions('members.card')
  @ApiOperation({ summary: 'اطلاعات چاپ کارت عضویت' })
  card(@Param('id', ParseUUIDPipe) id: string) {
    return this.members.cardData(id);
  }

  @Post()
  @RequirePermissions('members.create')
  @ApiOperation({ summary: 'ثبت عضو جدید' })
  create(
    @Body(zodBody(MemberBodySchema)) body: z.infer<typeof MemberBodySchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.members.create({ ...body, email: body.email || null } as never, user, ip);
  }

  @Patch(':id')
  @RequirePermissions('members.edit')
  @ApiOperation({ summary: 'ویرایش عضو' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(MemberBodySchema.partial())) body: Partial<z.infer<typeof MemberBodySchema>>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.members.update(id, body as never, user, ip);
  }

  @Post(':id/renew')
  @RequirePermissions('members.edit')
  @ApiOperation({ summary: 'تمدید عضویت' })
  renew(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(z.object({ months: z.number().int().min(1).max(120).optional() })))
    body: { months?: number },
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.members.renewMembership(id, body.months, user, ip);
  }

  @Post(':id/status')
  @RequirePermissions('members.edit')
  @ApiOperation({ summary: 'تغییر وضعیت عضویت' })
  changeStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(z.object({ status: z.enum(statuses) }))) body: { status: string },
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.members.update(id, { status: body.status as MemberStatus }, user, ip);
  }

  @Delete(':id')
  @RequirePermissions('members.delete')
  @ApiOperation({ summary: 'حذف (بایگانی) عضو' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.members.remove(id, user, ip);
  }
}
