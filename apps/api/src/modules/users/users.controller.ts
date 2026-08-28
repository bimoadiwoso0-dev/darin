import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { booleanQuery } from '../../common/dto/query.schema';
import {
  ClientIp,
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '../../common/decorators/auth.decorators';
import { ZodValidationPipe, zodBody } from '../../common/pipes/zod-validation.pipe';
import { UsersService } from './users.service';

/** همان قاعده رمزی که در راه‌اندازی اولیه اعمال می‌شود — یک جا تعریف، دو جا استفاده. */
const passwordSchema = z
  .string()
  .min(10, 'رمز عبور باید حداقل ۱۰ نویسه باشد.')
  .max(200)
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), {
    message: 'رمز عبور باید شامل حرف و عدد باشد.',
  });

const UserListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  q: z.string().max(120).optional(),
  roleId: z.string().uuid().optional(),
  isActive: booleanQuery,
  includeDeleted: booleanQuery,
});

const CreateUserSchema = z.object({
  username: z
    .string()
    .min(3, 'نام کاربری باید حداقل ۳ نویسه باشد.')
    .max(60)
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      'نام کاربری فقط می‌تواند شامل حروف انگلیسی، عدد، نقطه، خط تیره و زیرخط باشد.',
    ),
  fullName: z.string().min(2, 'نام و نام خانوادگی الزامی است.').max(160),
  email: z.string().email('ایمیل معتبر نیست.').max(160).nullable().optional().or(z.literal('')),
  phone: z.string().max(40).nullable().optional(),
  password: passwordSchema,
  isActive: z.boolean().optional(),
  mustChangePassword: z.boolean().optional(),
  branchId: z.string().uuid().nullable().optional(),
  roleIds: z.array(z.string().uuid()).max(20).optional(),
});

/** ویرایش، رمز عبور را شامل نمی‌شود؛ برای آن مسیر جداگانه‌ای هست. */
const UpdateUserSchema = CreateUserSchema.omit({ password: true }).partial();

const RoleBodySchema = z.object({
  key: z
    .string()
    .min(2, 'کلید نقش الزامی است.')
    .max(60)
    .regex(/^[A-Za-z0-9_]+$/, 'کلید نقش فقط می‌تواند شامل حروف انگلیسی، عدد و زیرخط باشد.'),
  name: z.string().min(2, 'نام نقش الزامی است.').max(120),
  description: z.string().max(1000).nullable().optional(),
  permissionKeys: z.array(z.string().max(80)).max(200),
});

@ApiTags('کاربران')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users.view')
  @ApiOperation({ summary: 'فهرست کاربران سامانه' })
  list(
    @Query(new ZodValidationPipe(UserListQuerySchema)) query: z.infer<typeof UserListQuerySchema>,
  ) {
    return this.users.list(query);
  }

  @Get(':id')
  @RequirePermissions('users.view')
  @ApiOperation({ summary: 'جزئیات کاربر و نشست‌های بازش' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.findOne(id);
  }

  @Post()
  @RequirePermissions('users.manage')
  @ApiOperation({ summary: 'ساخت کاربر جدید' })
  create(
    @Body(zodBody(CreateUserSchema)) body: z.infer<typeof CreateUserSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.users.create({ ...body, email: body.email || null }, user, ip);
  }

  @Patch(':id')
  @RequirePermissions('users.manage')
  @ApiOperation({ summary: 'ویرایش کاربر و نقش‌هایش' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(UpdateUserSchema)) body: z.infer<typeof UpdateUserSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.users.update(
      id,
      { ...body, email: body.email === '' ? null : body.email },
      user,
      ip,
    );
  }

  /**
   * تعیین رمز جدید توسط مدیر.
   * رمز فعلی پرسیده نمی‌شود — مدیر آن را نمی‌داند و نباید بداند. کاربر
   * موظف به تغییر رمز در اولین ورود می‌شود و نشست‌های بازش بسته می‌شوند.
   */
  @Post(':id/reset-password')
  @RequirePermissions('users.manage')
  @ApiOperation({ summary: 'تعیین رمز عبور جدید برای کاربر' })
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(z.object({ password: passwordSchema }))) body: { password: string },
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    await this.users.resetPassword(id, body.password, user, ip);
    return { ok: true };
  }

  @Post(':id/unlock')
  @RequirePermissions('users.manage')
  @ApiOperation({ summary: 'باز کردن قفل حساب پس از تلاش‌های ناموفق' })
  unlock(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.users.unlock(id, user, ip);
  }

  @Post(':id/revoke-sessions')
  @RequirePermissions('users.manage')
  @ApiOperation({ summary: 'خروج اجباری کاربر از همه دستگاه‌ها' })
  revokeSessions(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.users.revokeSessions(id, user, ip);
  }

  @Delete(':id')
  @RequirePermissions('users.manage')
  @ApiOperation({ summary: 'حذف (بایگانی) کاربر' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    await this.users.remove(id, user, ip);
    return { ok: true };
  }
}

@ApiTags('نقش‌ها و دسترسی‌ها')
@Controller('roles')
export class RolesController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('roles.manage')
  @ApiOperation({ summary: 'فهرست نقش‌ها با مجوزهایشان' })
  list() {
    return this.users.listRoles();
  }

  /** فهرست کامل مجوزها — برای ساخت ماتریس دسترسی. */
  @Get('permissions')
  @RequirePermissions('roles.manage')
  @ApiOperation({ summary: 'همه مجوزهای سیستم، گروه‌بندی‌شده' })
  permissions() {
    return this.users.listPermissions();
  }

  @Post()
  @RequirePermissions('roles.manage')
  @ApiOperation({ summary: 'ساخت نقش سفارشی' })
  create(
    @Body(zodBody(RoleBodySchema)) body: z.infer<typeof RoleBodySchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.users.createRole(body, user, ip);
  }

  @Patch(':id')
  @RequirePermissions('roles.manage')
  @ApiOperation({ summary: 'ویرایش نقش و مجوزهایش' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(RoleBodySchema.omit({ key: true }).partial()))
    body: Partial<Omit<z.infer<typeof RoleBodySchema>, 'key'>>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.users.updateRole(id, body, user, ip);
  }

  @Delete(':id')
  @RequirePermissions('roles.manage')
  @ApiOperation({ summary: 'حذف نقش سفارشی' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    await this.users.removeRole(id, user, ip);
    return { ok: true };
  }
}
