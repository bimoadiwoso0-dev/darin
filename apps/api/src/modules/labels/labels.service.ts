import { Injectable, Logger } from '@nestjs/common';
import { SETTING_KEYS, toPersianDigits } from '@darin/shared';
import { formatJalaliDate } from '../../common/utils/jalali-format';
import bwipjs from 'bwip-js';
import QRCode from 'qrcode';
import { ConfigService } from '@nestjs/config';
import { DomainError } from '../../common/errors/domain.error';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

export interface LabelTemplate {
  key: string;
  name: string;
  /** ابعاد به میلی‌متر */
  width: number;
  height: number;
  /** چه چیزهایی روی برچسب چاپ شود */
  fields: Array<'title' | 'author' | 'accession' | 'barcode' | 'qr' | 'shelfCode' | 'libraryName'>;
  fontSize: number;
  description: string;
}

export interface LabelData {
  copyId: string;
  accessionNumber: string;
  barcode: string;
  libraryCode: string | null;
  title: string;
  authors: string;
  shelfCode: string | null;
  /** تصویر بارکد به‌صورت Data URI */
  barcodeImage: string;
  qrImage: string | null;
  libraryName: string;
}

/**
 * تولید بارکد، QR و برچسب (قوانین ۱۱، ۱۲، ۸۳، ۸۴).
 *
 * ── چرا تصاویر سمت سرور تولید می‌شوند ────────────────────────────────────
 * چاپ برچسب باید در هر مرورگر و هر چاپگری یکسان باشد. تولید سمت کلاینت
 * (canvas) در چاپگرهای حرارتی برچسب‌زن نتیجه‌های متفاوتی می‌دهد. تصویر
 * PNG با ابعاد مشخص، در همه‌جا یکسان چاپ می‌شود.
 *
 * ── امنیت QR ─────────────────────────────────────────────────────────────
 * QR کتاب حاوی `qrToken` است، نه شناسه داخلی رکورد. کسی که QR را اسکن
 * می‌کند نمی‌تواند از روی آن شناسه‌های دیگر را حدس بزند (قانون ۸۴).
 */
@Injectable()
export class LabelsService {
  private readonly logger = new Logger(LabelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly config: ConfigService,
  ) {}

  static readonly TEMPLATES: LabelTemplate[] = [
    {
      key: 'standard-50x30',
      name: 'استاندارد ۵۰×۳۰ میلی‌متر',
      width: 50, height: 30,
      fields: ['accession', 'barcode', 'shelfCode'],
      fontSize: 8,
      description: 'برچسب متعارف عطف کتاب — شماره ثبت، بارکد و کد قفسه',
    },
    {
      key: 'detailed-70x40',
      name: 'تفصیلی ۷۰×۴۰ میلی‌متر',
      width: 70, height: 40,
      fields: ['title', 'author', 'accession', 'barcode', 'shelfCode'],
      fontSize: 8,
      description: 'شامل عنوان و نویسنده — مناسب برچسب داخل جلد',
    },
    {
      key: 'spine-25x60',
      name: 'عطف ۲۵×۶۰ میلی‌متر',
      width: 25, height: 60,
      fields: ['shelfCode', 'accession'],
      fontSize: 9,
      description: 'برچسب باریک عطف — فقط کد قفسه و شماره ثبت',
    },
    {
      key: 'qr-40x40',
      name: 'کیوآر ۴۰×۴۰ میلی‌متر',
      width: 40, height: 40,
      fields: ['qr', 'accession'],
      fontSize: 8,
      description: 'برچسب QR برای اسکن با موبایل',
    },
    {
      key: 'full-100x50',
      name: 'کامل ۱۰۰×۵۰ میلی‌متر',
      width: 100, height: 50,
      fields: ['libraryName', 'title', 'author', 'accession', 'barcode', 'qr', 'shelfCode'],
      fontSize: 9,
      description: 'همه اطلاعات — مناسب کتاب‌های مرجع و آرشیوی',
    },
  ];

  listTemplates(): LabelTemplate[] {
    return LabelsService.TEMPLATES;
  }

  getTemplate(key: string): LabelTemplate {
    const template = LabelsService.TEMPLATES.find((t) => t.key === key);
    if (!template) throw DomainError.notFound(`قالب برچسب «${key}»`);
    return template;
  }

