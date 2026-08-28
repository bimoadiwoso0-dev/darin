import * as React from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import {
  JALALI_MONTHS,
  JALALI_WEEKDAYS,
  gregorianToJalali,
  jalaliToGregorian,
  normalizeDigits,
  toPersianDigits,
} from '@darin/shared';
import { cn } from '@/components/ui';

/**
 * ورودی تاریخ شمسی (قانون ۶۸).
 *
 * ── چرا ورودی بومی مرورگر کافی نیست ─────────────────────────────────────
 * `<input type="date">` تاریخ میلادی می‌گیرد و در مرورگر فارسی هم
 * `mm/dd/yyyy` نشان می‌دهد. کتابدار ایرانی «۱۴۰۵/۰۳/۱۲» می‌داند، نه
 * «2026-06-02». ترجمه ذهنی هر بار، هم کند است هم خطاخیز.
 *
 * ── مرز تبدیل دقیقاً اینجاست (قانون ۶۸) ─────────────────────────────────
 * ورودی و تقویم کاملاً شمسی‌اند، اما مقدار خروجی این کامپوننت همیشه یک
 * رشته ISO میلادی است. هیچ تاریخ شمسی‌ای به سرور یا دیتابیس نمی‌رسد؛
 * تبدیل فقط در همین لایه نمایش انجام می‌شود.
 *
 * ── ساعت عمداً نیمروز است ────────────────────────────────────────────────
 * تاریخ بدون ساعت را نیمروز محلی می‌گیریم، نه نیمه‌شب. با نیمه‌شب، اختلاف
 * منطقه زمانی می‌تواند تاریخ را یک روز جابه‌جا کند؛ با نیمروز، حاشیه امن
 * ۱۲ ساعته در هر دو جهت داریم.
 */
export function JalaliDateInput({
  value, onChange, placeholder = 'روز / ماه / سال', disabled, invalid, id, allowClear = true,
}: {
  /** تاریخ به‌صورت ISO میلادی، یا خالی */
  value: string | null | undefined;
  /** مقدار جدید به‌صورت ISO میلادی، یا `null` هنگام پاک کردن */
  onChange: (isoDate: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  allowClear?: boolean;
}) {
  const selected = React.useMemo(() => parseIso(value), [value]);

  const [text, setText] = React.useState(() => (selected ? formatJalaliInput(selected) : ''));
  const [open, setOpen] = React.useState(false);
  const [viewYear, setViewYear] = React.useState(() => (selected ?? todayJalali()).year);
  const [viewMonth, setViewMonth] = React.useState(() => (selected ?? todayJalali()).month);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // همگام ماندن متن با مقدار بیرونی (مثلاً پاک شدن فیلتر)
  React.useEffect(() => {
    setText(selected ? formatJalaliInput(selected) : '');
    if (selected) { setViewYear(selected.year); setViewMonth(selected.month); }
  }, [selected]);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  /** پذیرش تایپ دستی: «۱۴۰۵/۳/۱۲»، «1405-03-12»، «14050312». */
  const commitText = (raw: string) => {
    const digits = normalizeDigits(raw).replace(/[^0-9]/g, '');
    if (digits.length === 0) { onChange(null); return; }
    if (digits.length !== 8) return; // ناقص — تا کامل نشود تغییری نمی‌دهیم

    const year = Number(digits.slice(0, 4));
    const month = Number(digits.slice(4, 6));
    const day = Number(digits.slice(6, 8));
    if (month < 1 || month > 12 || day < 1 || day > 31) return;
    if (day > jalaliMonthLength(year, month)) return;

    onChange(toIso(year, month, day));
  };

  const pick = (day: number) => {
    onChange(toIso(viewYear, viewMonth, day));
    setOpen(false);
  };

  const monthLength = jalaliMonthLength(viewYear, viewMonth);
  const firstWeekday = jalaliFirstWeekday(viewYear, viewMonth);
  const today = todayJalali();

  return (
    <div ref={containerRef} className="relative">
      <div className="relative flex items-center">
        <CalendarDays
          className="pointer-events-none absolute start-3 size-4 text-content-subtle"
          aria-hidden
        />
        <input
          id={id}
          type="text"
          inputMode="numeric"
          value={text}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            commitText(e.target.value);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'Enter') { e.preventDefault(); commitText(text); setOpen(false); }
          }}
          className={cn(
            'h-input w-full rounded border bg-surface ps-9 pe-9 text-sm text-content transition',
            'placeholder:text-content-subtle',
            'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25',
            'disabled:cursor-not-allowed disabled:bg-surface-sunken',
            invalid ? 'border-danger' : 'border-border',
          )}
        />
        {value && allowClear && !disabled ? (
          <button
            type="button"
            onClick={() => { onChange(null); setText(''); }}
            aria-label="پاک کردن تاریخ"
            className="absolute end-3 rounded p-0.5 text-content-subtle transition hover:text-danger"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>

      {open && !disabled ? (
        <div className="absolute inset-x-0 top-full z-50 mt-1 w-[17rem] rounded-lg border border-border bg-surface p-2 shadow-overlay animate-slide-up">
          {/* ── ناوبری ماه ─────────────────────────────────────────── */}
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1, viewYear, viewMonth, setViewYear, setViewMonth)}
              aria-label="ماه قبل"
              className="rounded p-1 text-content-muted transition hover:bg-surface-sunken"
            >
              <ChevronRight className="size-4" />
            </button>

            <div className="flex items-center gap-1">
              <select
                value={viewMonth}
                onChange={(e) => setViewMonth(Number(e.target.value))}
                aria-label="ماه"
                className="rounded border-0 bg-transparent px-1 py-0.5 text-sm font-medium text-content focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {JALALI_MONTHS.map((name, index) => (
                  <option key={name} value={index + 1}>{name}</option>
                ))}
              </select>
              <select
                value={viewYear}
                onChange={(e) => setViewYear(Number(e.target.value))}
                aria-label="سال"
                className="rounded border-0 bg-transparent px-1 py-0.5 text-sm font-medium text-content focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {yearRange(today.year).map((year) => (
                  <option key={year} value={year}>{toPersianDigits(year)}</option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={() => shiftMonth(1, viewYear, viewMonth, setViewYear, setViewMonth)}
              aria-label="ماه بعد"
              className="rounded p-1 text-content-muted transition hover:bg-surface-sunken"
            >
              <ChevronLeft className="size-4" />
            </button>
          </div>

          {/*
            سرستون روزهای هفته.

            هفته شمسی از شنبه شروع می‌شود، اما `JALALI_WEEKDAYS` با ترتیب
            `Date.getDay()` چیده شده و از یکشنبه آغاز می‌شود. بدون این
            چرخش، نام‌ها یک ستون نسبت به روزها جابه‌جا می‌افتند.
          */}
          <div className="grid grid-cols-7 gap-0.5 pb-1">
            {Array.from({ length: 7 }, (_, column) => {
              const name = JALALI_WEEKDAYS[(column + 6) % 7]!;
              return (
                <abbr
                  key={name}
                  title={name}
                  className="text-center text-2xs font-medium text-content-subtle no-underline"
                >
                  {name.slice(0, 1)}
                </abbr>
              );
            })}
          </div>

          {/* ── روزها ──────────────────────────────────────────────── */}
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: firstWeekday }, (_, i) => (
              <div key={`pad-${i}`} aria-hidden />
            ))}
            {Array.from({ length: monthLength }, (_, i) => {
              const day = i + 1;
              const isSelected =
                selected?.year === viewYear && selected.month === viewMonth && selected.day === day;
              const isToday =
                today.year === viewYear && today.month === viewMonth && today.day === day;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => pick(day)}
                  aria-pressed={isSelected}
                  className={cn(
                    'rounded py-1 text-xs transition',
                    isSelected
                      ? 'bg-primary font-medium text-primary-content'
                      : isToday
                        ? 'bg-primary-soft font-medium text-primary'
                        : 'text-content hover:bg-surface-sunken',
                  )}
                >
                  {toPersianDigits(day)}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex justify-between border-t border-border pt-2">
            <button
              type="button"
              onClick={() => { onChange(null); setText(''); setOpen(false); }}
              className="rounded px-2 py-1 text-xs text-content-muted transition hover:bg-surface-sunken"
            >
              پاک کردن
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(toIso(today.year, today.month, today.day));
                setViewYear(today.year);
                setViewMonth(today.month);
                setOpen(false);
              }}
              className="rounded px-2 py-1 text-xs text-primary transition hover:bg-primary-soft"
            >
              امروز
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface JalaliParts { year: number; month: number; day: number }

