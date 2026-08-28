import { LANGUAGES } from '../domain/enums.js';
import { persianWordsToDigits, persianWordsToNumber } from './numbers.js';
import { foldPersianLetters } from './normalize.js';

/**
 * تبدیل یک جمله دیکته‌شده به فیلدهای فرم ثبت کتاب.
 *
 * ── مسئله ───────────────────────────────────────────────────────────────
 * کتابدار کتاب را در یک دست دارد و با دست دیگر تایپ می‌کند. اگر بتواند
 * فقط بگوید «عنوان قلعه حیوانات، نویسنده جورج اورول، ناشر امیرکبیر، سال
 * هزار و سیصد و نود و نه»، کل رکورد در یک نفس ثبت می‌شود.
 *
 * ── چرا بر پایه کلیدواژه و نه مدل زبانی ─────────────────────────────────
 * تجزیه بر پایه کلیدواژه **قابل پیش‌بینی** است: کتابدار پس از دو بار
 * استفاده می‌داند چه بگوید تا چه شود، و نتیجه همیشه یکسان است. مدل زبانی
 * گاهی درست حدس می‌زند و گاهی نه، و کتابدار هرگز نمی‌فهمد چرا. برای
 * داده‌ای که سال‌ها در کاتالوگ می‌ماند، پیش‌بینی‌پذیری از هوشمندی مهم‌تر
 * است. ضمناً این تجزیه آفلاین و بدون هزینه کار می‌کند.
 *
 * ── قرارداد ─────────────────────────────────────────────────────────────
 * هر مقدار، تا کلیدواژه بعدی ادامه دارد. اگر هیچ کلیدواژه‌ای گفته نشود،
 * کل جمله «عنوان» در نظر گرفته می‌شود — چون رایج‌ترین حالت، گفتن فقط نام
 * کتاب است.
 */

export type DictationTextField =
  | 'title' | 'subtitle' | 'titleEn' | 'originalTitle'
  | 'publisherName' | 'publicationPlace'
  | 'summary' | 'keywords' | 'internalNote' | 'volumeTitle'
  | 'deweyCode';

export type DictationNumberField =
  | 'publicationYear' | 'pageCount' | 'edition' | 'volumeNumber' | 'totalVolumes';

export interface DictatedContributor {
  role: 'AUTHOR' | 'TRANSLATOR' | 'EDITOR' | 'COMPILER' | 'ILLUSTRATOR';
  fullName: string;
}

export interface DictatedBook {
  text: Partial<Record<DictationTextField, string>>;
  numbers: Partial<Record<DictationNumberField, number>>;
  isbn?: string;
  language?: string;
  contributors: DictatedContributor[];
  /** بخش‌هایی که به هیچ فیلدی نخوردند — به کاربر نشان داده می‌شود */
  unrecognized: string;
}

type Slot =
  | { kind: 'text'; field: DictationTextField }
  | { kind: 'number'; field: DictationNumberField }
  | { kind: 'isbn' }
  | { kind: 'language' }
  | { kind: 'contributor'; role: DictatedContributor['role'] };

/**
 * کلیدواژه‌ها. مترادف‌ها عمداً زیادند: کتابدارها یک اصطلاح واحد به کار
 * نمی‌برند و موتور تشخیص گفتار هم گاهی صورت دیگری از همان واژه را
 * برمی‌گرداند.
 */
/**
 * کلیدواژه‌ها.
 *
 * مترادف‌ها عمداً زیادند: کتابدارها یک اصطلاح واحد به کار نمی‌برند و موتور
 * تشخیص گفتار هم گاهی صورت دیگری از همان واژه را برمی‌گرداند.
 *
 * ── چرا بعضی کلیدواژه‌ها «قاطع» نیستند ──────────────────────────────────
 * «سال»، «جلد»، «چاپ» و «صفحه» واژه‌های معمولی زبان‌اند و در عنوان کتاب
 * فراوان می‌آیند: «صد سال تنهایی»، «سال بلوا»، «چهل نامه». اگر بی‌قید
 * کلیدواژه شمرده شوند، عنوان وسط جمله تکه‌تکه می‌شود و بدترین حالت رخ
 * می‌دهد: داده‌ای که کتابدار نگفته، در فیلدی که قصدش را نداشته.
 *
 * پس این دسته فقط وقتی کلیدواژه‌اند که یکی از دو نشانه را داشته باشند:
 * پیش از آنها جداکننده (ویرگول یا نقطه) گفته شده باشد، یا مقداری که
 * می‌گیرند واقعاً از همان جنس باشد (عدد برای «سال»، نام زبان برای «زبان»).
 * جزئیات در `isAcceptable`.
 */