  /**
   * آماده‌سازی داده برچسب برای چند نسخه (قانون ۱۲).
   * چاپ گروهی: کتابدار ۵۰ کتاب را انتخاب می‌کند و همه برچسب‌ها یکجا تولید می‌شوند.
   */
  async buildLabels(copyIds: string[], templateKey: string): Promise<{
    template: LabelTemplate;
    labels: LabelData[];
  }> {
    const template = this.getTemplate(templateKey);

    if (copyIds.length === 0) {
      throw DomainError.validation({ copyIds: ['حداقل یک نسخه انتخاب کنید.'] });
    }
    if (copyIds.length > 500) {
      throw DomainError.validation({
        copyIds: ['حداکثر ۵۰۰ برچسب در یک درخواست قابل تولید است.'],
      });
    }

    const copies = await this.prisma.bookCopy.findMany({
      where: { id: { in: copyIds }, deletedAt: null },
      select: {
        id: true, accessionNumber: true, barcode: true, libraryCode: true, qrToken: true,
        location: { select: { fullCode: true } },
        book: {
          select: {
            title: true, volumeTitle: true,
            contributors: {
              where: { role: { in: ['AUTHOR', 'CO_AUTHOR'] } },
              orderBy: { position: 'asc' },
              take: 2,
              select: { person: { select: { fullName: true } } },
            },
          },
        },
      },
    });

    if (copies.length === 0) throw DomainError.notFound('نسخه');

    const libraryName = this.settings.get(SETTING_KEYS.LIBRARY_NAME);
    const needsQr = template.fields.includes('qr');
    const publicUrl = this.config.get<string>('PUBLIC_WEB_URL', '');

    const labels = await Promise.all(
      copies.map(async (copy) => ({
        copyId: copy.id,
        accessionNumber: copy.accessionNumber,
        barcode: copy.barcode,
        libraryCode: copy.libraryCode,
        title: copy.book.volumeTitle
          ? `${copy.book.title} — ${copy.book.volumeTitle}`
          : copy.book.title,
        authors: copy.book.contributors.map((c) => c.person.fullName).join('، '),
        shelfCode: copy.location?.fullCode ?? null,
        barcodeImage: await this.renderBarcode(copy.barcode),
        qrImage: needsQr ? await this.renderQr(`${publicUrl}/scan/copy/${copy.qrToken}`) : null,
        libraryName,
      })),
    );

    // ترتیب خروجی با ترتیب انتخاب کاربر یکسان می‌ماند
    const order = new Map(copyIds.map((id, index) => [id, index]));
    labels.sort((a, b) => (order.get(a.copyId) ?? 0) - (order.get(b.copyId) ?? 0));

    return { template, labels };
  }

  /** برچسب QR قفسه (قانون ۸۳). */
  async buildShelfLabel(locationId: string) {
    const location = await this.prisma.location.findFirst({
      where: { id: locationId, deletedAt: null },
      select: { id: true, name: true, fullCode: true, kind: true, qrToken: true, capacity: true },
    });
    if (!location) throw DomainError.notFound('مکان');

    const publicUrl = this.config.get<string>('PUBLIC_WEB_URL', '');
    const [copyCount, qrImage] = await Promise.all([
      this.prisma.bookCopy.count({ where: { locationId, deletedAt: null } }),
      this.renderQr(`${publicUrl}/scan/shelf/${location.qrToken}`),
    ]);

    return {
      ...location,
      copyCount,
      qrImage,
      libraryName: this.settings.get(SETTING_KEYS.LIBRARY_NAME),
    };
  }

  /** کارت عضویت با بارکد و QR (قانون ۱۶). */
  async buildMemberCard(memberId: string) {
    const member = await this.prisma.member.findFirst({
      where: { id: memberId, deletedAt: null },
      select: {
        id: true, memberCode: true, firstName: true, lastName: true, photoId: true,
        qrToken: true, joinedAt: true, expiresAt: true, status: true,
        membershipType: { select: { name: true } },
      },
    });
    if (!member) throw DomainError.notFound('عضو');

    const publicUrl = this.config.get<string>('PUBLIC_WEB_URL', '');
    const [barcodeImage, qrImage] = await Promise.all([
      // کد عضویت الفبا-عددی است، پس Code128 (نه EAN-13)
      this.renderBarcode(member.memberCode, 'code128'),
      this.renderQr(`${publicUrl}/scan/member/${member.qrToken}`),
    ]);

    return {
      ...member,
      fullName: `${member.firstName} ${member.lastName}`,
      barcodeImage,
      qrImage,
      libraryName: this.settings.get(SETTING_KEYS.LIBRARY_NAME),
      expiresAtFa: member.expiresAt
        ? toPersianDigits(formatJalaliDate(member.expiresAt, ''))
        : null,
    };
  }

  /**
   * تولید تصویر بارکد به‌صورت Data URI.
   *
   * نوع بارکد خودکار انتخاب می‌شود: بارکدهای ۱۳ رقمی که با رقم کنترل
   * معتبر ساخته شده‌اند EAN-13 هستند (اسکنرهای فروشگاهی هم می‌خوانندشان)،
   * بقیه Code128 که هر متنی را می‌پذیرد.
   */
  async renderBarcode(value: string, force?: 'ean13' | 'code128'): Promise<string> {
    const type = force ?? (/^\d{13}$/.test(value) && isValidEan13(value) ? 'ean13' : 'code128');
    try {
      const png = await bwipjs.toBuffer({
        bcid: type,
        text: value,
        scale: 3,
        height: 10,
        includetext: true,
        textxalign: 'center',
        textsize: 8,
      });
      return `data:image/png;base64,${png.toString('base64')}`;
    } catch (err) {
      this.logger.warn({ err, value, type }, 'تولید بارکد ناموفق بود؛ به Code128 برگردانده شد');
      // اگر EAN-13 به هر دلیلی رد شد، Code128 همیشه کار می‌کند
      const png = await bwipjs.toBuffer({
        bcid: 'code128', text: value, scale: 3, height: 10, includetext: true, textsize: 8,
      });
      return `data:image/png;base64,${png.toString('base64')}`;
    }
  }

  /** تولید تصویر QR به‌صورت Data URI. */
  async renderQr(value: string): Promise<string> {
    return QRCode.toDataURL(value, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 200,
      color: { dark: '#000000', light: '#FFFFFF' },
    });
  }
}

/** بررسی درستی رقم کنترل EAN-13. */
function isValidEan13(value: string): boolean {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(value[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(value[12]);
}
