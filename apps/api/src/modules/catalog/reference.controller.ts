import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CONTRIBUTOR_ROLE } from '@darin/shared';
import { z } from 'zod';
import {
  ClientIp,
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '../../common/decorators/auth.decorators';
import { ZodValidationPipe, zodBody } from '../../common/pipes/zod-validation.pipe';
import { ReferenceService } from './reference.service';

const roles = Object.keys(CONTRIBUTOR_ROLE) as [string, ...string[]];

const PersonQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  q: z.string().max(200).optional(),
  role: z.enum(roles).optional(),
  sort: z.enum(['name', 'books']).optional(),
  order: z.enum(['asc', 'desc']).optional(),
});

const PersonBodySchema = z.object({
  fullName: z.string().min(2, 'نام پدیدآورنده الزامی است.').max(200),
  latinName: z.string().max(200).nullable().optional(),
  birthDate: z.coerce.date().nullable().optional(),
  deathDate: z.coerce.date().nullable().optional(),
  biography: z.string().max(20_000).nullable().optional(),
  website: z.string().url('نشانی وب معتبر نیست.').max(300).nullable().optional().or(z.literal('')),
  nationality: z.string().max(80).nullable().optional(),
  photoId: z.string().uuid().nullable().optional(),
  note: z.string().max(4000).nullable().optional(),
});

const PublisherBodySchema = z.object({
  name: z.string().min(1, 'نام ناشر الزامی است.').max(200),
  latinName: z.string().max(200).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email('ایمیل معتبر نیست.').max(160).nullable().optional().or(z.literal('')),
  website: z.string().max(300).nullable().optional(),
  logoId: z.string().uuid().nullable().optional(),
  note: z.string().max(4000).nullable().optional(),
});

const CategoryBodySchema = z.object({
  name: z.string().min(1, 'نام دسته الزامی است.').max(160),
  parentId: z.string().uuid().nullable().optional(),
  kind: z.enum(['SUBJECT', 'GENRE']).optional(),
  code: z.string().max(40).nullable().optional(),
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'کد رنگ معتبر نیست.').nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

const SeriesBodySchema = z.object({
  title: z.string().min(1, 'عنوان مجموعه الزامی است.').max(250),
  description: z.string().max(5000).nullable().optional(),
  totalPlanned: z.number().int().min(1).max(2000).nullable().optional(),
});

const DonorBodySchema = z.object({
  fullName: z.string().min(2, 'نام اهداکننده الزامی است.').max(200),
  phone: z.string().max(40).nullable().optional(),
  email: z.string().email('ایمیل معتبر نیست.').max(160).nullable().optional().or(z.literal('')),
  address: z.string().max(500).nullable().optional(),
  note: z.string().max(4000).nullable().optional(),
});

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  q: z.string().max(200).optional(),
});

// ═══════════════════════════════════════════════════════════════════════════

@ApiTags('پدیدآورندگان')
@Controller('persons')
export class PersonsController {
  constructor(private readonly reference: ReferenceService) {}

  @Get()
  @RequirePermissions('authors.view')
  @ApiOperation({ summary: 'فهرست پدیدآورندگان (با فیلتر نقش)' })
  list(@Query(new ZodValidationPipe(PersonQuerySchema)) query: z.infer<typeof PersonQuerySchema>) {
    return this.reference.listPersons(query as never);
  }