const KEYWORDS: Array<[phrase: string, slot: Slot, strong: boolean]> = [
  ['عنوان اصلی', { kind: 'text', field: 'originalTitle' }, true],
  ['عنوان لاتین', { kind: 'text', field: 'titleEn' }, true],
  ['عنوان انگلیسی', { kind: 'text', field: 'titleEn' }, true],
  ['عنوان فرعی', { kind: 'text', field: 'subtitle' }, true],
  ['زیر عنوان', { kind: 'text', field: 'subtitle' }, true],
  ['زیرعنوان', { kind: 'text', field: 'subtitle' }, true],
  ['عنوان کتاب', { kind: 'text', field: 'title' }, true],
  ['نام کتاب', { kind: 'text', field: 'title' }, true],
  ['اسم کتاب', { kind: 'text', field: 'title' }, true],
  ['عنوان', { kind: 'text', field: 'title' }, true],

  ['عنوان جلد', { kind: 'text', field: 'volumeTitle' }, true],
  ['شماره جلد', { kind: 'number', field: 'volumeNumber' }, true],
  ['تعداد جلد', { kind: 'number', field: 'totalVolumes' }, true],
  ['جلد', { kind: 'number', field: 'volumeNumber' }, false],

  ['نویسنده همکار', { kind: 'contributor', role: 'AUTHOR' }, true],
  ['پدید آورنده', { kind: 'contributor', role: 'AUTHOR' }, true],
  ['پدیدآورنده', { kind: 'contributor', role: 'AUTHOR' }, true],
  ['نویسندگان', { kind: 'contributor', role: 'AUTHOR' }, true],
  ['نویسنده', { kind: 'contributor', role: 'AUTHOR' }, true],
  ['مولف', { kind: 'contributor', role: 'AUTHOR' }, true],
  ['تالیف', { kind: 'contributor', role: 'AUTHOR' }, false],
  ['مترجم', { kind: 'contributor', role: 'TRANSLATOR' }, true],
  ['ترجمه', { kind: 'contributor', role: 'TRANSLATOR' }, false],
  ['ویراستار', { kind: 'contributor', role: 'EDITOR' }, true],
  ['ویراستاری', { kind: 'contributor', role: 'EDITOR' }, true],
  ['گردآورنده', { kind: 'contributor', role: 'COMPILER' }, true],
  ['گرد آورنده', { kind: 'contributor', role: 'COMPILER' }, true],
  ['تصویرگر', { kind: 'contributor', role: 'ILLUSTRATOR' }, true],

  ['انتشارات', { kind: 'text', field: 'publisherName' }, true],
  ['ناشر', { kind: 'text', field: 'publisherName' }, true],
  ['نشر', { kind: 'text', field: 'publisherName' }, false],
  ['محل انتشار', { kind: 'text', field: 'publicationPlace' }, true],
  ['شهر انتشار', { kind: 'text', field: 'publicationPlace' }, true],

  ['سال انتشار', { kind: 'number', field: 'publicationYear' }, true],
  ['سال چاپ', { kind: 'number', field: 'publicationYear' }, true],
  ['تاریخ انتشار', { kind: 'number', field: 'publicationYear' }, true],
  ['سال', { kind: 'number', field: 'publicationYear' }, false],

  ['نوبت چاپ', { kind: 'number', field: 'edition' }, true],
  ['چاپ', { kind: 'number', field: 'edition' }, false],

  ['تعداد صفحات', { kind: 'number', field: 'pageCount' }, true],
  ['تعداد صفحه', { kind: 'number', field: 'pageCount' }, true],
  ['صفحات', { kind: 'number', field: 'pageCount' }, false],
  ['صفحه', { kind: 'number', field: 'pageCount' }, false],

  ['شابک', { kind: 'isbn' }, true],
  ['ای اس بی ان', { kind: 'isbn' }, true],
  ['آی اس بی ان', { kind: 'isbn' }, true],

  ['زبان', { kind: 'language' }, false],
  ['رده دیویی', { kind: 'text', field: 'deweyCode' }, true],
  ['دیویی', { kind: 'text', field: 'deweyCode' }, false],

  ['کلید واژه', { kind: 'text', field: 'keywords' }, true],
  ['کلیدواژه', { kind: 'text', field: 'keywords' }, true],
  ['کلمات کلیدی', { kind: 'text', field: 'keywords' }, true],
  ['موضوع', { kind: 'text', field: 'keywords' }, false],

  ['چکیده', { kind: 'text', field: 'summary' }, false],
  ['خلاصه', { kind: 'text', field: 'summary' }, false],
  ['یادداشت', { kind: 'text', field: 'internalNote' }, false],
  ['توضیحات', { kind: 'text', field: 'internalNote' }, false],
];

