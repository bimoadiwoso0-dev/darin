import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { ClientIp, Public } from '../../common/decorators/auth.decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { SetupService } from './setup.service';

const CompleteSetupSchema = z.object({
  library: z.object({
    name: z.string().min(2, 'نام کتابخانه را وارد کنید.').max(200),
    address: z.string().max(500).optional(),
    phone: z.string().max(40).optional(),
    email: z.string().email('ایمیل معتبر نیست.').max(160).optional().or(z.literal('')),
    timezone: z.string().default('Asia/Tehran'),
    currency: z.string().default('IRT'),
  }),
  admin: z.object({
    username: z
      .string()
      .min(3, 'نام کاربری باید حداقل ۳ نویسه باشد.')
      .max(60)
      .regex(/^[a-zA-Z0-9._-]+$/, 'نام کاربری فقط می‌تواند شامل حروف انگلیسی، عدد، نقطه، خط تیره و زیرخط باشد.'),
    fullName: z.string().min(2, 'نام و نام خانوادگی را وارد کنید.').max(160),
    email: z.string().email('ایمیل معتبر نیست.').max(160).optional().or(z.literal('')),
    password: z
      .string()
      .min(10, 'رمز عبور مدیر باید حداقل ۱۰ نویسه باشد.')
      .max(200)
      .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), {
        message: 'رمز عبور باید شامل حرف و عدد باشد.',
      }),
  }),
  rules: z.object({
    maxItems: z.number().int().min(1).max(100).default(5),
    periodDays: z.number().int().min(1).max(365).default(14),
    maxRenewals: z.number().int().min(0).max(20).default(2),
    dailyFineAmount: z.number().min(0).max(10_000_000).default(5_000),
  }),
  createStarterLocations: z.boolean().default(true),
});

@ApiTags('راه‌اندازی اولیه')
@Controller('setup')
export class SetupController {
  constructor(private readonly setup: SetupService) {}

  @Public()
  @Get('status')
  @ApiOperation({ summary: 'وضعیت راه‌اندازی سامانه' })
  status() {
    return this.setup.getStatus();
  }

  @Public()
  @Post('complete')
  // این Endpoint فقط یک بار در عمر سامانه کار می‌کند، اما تا آن لحظه باز است؛
  // محدودیت نرخ سخت‌گیرانه جلوی تلاش خودکار برای ساخت مدیر را می‌گیرد.
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @ApiOperation({ summary: 'تکمیل راه‌اندازی و ساخت حساب مدیر ارشد' })
  complete(
    @Body(zodBody(CompleteSetupSchema)) body: z.infer<typeof CompleteSetupSchema>,
    @ClientIp() ip: string,
  ) {
    return this.setup.complete(
      {
        library: { ...body.library, email: body.library.email || undefined },
        admin: { ...body.admin, email: body.admin.email || undefined },
        rules: body.rules,
        createStarterLocations: body.createStarterLocations,
      },
      ip,
    );
  }
}
