import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { LOCATION_KIND, type LocationKind } from '@darin/shared';
import { z } from 'zod';
import {
  ClientIp,
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '../../common/decorators/auth.decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { AuditService } from '../audit/audit.service';
import { LocationsService } from './locations.service';

const kinds = Object.keys(LOCATION_KIND) as [string, ...string[]];

const CreateLocationSchema = z.object({
  parentId: z.string().uuid().nullable(),
  kind: z.enum(kinds),
  name: z.string().min(1, 'نام مکان الزامی است.').max(160),
  code: z
    .string()
    .min(1, 'کد مکان الزامی است.')
    .max(40)
    .regex(/^[A-Za-z0-9_]+$/, 'کد مکان فقط می‌تواند شامل حروف انگلیسی، عدد و زیرخط باشد.'),
  capacity: z.number().int().min(0).max(100_000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  note: z.string().max(2000).nullable().optional(),
});

const UpdateLocationSchema = CreateLocationSchema.pick({
  name: true, code: true, capacity: true, sortOrder: true, note: true,
}).partial();

@ApiTags('مکان‌ها و قفسه‌ها')
@Controller('locations')
export class LocationsController {
  constructor(
    private readonly locations: LocationsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('locations.view')
  @ApiOperation({ summary: 'درخت کامل مکان‌ها با شمارش کتاب' })
  tree(@Query('kinds') kinds?: string) {
    const filter = kinds ? (kinds.split(',') as LocationKind[]) : undefined;
    return this.locations.tree(undefined, filter);
  }

  @Get('flat')
  @RequirePermissions('locations.view')
  @ApiOperation({ summary: 'فهرست تخت مکان‌ها (برای کشوی انتخاب)' })
  flat(@Query('kinds') kinds?: string) {
    const filter = kinds ? (kinds.split(',') as LocationKind[]) : undefined;
    return this.locations.flatList(undefined, filter);
  }

  /** نقشه اشغال قفسه‌ها (قانون ۱۰). */
  @Get('occupancy')
  @RequirePermissions('locations.view')
  @ApiOperation({ summary: 'وضعیت پرشدگی قفسه‌ها' })
  occupancy(@Query('parentId') parentId?: string) {
    return this.locations.occupancy(parentId);
  }

  @Get('search')
  @RequirePermissions('locations.view')
  @ApiOperation({ summary: 'جستجوی مکان با نام یا کد' })
  search(@Query('q') q: string) {
    return this.locations.search(q ?? '');
  }

  @Get('by-qr/:token')
  @RequirePermissions('locations.view')
  @ApiOperation({ summary: 'باز کردن قفسه با اسکن QR' })
  byQr(@Param('token', ParseUUIDPipe) token: string) {
    return this.locations.findByQrToken(token);
  }

  @Get(':id')
  @RequirePermissions('locations.view')
  @ApiOperation({ summary: 'جزئیات یک مکان' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.locations.findOne(id);
  }

  @Post()
  @RequirePermissions('locations.manage')
  @ApiOperation({ summary: 'افزودن مکان (ساختمان، بخش، قفسه، طبقه)' })
  async create(
    @Body(zodBody(CreateLocationSchema)) body: z.infer<typeof CreateLocationSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    const created = await this.locations.create(
      { ...body, kind: body.kind as LocationKind, branchId: user.branchId ?? undefined },
      user.sub,
    );
    await this.audit.record({
      action: 'create', entityType: 'Location', entityId: created.id,
      entityLabel: `${created.name} (${created.fullCode})`, newData: body, user, ip,
    });
    return created;
  }

  @Patch(':id')
  @RequirePermissions('locations.manage')
  @ApiOperation({ summary: 'ویرایش مکان' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(UpdateLocationSchema)) body: z.infer<typeof UpdateLocationSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    const updated = await this.locations.update(id, body);
    await this.audit.record({
      action: 'update', entityType: 'Location', entityId: id,
      entityLabel: `${updated.name} (${updated.fullCode})`, newData: body, user, ip,
    });
    return updated;
  }

  @Post(':id/move')
  @RequirePermissions('locations.manage')
  @ApiOperation({ summary: 'جابه‌جایی مکان در درخت' })
  async move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(z.object({ parentId: z.string().uuid().nullable() })))
    body: { parentId: string | null },
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    const moved = await this.locations.move(id, body.parentId);
    await this.audit.record({
      action: 'move', entityType: 'Location', entityId: id,
      entityLabel: `${moved.name} → ${moved.fullCode}`, newData: body, user, ip,
    });
    return moved;
  }

  @Delete(':id')
  @RequirePermissions('locations.manage')
  @ApiOperation({ summary: 'حذف مکان (فقط اگر خالی باشد)' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    await this.locations.remove(id);
    await this.audit.record({
      action: 'delete', entityType: 'Location', entityId: id, user, ip,
    });
  }
}
