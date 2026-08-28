import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  ClientIp, CurrentUser, RequirePermissions, type AuthenticatedUser,
} from '../../common/decorators/auth.decorators';
import { ZodValidationPipe, zodBody } from '../../common/pipes/zod-validation.pipe';
import {
  MarkAllSchema, NotificationListSchema, type NotificationListQuery,
} from './dto/notification.dto';
import { NotificationsService } from './notifications.service';

/**
 * یادآوری‌های کتابدار.
 *
 * مجوز `loans.view` است، نه مجوز تازه: همه یادآوری‌های امروز درباره امانت
 * هستند و هر کسی که امانت‌ها را می‌بیند باید فهرست پیگیری را هم ببیند.
 */
@ApiTags('یادآوری‌ها')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermissions('loans.view')
  @ApiOperation({ summary: 'فهرست یادآوری‌ها' })
  list(@Query(new ZodValidationPipe(NotificationListSchema)) query: NotificationListQuery) {
    return this.notifications.list(query);
  }

  @Get('summary')
  @RequirePermissions('loans.view')
  @ApiOperation({ summary: 'شمارش یادآوری‌های انجام‌نشده' })
  summary() {
    return this.notifications.summary();
  }

  @Post(':id/handled')
  @HttpCode(200)
  @RequirePermissions('loans.view')
  @ApiOperation({ summary: 'علامت زدن یادآوری به‌عنوان انجام‌شده' })
  handled(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.notifications.markHandled(id, user, ip);
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  @RequirePermissions('loans.view')
  @ApiOperation({ summary: 'انصراف از یادآوری' })
  dismiss(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.notifications.dismiss(id, user, ip);
  }

  @Post('handle-all')
  @HttpCode(200)
  @RequirePermissions('loans.view')
  @ApiOperation({ summary: 'علامت زدن گروهی یادآوری‌های انجام‌نشده' })
  handleAll(
    @Body(zodBody(MarkAllSchema)) body: z.infer<typeof MarkAllSchema>,
    @CurrentUser() user: AuthenticatedUser,
    @ClientIp() ip: string,
  ) {
    return this.notifications.markAllHandled(body.type, user, ip);
  }
}
