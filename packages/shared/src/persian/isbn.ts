import { normalizeDigits } from './normalize.js';

/** حذف خط‌تیره/فاصله و یکسان‌سازی ارقام. حرف X پایانی ISBN-10 حفظ می‌شود. */
export function cleanIsbn(raw: string | null | undefined): string {
  if (!raw) return '';
  return normalizeDigits(raw).replace(/[^0-9Xx]/g, '').toUpperCase();
}

export function isValidIsbn10(isbn: string): boolean {
  if (!/^[0-9]{9}[0-9X]$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (10 - i) * Number(isbn[i]);
  const check = isbn[9] === 'X' ? 10 : Number(isbn[9]);
  return (sum + check) % 11 === 0;
}

export function isValidIsbn13(isbn: string): boolean {
  if (!/^[0-9]{13}$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(isbn[12]);
}

export function isValidIsbn(raw: string): boolean {
  const isbn = cleanIsbn(raw);
  return isbn.length === 10 ? isValidIsbn10(isbn) : isValidIsbn13(isbn);
}

/** ISBN-10 را به ISBN-13 تبدیل می‌کند تا همه رکوردها یک کلید یکسان برای تطبیق داشته باشند. */
export function isbn10To13(isbn10: string): string | null {
  const isbn = cleanIsbn(isbn10);
  if (!isValidIsbn10(isbn)) return null;
  const body = `978${isbn.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

/** شکل متعارف (ISBN-13) برای ذخیره در `Book.isbn13` و تشخیص تکراری. */
export function toCanonicalIsbn13(raw: string | null | undefined): string | null {
  const isbn = cleanIsbn(raw);
  if (!isbn) return null;
  if (isbn.length === 13) return isValidIsbn13(isbn) ? isbn : null;
  if (isbn.length === 10) return isbn10To13(isbn);
  return null;
}

/** نمایش با خط‌تیره: 978-600-1234-56-7 (گروه‌بندی تقریبی و صرفاً نمایشی). */
export function formatIsbn(isbn13: string): string {
  const s = cleanIsbn(isbn13);
  if (s.length !== 13) return s;
  return `${s.slice(0, 3)}-${s.slice(3, 6)}-${s.slice(6, 10)}-${s.slice(10, 12)}-${s.slice(12)}`;
}

/** رقم کنترل EAN-13 — برای تولید بارکد داخلی کتابخانه. */
export function ean13CheckDigit(twelveDigits: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(twelveDigits[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}
