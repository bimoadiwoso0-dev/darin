import {
  Body, Controller, Get, Param, ParseUUIDPipe, Post, Query,
  UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  ClientIp, CurrentUser, RequirePermissions, type AuthenticatedUser,
} from '../../common/decorators/auth.decorators';
import { DomainError } from '../../common/errors/domain.error';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { ImportService } from './import.service';

@ApiTags('ورود اطلاعات')
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportService) {}

  @Get('fields')
  @RequirePermissions('imports.run')
  @ApiOperation({ summary: 'فیلدهای قابل نگاشت' })
  fields() {
    return ImportService.BOOK_FIELDS;
  }

  @Get()
  @RequirePermissions('imports.run')
  @ApiOperation({ summary: 'تاریخچه ورود اطلاعات' })
  list(@Query('limit') limit?: string) {
    return this.imports.listJobs(limit ? Number(limit) : 20);
  }

  @Get(':id')
  @RequirePermissions('imports.run')
  @ApiOperation({ summary: 'وضعیت یک کار ورود اطلاعات' })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.imports.getJob(id);
  }

  /** مرحله ۱: آپلود فایل و پیش‌نمایش سرستون‌ها. */
  @Post('upload')
  @RequirePermissions('imports.run')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 50 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'آپلود فایل Excel/CSV و پیش‌نمایش' })
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('type') type: 'BOOKS' | 'MEMBERS' | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw DomainError.validation({ file: ['فایلی انتخاب نشده است.'] });
    }
    return this.imports.createJob(file, type ?? 'BOOKS', user);
  }

  /** مرحله ۲: تعیین نگاشت ستون‌ها به فیلدها. */
  @Post(':id/mapping')
  @RequirePermissions('imports.run')
  @ApiOperation({ summary: 'ثبت نگاشت ستون‌ها' })
  mapping(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(z.object({ mapping: z.record(z.string(), z.string()) })))
    body: { mapping: Record<string, string> },
  ) {
    return this.imports.updateMapping(id, body.mapping);
  }

  /** مرحله ۳: اعتبارسنجی کامل بدون نوشتن در دیتابیس. */
  @Post(':id/validate')
  @RequirePermissions('imports.run')
  @ApiOperation({ summary: 'اعتبارسنجی فایل و گزارش خطاها' })
  validate(@Param('id', ParseUUIDPipe) id: string) {
    return this.imports.validate(id);
  }

  /** مرحله ۴: اجرای نهایی. */
  @Post(':id/execute')
  @RequirePermissions('imports.run')
  @ApiOperation({ summary: 'اجرای ورود اطلاعات' })
  execute(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(z.object({
      skipDuplicates: z.boolean().optional(),
      defaultLocationId: z.string().uuid().nullable().optional(),
    })))
    body: { skipDuplicates?: boolean; defaultLocationId?: string | null },
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.imports.execute(id, body, user, ip);
  }
}