/**
 * کلیدواژه‌ها از بلند به کوتاه مرتب می‌شوند تا «عنوان کتاب» پیش از
 * «عنوان» بررسی شود؛ وگرنه «کتاب» جزو مقدار می‌ماند.
 */
const SORTED = [...KEYWORDS].sort((a, b) => b[0].length - a[0].length);

/**
 * مرز واژه برای فارسی. `\b` در جاوااسکریپت روی نویسه‌های غیرلاتین درست
 * کار نمی‌کند، پس مرز صریح با نگاه به عقب و جلو ساخته می‌شود — وگرنه
 * «سال» داخل «سالار» هم کلیدواژه شمرده می‌شد.
 *
 * فاصله داخل عبارت، نیم‌فاصله را هم می‌پذیرد: موتور تشخیص گفتار گاهی
 * «نوبت چاپ» را با نیم‌فاصله برمی‌گرداند.
 */
const KEYWORD_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${SORTED.map(([p]) => p.replace(/ /g, '[\\s\\u200c]+')).join('|')})` +
    `(?![\\p{L}\\p{N}])`,
  'gu',
);

/** جداکننده‌هایی که نشان می‌دهند گوینده مکث کرده و فیلد تازه‌ای شروع می‌شود. */
const SEPARATORS = new Set([',', '،', ';', '؛', ':', '.', '?', '؟', '!', '\n']);

/** واژه‌ها و نشانه‌هایی که پس از کلیدواژه می‌آیند و جزو مقدار نیستند. */
const LEADING_NOISE = /^[\s:،؛.\-–—]*(?:است|هست|این کتاب|کتاب)?[\s:،؛.\-–—]*/u;
const TRAILING_NOISE = /[\s:،؛.\-–—]*(?:است|هست|می ?باشد)?[\s:،؛.\-–—]*$/u;

function clean(value: string): string {
  return value
    .replace(LEADING_NOISE, '')
    .replace(TRAILING_NOISE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** «الف، ب و ج» → سه نام. */
function splitNames(value: string): string[] {
  return value
    .split(/[،؛,]|\s+و\s+/u)
    .map((n) => clean(n))
    .filter((n) => n.length >= 2);
}

function matchLanguage(value: string): string | undefined {
  const needle = clean(value);
  for (const [code, label] of Object.entries(LANGUAGES)) {
    if (label === needle) return code;
  }
  // «به زبان انگلیسی» یا «انگلیسی است»
  for (const [code, label] of Object.entries(LANGUAGES)) {
    if (needle.includes(label)) return code;
  }
  return undefined;
}

/**
 * آیا پیش از این موقعیت، جداکننده گفته شده است؟
 *
 * ابتدای جمله عمداً جداکننده حساب **نمی‌شود**: «سال بلوا» و «جلد دوم
 * شاهنامه» عنوان کتاب‌اند، نه فیلد سال و جلد. برای کلیدواژه‌های قاطع
 * («عنوان»، «نویسنده») این موضوع اثری ندارد، چون آنها بی‌قید پذیرفته
 * می‌شوند.
 */
function precededBySeparator(source: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const ch = source[i]!;
    if (ch === ' ' || ch === '\u200c') continue;
    return SEPARATORS.has(ch);
  }
  return false;
}

interface Candidate {
  start: number;
  end: number;
  slot: Slot;
  strong: boolean;
}

/**
 * آیا این کلیدواژه واقعاً کلیدواژه است یا واژه‌ای معمولی داخل یک عنوان؟
 *
 * کلیدواژه قاطع همیشه پذیرفته می‌شود. کلیدواژه غیرقاطع دو راه دارد:
 * جداکننده پیش از خودش، یا مقداری که از همان جنس درمی‌آید — «سال هزار و
 * چهارصد» عدد می‌دهد و پذیرفته می‌شود، ولی «صد سال تنهایی» مقدارش
 * «تنهایی» است و رد می‌شود.
 */
function isAcceptable(candidate: Candidate, source: string, valueEnd: number): boolean {
  if (candidate.strong) return true;
  if (precededBySeparator(source, candidate.start)) return true;

  const value = clean(source.slice(candidate.end, valueEnd));
  if (!value) return false;

  switch (candidate.slot.kind) {
    case 'number':
      return persianWordsToNumber(value) !== null;
    case 'language':
      return matchLanguage(value) !== undefined;
    case 'isbn':
      return persianWordsToDigits(value).length >= 8;
    default:
      // متن و پدیدآورنده راهی برای اعتبارسنجی ندارند؛ بدون جداکننده رد
      return false;
  }
}

export function parseBookDictation(transcript: string | null | undefined): DictatedBook {
  const result: DictatedBook = { text: {}, numbers: {}, contributors: [], unrecognized: '' };
  if (!transcript) return result;

  /*
   * `foldPersianLetters` طول رشته را عوض نمی‌کند، پس اندیس‌های الگو روی
   * همین رشته معتبرند. نیم‌فاصله هم دست‌نخورده می‌ماند: مقدار همین‌جا
   * برداشته و در پایگاه داده ذخیره می‌شود و «مگس‌ها» نباید «مگسها» شود.
   */
  const source = foldPersianLetters(transcript).replace(/\s+/g, ' ').trim();
  if (!source) return result;

  const candidates: Candidate[] = [];
  for (const match of source.matchAll(KEYWORD_RE)) {
    const phrase = match[1]!;
    const normalized = phrase.replace(/[\s\u200c]+/g, ' ');
    const entry =
      SORTED.find(([p]) => p === normalized) ??
      SORTED.find(([p]) => p.replace(/ /g, '') === normalized.replace(/ /g, ''));
    if (!entry) continue;
    candidates.push({
      start: match.index,
      end: match.index + phrase.length,
      slot: entry[1],
      strong: entry[2],
    });
  }

  const hits = candidates.filter((candidate, index) =>
    isAcceptable(candidate, source, candidates[index + 1]?.start ?? source.length),
  );

  // بدون هیچ کلیدواژه‌ای: رایج‌ترین حالت، گفتن فقط نام کتاب است
  if (hits.length === 0) {
    const only = clean(source);
    if (only) result.text.title = only;
    return result;
  }

  // هرچه پیش از اولین کلیدواژه گفته شده، شناخته نشده است
  const preface = clean(source.slice(0, hits[0]!.start));
  const unrecognized: string[] = preface ? [preface] : [];

  for (const [index, hit] of hits.entries()) {
    const valueEnd = hits[index + 1]?.start ?? source.length;
    const value = clean(source.slice(hit.end, valueEnd));
    if (!value) continue;

    switch (hit.slot.kind) {
      case 'text': {
        const field = hit.slot.field;
        // تکرار یک فیلد: مقدار دوم به اولی افزوده می‌شود، جایش را نمی‌گیرد
        result.text[field] = result.text[field] ? `${result.text[field]} ${value}` : value;
        break;
      }
      case 'number': {
        const parsed = persianWordsToNumber(value);
        if (parsed === null) unrecognized.push(value);
        else result.numbers[hit.slot.field] = parsed;
        break;
      }
      case 'isbn': {
        const digits = persianWordsToDigits(value);
        if (digits.length >= 8) result.isbn = digits;
        else unrecognized.push(value);
        break;
      }
      case 'language': {
        const code = matchLanguage(value);
        if (code) result.language = code;
        else unrecognized.push(value);
        break;
      }
      case 'contributor': {
        for (const name of splitNames(value)) {
          result.contributors.push({ role: hit.slot.role, fullName: name });
        }
        break;
      }
    }
  }

  result.unrecognized = unrecognized.join(' ').trim();
  return result;
}
