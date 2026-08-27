import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermissions } from '../../common/decorators/auth.decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';
import { LabelsService } from './labels.service';

@ApiTags('برچسب و بارکد')
@Controller('labels')
export class LabelsController {
  constructor(private readonly labels: LabelsService) {}

  @Get('templates')
  @RequirePermissions('labels.print')
  @ApiOperation({ summary: 'قالب‌های برچسب موجود' })
  templates() {
    return this.labels.listTemplates();
  }

  /** تولید داده برچسب برای چاپ گروهی (قانون ۱۲). */
  @Post('books')
  @RequirePermissions('labels.print')
  @ApiOperation({ summary: 'تولید برچسب برای یک یا چند نسخه' })
  books(
    @Body(zodBody(z.object({
      copyIds: z.array(z.string().uuid()).min(1, 'حداقل یک نسخه انتخاب کنید.').max(500),
      template: z.string().min(1).max(60),
    })))
    body: { copyIds: string[]; template: string },
  ) {
    return this.labels.buildLabels(body.copyIds, body.template);
  }

  @Get('shelf/:locationId')
  @RequirePermissions('labels.print')
  @ApiOperation({ summary: 'برچسب QR قفسه' })
  shelf(@Param('locationId', ParseUUIDPipe) locationId: string) {
    return this.labels.buildShelfLabel(locationId);
  }

  @Get('member-card/:memberId')
  @RequirePermissions('members.card')
  @ApiOperation({ summary: 'کارت عضویت با بارکد و QR' })
  memberCard(@Param('memberId', ParseUUIDPipe) memberId: string) {
    return this.labels.buildMemberCard(memberId);
  }

  /** تولید تک بارکد — برای پیش‌نمایش در فرم‌ها. */
  @Post('barcode')
  @RequirePermissions('labels.print')
  @ApiOperation({ summary: 'تولید تصویر بارکد' })
  async barcode(
    @Body(zodBody(z.object({
      value: z.string().min(1).max(80),
      type: z.enum(['ean13', 'code128']).optional(),
    })))
    body: { value: string; type?: 'ean13' | 'code128' },
  ) {
    return { image: await this.labels.renderBarcode(body.value, body.type) };
  }

  @Post('qr')
  @RequirePermissions('labels.print')
  @ApiOperation({ summary: 'تولید تصویر QR' })
  async qr(
    @Body(zodBody(z.object({ value: z.string().min(1).max(500) })))
    body: { value: string },
  ) {
    return { image: await this.labels.renderQr(body.value) };
  }
}
