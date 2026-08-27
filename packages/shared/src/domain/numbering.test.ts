import { describe, expect, it } from 'vitest';
import { renderNumberPattern, validateNumberPattern } from './numbering.js';
import { ean13CheckDigit } from '../persian/isbn.js';

describe('renderNumberPattern', () => {
  it('توالی را با صفر پیشوند پر می‌کند', () => {
    expect(renderNumberPattern({ pattern: 'BK-{SEQ:6}', sequence: 1 })).toBe('BK-000001');
    expect(renderNumberPattern({ pattern: 'BK-{SEQ:6}', sequence: 12345 })).toBe('BK-012345');
  });

  it('سال شمسی را جایگذاری می‌کند', () => {
    expect(renderNumberPattern({ pattern: '{YEAR}-{SEQ:5}', sequence: 1, solarYear: 1405 }))
      .toBe('1405-00001');
  });

  it('پیشوند دلخواه را پشتیبانی می‌کند', () => {
    expect(renderNumberPattern({ pattern: 'A-{PREFIX}-{SEQ:3}', sequence: 25, prefix: '001' }))
      .toBe('A-001-025');
  });

  it('بارکد EAN-13 با رقم کنترل درست تولید می‌کند', () => {
    const barcode = renderNumberPattern({ pattern: '200{SEQ:9}{EAN}', sequence: 123 });
    expect(barcode).toHaveLength(13);
    expect(barcode.startsWith('200')).toBe(true);
    // رقم آخر باید دقیقاً رقم کنترل ۱۲ رقم قبل باشد
    expect(Number(barcode[12])).toBe(ean13CheckDigit(barcode.slice(0, 12)));
  });

  it('توالی‌های متوالی بارکدهای متمایز می‌سازند', () => {
    const a = renderNumberPattern({ pattern: '200{SEQ:9}{EAN}', sequence: 1 });
    const b = renderNumberPattern({ pattern: '200{SEQ:9}{EAN}', sequence: 2 });
    expect(a).not.toBe(b);
  });

  it('سال میلادی را جدا از شمسی جایگذاری می‌کند', () => {
    expect(renderNumberPattern({ pattern: '{GYEAR}/{SEQ:4}', sequence: 7, gregorianYear: 2026 }))
      .toBe('2026/0007');
  });
});

describe('validateNumberPattern', () => {
  it('الگوی بدون SEQ را رد می‌کند چون یکتایی تضمین نمی‌شود', () => {
    const r = validateNumberPattern('BK-{YEAR}');
    expect(r.valid).toBe(false);
    expect(r.error).toContain('SEQ');
  });

  it('متغیر ناشناخته را رد می‌کند', () => {
    expect(validateNumberPattern('{SEQ:5}-{FOO}').valid).toBe(false);
  });

  it('EAN غیرانتهایی را رد می‌کند', () => {
    expect(validateNumberPattern('{EAN}-{SEQ:9}').valid).toBe(false);
  });

  it('الگوی خالی را رد می‌کند', () => {
    expect(validateNumberPattern('   ').valid).toBe(false);
  });

  it('الگوهای معتبر را می‌پذیرد', () => {
    expect(validateNumberPattern('BK-{SEQ:6}').valid).toBe(true);
    expect(validateNumberPattern('200{SEQ:9}{EAN}').valid).toBe(true);
  });
});
