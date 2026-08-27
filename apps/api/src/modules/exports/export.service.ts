import { Injectable, Logger } from '@nestjs/common';
import { toPersianDigits } from '@darin/shared';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import type { ReportDefinition } from '../reports/reports.service';

export type ExportFormat = 'xlsx' | 'csv';

export interface ExportColumn {
  key: string;
  label: string;
  type?: 'number' | 'date' | 'money' | 'text';
}

/**
 * خروجی Excel و CSV (قوانین ۳۷، ۹۹).
 *
 * ── چرا Streaming ────────────────────────────────────────────────────────
 * ساخت فایل Excel از ۱۰۰٬۰۰۰ ردیف در حافظه، چند صد مگابایت RAM می‌گیرد و
 * سرور کتابخانه را از پا در می‌آورد. `ExcelJS` حالت
 * `WorkbookWriter` دارد که ردیف‌ها را مستقیم روی جریان پاسخ می‌نویسد و
 * حافظه ثابت می‌ماند — مستقل از تعداد ردیف‌ها (قانون ۹۹).
 *
 * ── نکته فارسی ───────────────────────────────────────────────────────────
 * Excel فایل CSV بدون BOM را با کدگذاری محلی باز می‌کند و متن فارسی به
 * هم می‌ریزد. بنابراین به هر CSV یک `BOM` UTF-8 اضافه می‌شود.
 * برگه Excel هم `views.rightToLeft = true` می‌گیرد.
 */