function parseIso(value: string | null | undefined): JalaliParts | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const [year, month, day] = gregorianToJalali(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
  );
  return { year, month, day };
}

/** تاریخ شمسی → رشته ISO میلادی، با ساعت نیمروز محلی. */
function toIso(year: number, month: number, day: number): string {
  const [gy, gm, gd] = jalaliToGregorian(year, month, day);
  return new Date(gy, gm - 1, gd, 12, 0, 0).toISOString();
}

function todayJalali(): JalaliParts {
  const now = new Date();
  const [year, month, day] = gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
  return { year, month, day };
}

function formatJalaliInput({ year, month, day }: JalaliParts): string {
  return toPersianDigits(
    `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`,
  );
}

/** طول ماه شمسی — ۶ ماه اول ۳۱ روز، ۵ ماه بعد ۳۰، اسفند ۲۹ یا ۳۰. */
function jalaliMonthLength(year: number, month: number): number {
  if (month <= 6) return 31;
  if (month <= 11) return 30;
  // اسفند: اگر ۳۰ اسفند وجود داشته باشد، سال کبیسه است
  const [gy, gm, gd] = jalaliToGregorian(year, 12, 30);
  const check = new Date(gy, gm - 1, gd);
  const [backYear, backMonth, backDay] = gregorianToJalali(
    check.getFullYear(),
    check.getMonth() + 1,
    check.getDate(),
  );
  return backYear === year && backMonth === 12 && backDay === 30 ? 30 : 29;
}

/**
 * شماره ستون اولین روز ماه در تقویم.
 * هفته شمسی از شنبه شروع می‌شود؛ `getDay()` شنبه را ۶ می‌دهد، پس
 * `(day + 1) % 7` آن را به ۰ می‌رساند.
 */
function jalaliFirstWeekday(year: number, month: number): number {
  const [gy, gm, gd] = jalaliToGregorian(year, month, 1);
  return (new Date(gy, gm - 1, gd).getDay() + 1) % 7;
}

function yearRange(currentYear: number): number[] {
  // از ۱۰۰ سال پیش تا ۱۰ سال آینده — تاریخ تولد اعضا و انقضای عضویت را پوشش می‌دهد
  return Array.from({ length: 111 }, (_, i) => currentYear + 10 - i);
}

function shiftMonth(
  delta: number,
  year: number,
  month: number,
  setYear: (y: number) => void,
  setMonth: (m: number) => void,
): void {
  const next = month + delta;
  if (next < 1) { setMonth(12); setYear(year - 1); }
  else if (next > 12) { setMonth(1); setYear(year + 1); }
  else setMonth(next);
}