  @Get(':id')
  @RequirePermissions('authors.view')
  @ApiOperation({ summary: 'جزئیات پدیدآورنده و آثارش' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.reference.findPerson(id);
  }

  @Post()
  @RequirePermissions('authors.manage')
  @ApiOperation({ summary: 'ثبت پدیدآورنده جدید' })
  create(
    @Body(zodBody(PersonBodySchema)) body: z.infer<typeof PersonBodySchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.reference.createPerson({ ...body, website: body.website || null }, user, ip);
  }

  @Patch(':id')
  @RequirePermissions('authors.manage')
  @ApiOperation({ summary: 'ویرایش پدیدآورنده' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(PersonBodySchema.partial())) body: Partial<z.infer<typeof PersonBodySchema>>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.reference.updatePerson(id, body as never, user, ip);
  }

  /** ادغام دو رکورد تکراری — پس از Import اطلاعات قدیمی پرکاربرد است. */
  @Post(':id/merge')
  @RequirePermissions('authors.manage')
  @ApiOperation({ summary: 'ادغام پدیدآورنده تکراری در این رکورد' })
  merge(
    @Param('id', ParseUUIDPipe) keepId: string,
    @Body(zodBody(z.object({ mergeId: z.string().uuid() }))) body: { mergeId: string },
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.reference.mergePersons(keepId, body.mergeId, user, ip);
  }

  @Delete(':id')
  @RequirePermissions('authors.manage')
  @ApiOperation({ summary: 'حذف پدیدآورنده' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.reference.deletePerson(id, user, ip);
  }
}

@ApiTags('ناشران')
@Controller('publishers')
export class PublishersController {
  constructor(private readonly reference: ReferenceService) {}

  @Get()
  @RequirePermissions('publishers.view')
  @ApiOperation({ summary: 'فهرست ناشران' })
  list(@Query(new ZodValidationPipe(ListQuerySchema)) query: z.infer<typeof ListQuerySchema>) {
    return this.reference.listPublishers(query);
  }

  @Post()
  @RequirePermissions('publishers.manage')
  @ApiOperation({ summary: 'ثبت ناشر جدید' })
  create(
    @Body(zodBody(PublisherBodySchema)) body: z.infer<typeof PublisherBodySchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.reference.upsertPublisher(null, { ...body, email: body.email || null }, user, ip);
  }

  @Patch(':id')
  @RequirePermissions('publishers.manage')
  @ApiOperation({ summary: 'ویرایش ناشر' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(PublisherBodySchema)) body: z.infer<typeof PublisherBodySchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.reference.upsertPublisher(id, { ...body, email: body.email || null }, user, ip);
  }

  @Delete(':id')
  @RequirePermissions('publishers.manage')
  @ApiOperation({ summary: 'حذف ناشر' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.reference.deletePublisher(id, user, ip);
  }
}

@ApiTags('دسته‌بندی‌ها')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly reference: ReferenceService) {}

  @Get()
  @RequirePermissions('categories.view')
  @ApiOperation({ summary: 'درخت دسته‌بندی با شمارش کتاب' })
  tree(@Query('kind') kind?: 'SUBJECT' | 'GENRE') {
    return this.reference.categoryTree(kind);
  }

  @Post()
  @RequirePermissions('categories.manage')
  @ApiOperation({ summary: 'افزودن دسته' })
  create(
    @Body(zodBody(CategoryBodySchema)) body: z.infer<typeof CategoryBodySchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.reference.createCategory(body as never, user, ip);
  }

  @Patch(':id')
  @RequirePermissions('categories.manage')
  @ApiOperation({ summary: 'ویرایش دسته' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(CategoryBodySchema.partial())) body: Partial<z.infer<typeof CategoryBodySchema>>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.reference.updateCategory(id, body as never, user, ip);
  }

  @Post(':id/move')
  @RequirePermissions('categories.manage')
  @ApiOperation({ summary: 'جابه‌جایی دسته در درخت' })
  move(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(z.object({ parentId: z.string().uuid().nullable() })))
    body: { parentId: string | null },
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.reference.moveCategory(id, body.parentId, user, ip);
  }

  @Delete(':id')
  @RequirePermissions('categories.manage')
  @ApiOperation({ summary: 'حذف دسته' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.reference.deleteCategory(id, user, ip);
  }
}

@ApiTags('مجموعه‌ها')
@Controller('series')
export class SeriesController {
  constructor(private readonly reference: ReferenceService) {}

  @Get()
  @RequirePermissions('books.view')
  @ApiOperation({ summary: 'فهرست مجموعه‌ها' })
  list(@Query(new ZodValidationPipe(ListQuerySchema)) query: z.infer<typeof ListQuerySchema>) {
    return this.reference.listSeries(query);
  }

  @Get(':id')
  @RequirePermissions('books.view')
  @ApiOperation({ summary: 'جزئیات مجموعه و کتاب‌هایش' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.reference.findSeries(id);
  }

  @Post()
  @RequirePermissions('series.manage')
  @ApiOperation({ summary: 'ساخت مجموعه' })
  create(
    @Body(zodBody(SeriesBodySchema)) body: z.infer<typeof SeriesBodySchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.reference.upsertSeries(null, body, user, ip);
  }

  @Patch(':id')
  @RequirePermissions('series.manage')
  @ApiOperation({ summary: 'ویرایش مجموعه' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(SeriesBodySchema)) body: z.infer<typeof SeriesBodySchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.reference.upsertSeries(id, body, user, ip);
  }

  @Delete(':id')
  @RequirePermissions('series.manage')
  @ApiOperation({ summary: 'حذف مجموعه' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.reference.deleteSeries(id, user, ip);
  }
}

@ApiTags('برچسب‌ها و اهداکنندگان')
@Controller()
export class TagsAndDonorsController {
  constructor(private readonly reference: ReferenceService) {}

  @Get('tags')
  @RequirePermissions('books.view')
  @ApiOperation({ summary: 'فهرست برچسب‌ها' })
  tags(@Query('q') q?: string) {
    return this.reference.listTags(q);
  }

  @Get('donors')
  @RequirePermissions('copies.view')
  @ApiOperation({ summary: 'فهرست اهداکنندگان' })
  donors(@Query(new ZodValidationPipe(ListQuerySchema)) query: z.infer<typeof ListQuerySchema>) {
    return this.reference.listDonors(query);
  }

  @Post('donors')
  @RequirePermissions('copies.create')
  @ApiOperation({ summary: 'ثبت اهداکننده' })
  createDonor(
    @Body(zodBody(DonorBodySchema)) body: z.infer<typeof DonorBodySchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.reference.upsertDonor(null, { ...body, email: body.email || null }, user, ip);
  }

  @Patch('donors/:id')
  @RequirePermissions('copies.edit')
  @ApiOperation({ summary: 'ویرایش اهداکننده' })
  updateDonor(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(DonorBodySchema)) body: z.infer<typeof DonorBodySchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.reference.upsertDonor(id, { ...body, email: body.email || null }, user, ip);
  }
}
