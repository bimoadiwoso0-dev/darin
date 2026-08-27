import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import {
  ClientIp, CurrentUser, RequirePermissions, type AuthenticatedUser,
} from '../../common/decorators/auth.decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { BackupService } from './backup.service';

@ApiTags('پشتیبان‌گیری')
@Controller('backups')
export class BackupController {
  constructor(private readonly backup: BackupService) {}

  @Get()
  @RequirePermissions('backup.manage')
  @ApiOperation({ summary: 'فهرست نسخه‌های پشتیبان' })
  list() {
    return this.backup.list();
  }

  @Post()
  @RequirePermissions('backup.manage')
  @ApiOperation({ summary: 'ایجاد نسخه پشتیبان جدید' })
  create(@CurrentUser() user: AuthenticatedUser, @ClientIp() ip: string) {
    return this.backup.create('MANUAL', user, ip);
  }

  @Get(':id/download')
  @RequirePermissions('backup.manage')
  @ApiOperation({ summary: 'دانلود فایل پشتیبان' })
  async download(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const { path, fileName } = await this.backup.getFilePath(id);
    res.download(path, fileName);
  }

  /**
   * بازیابی — خطرناک‌ترین عملیات سیستم.
   * نیازمند تأیید متنی صریح؛ پیش از اجرا یک پشتیبان ایمنی گرفته می‌شود.
   */
  @Post(':id/restore')
  @RequirePermissions('backup.manage')
  @ApiOperation({ summary: 'بازیابی از نسخه پشتیبان (بازنویسی کامل داده)' })
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zodBody(z.object({ confirmation: z.string() })))
    body: { confirmation: string },
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.backup.restore(id, body.confirmation, user, ip);
  }

  @Delete(':id')
  @RequirePermissions('backup.manage')
  @ApiOperation({ summary: 'حذف نسخه پشتیبان' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.backup.remove(id, user, ip);
  }
}