@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  /**
   * نوشتن مستقیم خروجی روی پاسخ HTTP.
   *
   * `fetchPage` یک تابع صفحه‌خوان است: سرویس گزارش، داده را دسته‌دسته
   * برمی‌گرداند تا هرگز کل نتیجه در حافظه جمع نشود.
   */
  async streamToResponse(
    res: Response,
    options: {
      format: ExportFormat;
      fileName: string;
      title: string;
      columns: ExportColumn[];
      fetchPage: (offset: number, limit: number) => Promise<Record<string, unknown>[]>;
      /** فرادادهٔ بالای برگه: نام کتابخانه، بازه گزارش، تاریخ تولید */
      metadata?: Array<[string, string]>;
      pageSize?: number;
      maxRows?: number;
    },
  ): Promise<void> {
    const pageSize = options.pageSize ?? 1000;
    const maxRows = options.maxRows ?? 200_000;

    // نام فایل فارسی باید طبق RFC 5987 کدگذاری شود وگرنه مرورگر آن را
    // به هم می‌ریزد یا هدر را رد می‌کند.
    const asciiName = options.fileName.replace(/[^\x20-\x7E]/g, '_');
    const encodedName = encodeURIComponent(options.fileName);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName}.${options.format}"; filename*=UTF-8''${encodedName}.${options.format}`,
    );

    if (options.format === 'csv') {
      await this.streamCsv(res, options, pageSize, maxRows);
    } else {
      await this.streamXlsx(res, options, pageSize, maxRows);
    }
  }

  private async streamCsv(
    res: Response,
    options: Parameters<ExportService['streamToResponse']>[1],
    pageSize: number,
    maxRows: number,
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    // BOM — بدون آن Excel فارسی را خراب نمایش می‌دهد
    res.write('﻿');
    res.write(options.columns.map((c) => csvCell(c.label)).join(',') + '\r\n');

    let offset = 0;
    let written = 0;
    for (;;) {
      const rows = await options.fetchPage(offset, pageSize);
      if (rows.length === 0) break;

      for (const row of rows) {
        const line = options.columns
          .map((c) => csvCell(formatValue(row[c.key], c.type)))
          .join(',');
        // اگر بافر پر شد، منتظر تخلیه می‌مانیم — جلوگیری از رشد نامحدود حافظه
        if (!res.write(line + '\r\n')) {
          await new Promise<void>((resolve) => res.once('drain', resolve));
        }
        written++;
      }

      offset += rows.length;
      if (rows.length < pageSize || written >= maxRows) break;
    }

    this.logger.log(`خروجی CSV «${options.title}» با ${written} ردیف تولید شد`);
    res.end();
  }

  private async streamXlsx(
    res: Response,
    options: Parameters<ExportService['streamToResponse']>[1],
    pageSize: number,
    maxRows: number,
  ): Promise<void> {
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );

    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: res,
      useStyles: true,
      useSharedStrings: false, // حافظه کمتر در ازای فایل کمی بزرگ‌تر
    });
    workbook.creator = 'Darin LMS';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(options.title.slice(0, 30), {
      views: [{ rightToLeft: true, state: 'frozen', ySplit: options.metadata ? 4 : 1 }],
    });

    // ── سربرگ فراداده ────────────────────────────────────────────────────
    if (options.metadata?.length) {
      const titleRow = sheet.addRow([options.title]);
      titleRow.font = { bold: true, size: 14 };
      sheet.mergeCells(1, 1, 1, Math.max(2, options.columns.length));

      const metaRow = sheet.addRow(
        options.metadata.map(([label, value]) => `${label}: ${value}`),
      );
      metaRow.font = { size: 10, color: { argb: 'FF666666' } };
      sheet.addRow([]);
    }

    const headerRow = sheet.addRow(options.columns.map((c) => c.label));
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });
    headerRow.commit();

    sheet.columns = options.columns.map((c) => ({
      key: c.key,
      width: c.type === 'date' ? 14 : c.type === 'number' ? 12 : 26,
    }));

    let offset = 0;
    let written = 0;
    for (;;) {
      const rows = await options.fetchPage(offset, pageSize);
      if (rows.length === 0) break;

      for (const row of rows) {
        const excelRow = sheet.addRow(
          options.columns.map((c) => formatValue(row[c.key], c.type)),
        );
        // `commit()` ردیف را روی جریان می‌نویسد و از حافظه آزاد می‌کند
        excelRow.commit();
        written++;
      }

      offset += rows.length;
      if (rows.length < pageSize || written >= maxRows) break;
    }

    sheet.commit();
    await workbook.commit();
    this.logger.log(`خروجی Excel «${options.title}» با ${written} ردیف تولید شد`);
  }

  /** ساخت فراداده متعارف سربرگ گزارش‌ها. */
  static buildMetadata(
    libraryName: string,
    range?: { from?: Date; to?: Date },
  ): Array<[string, string]> {
    const meta: Array<[string, string]> = [
      ['کتابخانه', libraryName],
      ['تاریخ تولید', new Date().toLocaleDateString('fa-IR')],
    ];
    if (range?.from || range?.to) {
      const from = range.from?.toLocaleDateString('fa-IR') ?? '—';
      const to = range.to?.toLocaleDateString('fa-IR') ?? '—';
      meta.push(['بازه گزارش', `${from} تا ${to}`]);
    }
    return meta;
  }

  /** ستون‌های یک گزارش را به فرمت خروجی تبدیل می‌کند. */
  static columnsFrom(definition: ReportDefinition): ExportColumn[] {
    return definition.columns;
  }
}

/** قالب‌بندی مقدار برای خروجی. */
function formatValue(value: unknown, type?: ExportColumn['type']): string | number | Date {
  if (value === null || value === undefined) return '';

  if (type === 'date') {
    const date = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(date.getTime())) return '';
    // تاریخ شمسی به‌صورت متن — Excel تقویم شمسی ندارد و اگر Date بدهیم،
    // کاربر ایرانی تاریخ میلادی می‌بیند که برایش بی‌معناست.
    return toPersianDigits(
      new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
        year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(date),
    );
  }

  if (type === 'money' || type === 'number') {
    const num = Number(value);
    return Number.isFinite(num) ? num : '';
  }

  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.join('، ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * فرار دادن یک سلول CSV.
 *
 * علاوه بر قواعد استاندارد CSV، مقادیری که با `=`, `+`, `-`, `@` شروع
 * می‌شوند با یک نقل‌قول پیشوند می‌گیرند. بدون این کار، Excel آنها را
 * فرمول تلقی می‌کند و یک مقدار مثل `=cmd|...` به تزریق فرمول (CSV
 * Injection) تبدیل می‌شود — یک آسیب‌پذیری واقعی در خروجی گزارش‌ها.
 */
function csvCell(value: string | number | Date): string {
  const text = value instanceof Date ? value.toISOString() : String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}
