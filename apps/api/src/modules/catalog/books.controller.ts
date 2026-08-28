import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  ClientIp,
  CurrentUser,
  RequirePermissions,
  type AuthenticatedUser,
} from '../../common/decorators/auth.decorators';
import { ZodValidationPipe, zodBody } from '../../common/pipes/zod-validation.pipe';
import { BooksService, type BookInput } from './books.service';
import {
  BookListQuerySchema,
  BulkUpdateBooksSchema,
  CreateBookSchema,
  DuplicateCheckSchema,
  UpdateBookSchema,
} from './dto/book.dto';

@ApiTags('کتاب‌ها')
@Controller('books')
export class BooksController {
  constructor(private readonly books: BooksService) {}

  @Get()
  @RequirePermissions('books.view')
  @ApiOperation({ summary: 'فهرست کتاب‌ها با فیلتر و صفحه‌بندی' })
  list(@Query(new ZodValidationPipe(BookListQuerySchema)) query: z.infer<typeof BookListQuerySchema>) {
    return this.books.list(query);
  }

  /**
   * بررسی تکراری بودن — پیش از ثبت نهایی صدا زده می‌شود (قانون ۴۱).
   * روی مسیر جدا و با POST است چون عنوان می‌تواند طولانی باشد و در Query String نگنجد.
   */
  @Post('check-duplicate')
  // چیزی ساخته نمی‌شود؛ POST فقط برای جا دادن عنوان طولانی در بدنه است.
  // پیش‌فرض Nest برای POST کد ۲۰۱ است که اینجا معنای نادرستی می‌دهد.
  @HttpCode(200)
  @RequirePermissions('books.create')
  @ApiOperation({ summary: 'یافتن کتاب‌های مشابه پیش از ثبت' })
  checkDuplicate(
    @Body(zodBody(DuplicateCheckSchema)) body: z.infer<typeof DuplicateCheckSchema>,
  ) {
    return this.books.findDuplicates(body);
  }

  @Get(':id')
  @RequirePermissions('books.view')
  @ApiOperation({ summary: 'جزئیات کامل یک کتاب' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.books.findOne(id);
  }

  @Get(':id/related')
  @RequirePermissions('books.view')
  @ApiOperation({ summary: 'کتاب‌های مرتبط و پیشنهادی' })
  related(@Param('id', ParseUUIDPipe) id: string) {
    return this.books.related(id);
  }

  @Post()
  @RequirePermissions('books.create')
  @ApiOperation({ summary: 'ثبت کتاب جدید' })
  create(
    @Body(zodBody(CreateBookSchema)) body: z.infer<typeof CreateBookSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.books.create(body as BookInput, user, ip);
  }

  @Patch(':id')
  @RequirePermissions('books.edit')
  @ApiOperation({ summary: 'ویرایش کتاب' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(UpdateBookSchema)) body: z.infer<typeof UpdateBookSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.books.update(id, body as Partial<BookInput>, user, ip);
  }

  @Post('bulk-update')
  @RequirePermissions('books.bulk_edit')
  @ApiOperation({ summary: 'ویرایش گروهی کتاب‌ها' })
  bulkUpdate(
    @Body(zodBody(BulkUpdateBooksSchema)) body: z.infer<typeof BulkUpdateBooksSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.books.bulkUpdate(body.bookIds, body.changes, user, ip);
  }

  @Delete(':id')
  @RequirePermissions('books.delete')
  @ApiOperation({ summary: 'حذف (بایگانی) کتاب' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.books.remove(id, user, ip);
  }

  @Post(':id/restore')
  @RequirePermissions('books.delete')
  @ApiOperation({ summary: 'بازگرداندن کتاب حذف‌شده' })
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.books.restore(id, user, ip);
  }
}
