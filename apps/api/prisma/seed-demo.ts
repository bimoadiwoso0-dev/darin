/**
 * داده نمایشی (Demo Data) برای توسعه و آموزش.
 *
 * ⚠️ قانون ۱۰۹: داده نمایشی کاملاً از داده واقعی جدا است.
 * هر رکورد ساخته‌شده اینجا در `internalNote` یا `note` برچسب `[DEMO]` دارد،
 * بنابراین با یک کوئری قابل شناسایی و حذف است:
 *
 *   pnpm --filter @darin/api db:seed -- --purge-demo
 *
 * این اسکریپت هرگز در Production اجرا نمی‌شود (بررسی NODE_ENV در seed.ts).
 */
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { syncNumberingSequences } from '../src/modules/numbering/sequence-sync.js';
import { currentJalaliMonth, currentJalaliYear } from '@darin/shared';

export const DEMO_MARKER = '[DEMO]';

/** ناشران واقعی ایرانی — برای اینکه داده نمایشی باورپذیر باشد. */
const PUBLISHERS = [
  { name: 'انتشارات ققنوس', city: 'تهران' },
  { name: 'نشر چشمه', city: 'تهران' },
  { name: 'انتشارات امیرکبیر', city: 'تهران' },
  { name: 'نشر مرکز', city: 'تهران' },
  { name: 'انتشارات علمی و فرهنگی', city: 'تهران' },
  { name: 'نشر نی', city: 'تهران' },
  { name: 'انتشارات سروش', city: 'تهران' },
  { name: 'نشر ثالث', city: 'تهران' },
  { name: 'انتشارات هرمس', city: 'تهران' },
  { name: 'انتشارات خوارزمی', city: 'تهران' },
];

const PERSONS = [
  { fullName: 'حافظ شیرازی', latinName: 'Hafez', nationality: 'ایران' },
  { fullName: 'سعدی شیرازی', latinName: 'Saadi', nationality: 'ایران' },
  { fullName: 'ابوالقاسم فردوسی', latinName: 'Ferdowsi', nationality: 'ایران' },
  { fullName: 'مولانا جلال‌الدین بلخی', latinName: 'Rumi', nationality: 'ایران' },
  { fullName: 'عمر خیام', latinName: 'Omar Khayyam', nationality: 'ایران' },
  { fullName: 'نظامی گنجوی', latinName: 'Nezami', nationality: 'ایران' },
  { fullName: 'صادق هدایت', latinName: 'Sadegh Hedayat', nationality: 'ایران' },
  { fullName: 'محمدعلی جمال‌زاده', latinName: 'Jamalzadeh', nationality: 'ایران' },
  { fullName: 'سیمین دانشور', latinName: 'Simin Daneshvar', nationality: 'ایران' },
  { fullName: 'هوشنگ گلشیری', latinName: 'Houshang Golshiri', nationality: 'ایران' },
  { fullName: 'احمد شاملو', latinName: 'Ahmad Shamlou', nationality: 'ایران' },
  { fullName: 'فروغ فرخزاد', latinName: 'Forough Farrokhzad', nationality: 'ایران' },
  { fullName: 'سهراب سپهری', latinName: 'Sohrab Sepehri', nationality: 'ایران' },
  { fullName: 'پرویز ناتل خانلری', latinName: 'Khanlari', nationality: 'ایران' },
  { fullName: 'محمدعلی موحد', latinName: 'Movahed', nationality: 'ایران' },
  { fullName: 'فئودور داستایوفسکی', latinName: 'Fyodor Dostoevsky', nationality: 'روسیه' },
  { fullName: 'لئو تولستوی', latinName: 'Leo Tolstoy', nationality: 'روسیه' },
  { fullName: 'گابریل گارسیا مارکز', latinName: 'Gabriel Garcia Marquez', nationality: 'کلمبیا' },
  { fullName: 'ارنست همینگوی', latinName: 'Ernest Hemingway', nationality: 'آمریکا' },
  { fullName: 'جورج اورول', latinName: 'George Orwell', nationality: 'انگلستان' },
  { fullName: 'فرانتس کافکا', latinName: 'Franz Kafka', nationality: 'چک' },
  { fullName: 'آلبر کامو', latinName: 'Albert Camus', nationality: 'فرانسه' },
  { fullName: 'یووال نوح هراری', latinName: 'Yuval Noah Harari', nationality: 'اسرائیل' },
  { fullName: 'استیون هاوکینگ', latinName: 'Stephen Hawking', nationality: 'انگلستان' },
  { fullName: 'کارل ساگان', latinName: 'Carl Sagan', nationality: 'آمریکا' },
  // مترجمان
  { fullName: 'محمد قاضی', latinName: 'Mohammad Ghazi', nationality: 'ایران' },
  { fullName: 'نجف دریابندری', latinName: 'Najaf Daryabandari', nationality: 'ایران' },
  { fullName: 'سروش حبیبی', latinName: 'Soroush Habibi', nationality: 'ایران' },
  { fullName: 'بهمن فرزانه', latinName: 'Bahman Farzaneh', nationality: 'ایران' },
  { fullName: 'عبدالله کوثری', latinName: 'Abdollah Kowsari', nationality: 'ایران' },
];

/** درخت دسته‌بندی — با ساختار واقعی رده‌بندی موضوعی. */
const CATEGORY_TREE: Array<{ name: string; children?: Array<{ name: string; children?: string[] }> }> = [
  {
    name: 'ادبیات',
    children: [
      { name: 'شعر', children: ['غزل', 'مثنوی', 'رباعی', 'شعر نو', 'قصیده'] },
      { name: 'داستان', children: ['رمان ایرانی', 'رمان خارجی', 'داستان کوتاه'] },
      { name: 'نمایشنامه' },
      { name: 'ادبیات کودک و نوجوان' },
    ],
  },
  {
    name: 'علوم انسانی',
    children: [
      { name: 'تاریخ', children: ['تاریخ ایران', 'تاریخ جهان', 'تاریخ اسلام'] },
      { name: 'فلسفه' },
      { name: 'روان‌شناسی' },
      { name: 'جامعه‌شناسی' },
    ],
  },
  {
    name: 'علوم پایه',
    children: [
      { name: 'ریاضیات' },
      { name: 'فیزیک' },
      { name: 'زیست‌شناسی' },
      { name: 'نجوم' },
    ],
  },
  {
    name: 'فنی و مهندسی',
    children: [{ name: 'کامپیوتر' }, { name: 'عمران' }, { name: 'برق' }],
  },
  { name: 'دین و عرفان', children: [{ name: 'قرآن و تفسیر' }, { name: 'عرفان' }] },
  { name: 'هنر', children: [{ name: 'خوشنویسی' }, { name: 'نقاشی' }, { name: 'موسیقی' }] },
  { name: 'مرجع', children: [{ name: 'فرهنگ لغت' }, { name: 'دایرةالمعارف' }] },
];

interface DemoBookSpec {
  title: string;
  subtitle?: string;
  originalTitle?: string;
  author: string;
  translator?: string;
  publisher: string;
  year: number;
  pages: number;
  category: string;
  keywords: string[];
  copies: number;
  volumes?: string[];
}

const BOOKS: DemoBookSpec[] = [
  { title: 'دیوان حافظ', author: 'حافظ شیرازی', publisher: 'انتشارات ققنوس', year: 1398, pages: 624, category: 'غزل', keywords: ['شعر', 'غزل', 'عرفان'], copies: 5 },
  { title: 'گلستان', author: 'سعدی شیرازی', publisher: 'انتشارات امیرکبیر', year: 1396, pages: 312, category: 'ادبیات', keywords: ['نثر', 'حکایت', 'اخلاق'], copies: 4 },
  { title: 'بوستان', author: 'سعدی شیرازی', publisher: 'انتشارات امیرکبیر', year: 1397, pages: 288, category: 'مثنوی', keywords: ['شعر', 'اخلاق'], copies: 3 },
  { title: 'شاهنامه', author: 'ابوالقاسم فردوسی', publisher: 'انتشارات علمی و فرهنگی', year: 1395, pages: 0, category: 'مثنوی', keywords: ['حماسه', 'اسطوره', 'شعر'], copies: 2, volumes: ['از آغاز تا پادشاهی منوچهر', 'از پادشاهی نوذر تا داستان رستم و سهراب', 'از داستان سیاوش تا پایان', 'پادشاهی ساسانیان'] },
  { title: 'مثنوی معنوی', author: 'مولانا جلال‌الدین بلخی', publisher: 'انتشارات هرمس', year: 1399, pages: 0, category: 'عرفان', keywords: ['عرفان', 'شعر', 'مثنوی'], copies: 2, volumes: ['دفتر اول و دوم', 'دفتر سوم و چهارم', 'دفتر پنجم و ششم'] },
  { title: 'رباعیات خیام', author: 'عمر خیام', publisher: 'نشر مرکز', year: 1394, pages: 168, category: 'رباعی', keywords: ['رباعی', 'فلسفه', 'شعر'], copies: 3 },
  { title: 'خمسه نظامی', author: 'نظامی گنجوی', publisher: 'انتشارات خوارزمی', year: 1393, pages: 892, category: 'مثنوی', keywords: ['شعر', 'داستان منظوم'], copies: 2 },
  { title: 'بوف کور', author: 'صادق هدایت', publisher: 'نشر چشمه', year: 1400, pages: 148, category: 'رمان ایرانی', keywords: ['رمان', 'مدرن', 'روان‌شناختی'], copies: 6 },
  { title: 'یکی بود یکی نبود', author: 'محمدعلی جمال‌زاده', publisher: 'نشر ثالث', year: 1392, pages: 196, category: 'داستان کوتاه', keywords: ['داستان کوتاه', 'طنز'], copies: 3 },
  { title: 'سووشون', author: 'سیمین دانشور', publisher: 'انتشارات خوارزمی', year: 1401, pages: 304, category: 'رمان ایرانی', keywords: ['رمان', 'تاریخ معاصر'], copies: 5 },
  { title: 'شازده احتجاب', author: 'هوشنگ گلشیری', publisher: 'نشر نیلوفر', year: 1397, pages: 112, category: 'رمان ایرانی', keywords: ['رمان', 'جریان سیال ذهن'], copies: 3 },
  { title: 'مجموعه اشعار احمد شاملو', author: 'احمد شاملو', publisher: 'نشر نگاه', year: 1398, pages: 1024, category: 'شعر نو', keywords: ['شعر نو', 'شعر سپید'], copies: 4 },
  { title: 'تولدی دیگر', author: 'فروغ فرخزاد', publisher: 'انتشارات مروارید', year: 1396, pages: 184, category: 'شعر نو', keywords: ['شعر نو'], copies: 4 },
  { title: 'هشت کتاب', author: 'سهراب سپهری', publisher: 'انتشارات طهوری', year: 1399, pages: 464, category: 'شعر نو', keywords: ['شعر نو', 'طبیعت'], copies: 5 },
  { title: 'جنایت و مکافات', originalTitle: 'Преступление и наказание', author: 'فئودور داستایوفسکی', translator: 'مهری آهی', publisher: 'انتشارات خوارزمی', year: 1398, pages: 776, category: 'رمان خارجی', keywords: ['رمان', 'روسی', 'کلاسیک'], copies: 4 },
  { title: 'برادران کارامازوف', author: 'فئودور داستایوفسکی', translator: 'صالح حسینی', publisher: 'نشر ناهید', year: 1397, pages: 1104, category: 'رمان خارجی', keywords: ['رمان', 'روسی'], copies: 3 },
  { title: 'جنگ و صلح', originalTitle: 'Война и мир', author: 'لئو تولستوی', translator: 'سروش حبیبی', publisher: 'نشر نیلوفر', year: 1395, pages: 0, category: 'رمان خارجی', keywords: ['رمان', 'تاریخی', 'روسی'], copies: 2, volumes: ['جلد اول', 'جلد دوم', 'جلد سوم', 'جلد چهارم'] },
  { title: 'آنا کارنینا', author: 'لئو تولستوی', translator: 'سروش حبیبی', publisher: 'نشر نیلوفر', year: 1396, pages: 968, category: 'رمان خارجی', keywords: ['رمان', 'روسی'], copies: 3 },
  { title: 'صد سال تنهایی', originalTitle: 'Cien años de soledad', author: 'گابریل گارسیا مارکز', translator: 'بهمن فرزانه', publisher: 'انتشارات امیرکبیر', year: 1400, pages: 464, category: 'رمان خارجی', keywords: ['رمان', 'رئالیسم جادویی'], copies: 6 },
  { title: 'عشق سال‌های وبا', author: 'گابریل گارسیا مارکز', translator: 'بهمن فرزانه', publisher: 'نشر ققنوس', year: 1398, pages: 512, category: 'رمان خارجی', keywords: ['رمان', 'عاشقانه'], copies: 3 },
  { title: 'پیرمرد و دریا', originalTitle: 'The Old Man and the Sea', author: 'ارنست همینگوی', translator: 'نجف دریابندری', publisher: 'انتشارات خوارزمی', year: 1394, pages: 128, category: 'رمان خارجی', keywords: ['رمان کوتاه', 'آمریکایی'], copies: 5 },
  { title: 'وداع با اسلحه', author: 'ارنست همینگوی', translator: 'نجف دریابندری', publisher: 'انتشارات نیلوفر', year: 1393, pages: 352, category: 'رمان خارجی', keywords: ['رمان', 'جنگ'], copies: 3 },
  { title: '۱۹۸۴', originalTitle: 'Nineteen Eighty-Four', author: 'جورج اورول', translator: 'صالح حسینی', publisher: 'انتشارات نیلوفر', year: 1401, pages: 336, category: 'رمان خارجی', keywords: ['رمان', 'دیستوپیا', 'سیاسی'], copies: 7 },
  { title: 'قلعه حیوانات', author: 'جورج اورول', translator: 'امیر امیرشاهی', publisher: 'نشر جامی', year: 1399, pages: 144, category: 'رمان خارجی', keywords: ['رمان', 'تمثیل', 'سیاسی'], copies: 6 },
  { title: 'مسخ', originalTitle: 'Die Verwandlung', author: 'فرانتس کافکا', translator: 'صادق هدایت', publisher: 'نشر چشمه', year: 1397, pages: 96, category: 'رمان خارجی', keywords: ['داستان', 'سورئال'], copies: 4 },
  { title: 'محاکمه', author: 'فرانتس کافکا', translator: 'امیر جلال‌الدین اعلم', publisher: 'انتشارات نیلوفر', year: 1396, pages: 296, category: 'رمان خارجی', keywords: ['رمان', 'ابزورد'], copies: 3 },
  { title: 'بیگانه', originalTitle: "L'Étranger", author: 'آلبر کامو', translator: 'جلال آل‌احمد', publisher: 'نشر نگاه', year: 1398, pages: 136, category: 'رمان خارجی', keywords: ['رمان', 'اگزیستانسیالیسم'], copies: 5 },
  { title: 'طاعون', author: 'آلبر کامو', translator: 'رضا سیدحسینی', publisher: 'انتشارات نیلوفر', year: 1399, pages: 320, category: 'رمان خارجی', keywords: ['رمان', 'فلسفی'], copies: 4 },
  { title: 'انسان خردمند', subtitle: 'تاریخ مختصر بشر', originalTitle: 'Sapiens', author: 'یووال نوح هراری', translator: 'نیک گرگین', publisher: 'نشر فرهنگ نشر نو', year: 1401, pages: 528, category: 'تاریخ جهان', keywords: ['تاریخ', 'انسان‌شناسی', 'علمی'], copies: 8 },
  { title: 'انسان خداگونه', originalTitle: 'Homo Deus', author: 'یووال نوح هراری', translator: 'زهra عالی', publisher: 'نشر فرهنگ نشر نو', year: 1400, pages: 480, category: 'تاریخ جهان', keywords: ['آینده‌پژوهی', 'فناوری'], copies: 5 },
  { title: 'تاریخچه زمان', originalTitle: 'A Brief History of Time', author: 'استیون هاوکینگ', translator: 'محمدرضا محجوب', publisher: 'انتشارات سروش', year: 1397, pages: 264, category: 'نجوم', keywords: ['فیزیک', 'کیهان‌شناسی'], copies: 4 },
  { title: 'کیهان', originalTitle: 'Cosmos', author: 'کارل ساگان', translator: 'سروش حبیبی', publisher: 'انتشارات سروش', year: 1395, pages: 448, category: 'نجوم', keywords: ['نجوم', 'علم عامه'], copies: 3 },
  { title: 'تاریخ ایران باستان', author: 'حسن پیرنیا', publisher: 'انتشارات علمی و فرهنگی', year: 1394, pages: 0, category: 'تاریخ ایران', keywords: ['تاریخ', 'ایران باستان'], copies: 2, volumes: ['جلد اول', 'جلد دوم', 'جلد سوم'] },
  { title: 'تاریخ بیهقی', author: 'ابوالفضل بیهقی', publisher: 'انتشارات هرمس', year: 1396, pages: 848, category: 'تاریخ ایران', keywords: ['تاریخ', 'نثر کهن'], copies: 2 },
  { title: 'لغت‌نامه دهخدا', author: 'علی‌اکبر دهخدا', publisher: 'انتشارات دانشگاه تهران', year: 1390, pages: 0, category: 'فرهنگ لغت', keywords: ['مرجع', 'لغت‌نامه'], copies: 1, volumes: ['جلد ۱ (آ - ب)', 'جلد ۲ (پ - ج)', 'جلد ۳ (چ - ز)', 'جلد ۴ (ژ - ف)', 'جلد ۵ (ق - ی)'] },
  { title: 'فرهنگ فارسی معین', author: 'محمد معین', publisher: 'انتشارات امیرکبیر', year: 1392, pages: 1520, category: 'فرهنگ لغت', keywords: ['مرجع', 'فرهنگ'], copies: 2 },
  { title: 'مبانی فلسفه', author: 'پرویز ناتل خانلری', publisher: 'انتشارات هرمس', year: 1398, pages: 384, category: 'فلسفه', keywords: ['فلسفه', 'مقدماتی'], copies: 3 },
  { title: 'روان‌شناسی رشد', author: 'لورا برک', translator: 'یحیی سیدمحمدی', publisher: 'نشر ارسباران', year: 1400, pages: 720, category: 'روان‌شناسی', keywords: ['روان‌شناسی', 'دانشگاهی'], copies: 4 },
  { title: 'مقدمه‌ای بر جامعه‌شناسی', author: 'آنتونی گیدنز', translator: 'منوچهر صبوری', publisher: 'نشر نی', year: 1399, pages: 896, category: 'جامعه‌شناسی', keywords: ['جامعه‌شناسی', 'دانشگاهی'], copies: 5 },
  { title: 'حساب دیفرانسیل و انتگرال', author: 'جیمز استوارت', translator: 'عالم‌زاده', publisher: 'انتشارات فاطمی', year: 1398, pages: 1104, category: 'ریاضیات', keywords: ['ریاضی', 'دانشگاهی'], copies: 6 },
  { title: 'فیزیک هالیدی', author: 'دیوید هالیدی', translator: 'محمدرضا بهاری', publisher: 'انتشارات نیاز دانش', year: 1399, pages: 0, category: 'فیزیک', keywords: ['فیزیک', 'دانشگاهی'], copies: 3, volumes: ['مکانیک', 'الکتریسیته و مغناطیس', 'فیزیک مدرن'] },
  { title: 'زیست‌شناسی کمپبل', author: 'نیل کمپبل', translator: 'گروه مترجمان', publisher: 'انتشارات خانه زیست‌شناسی', year: 1401, pages: 1248, category: 'زیست‌شناسی', keywords: ['زیست', 'دانشگاهی'], copies: 4 },
  { title: 'ساختمان داده و الگوریتم', author: 'توماس کورمن', translator: 'سعید ستایشی', publisher: 'انتشارات نص', year: 1400, pages: 1312, category: 'کامپیوتر', keywords: ['الگوریتم', 'برنامه‌نویسی'], copies: 5 },
  { title: 'مهندسی نرم‌افزار', author: 'یان سامرویل', translator: 'عین‌الله جعفرنژاد', publisher: 'انتشارات جهاد دانشگاهی', year: 1398, pages: 792, category: 'کامپیوتر', keywords: ['نرم‌افزار', 'مهندسی'], copies: 3 },
  { title: 'شبکه‌های کامپیوتری', author: 'اندرو تننباوم', translator: 'احسان ملکیان', publisher: 'انتشارات نص', year: 1397, pages: 960, category: 'کامپیوتر', keywords: ['شبکه', 'دانشگاهی'], copies: 3 },
  { title: 'تفسیر المیزان', author: 'سید محمدحسین طباطبایی', translator: 'محمدباقر موسوی', publisher: 'انتشارات اسلامی', year: 1393, pages: 0, category: 'قرآن و تفسیر', keywords: ['تفسیر', 'قرآن'], copies: 1, volumes: ['جلد ۱', 'جلد ۲', 'جلد ۳', 'جلد ۴', 'جلد ۵', 'جلد ۶'] },
  { title: 'کیمیای سعادت', author: 'امام محمد غزالی', publisher: 'انتشارات علمی و فرهنگی', year: 1395, pages: 672, category: 'عرفان', keywords: ['عرفان', 'اخلاق'], copies: 2 },
  { title: 'تذکرة الاولیاء', author: 'عطار نیشابوری', publisher: 'انتشارات زوار', year: 1396, pages: 856, category: 'عرفان', keywords: ['عرفان', 'زندگی‌نامه'], copies: 2 },
  { title: 'آموزش خوشنویسی نستعلیق', author: 'غلامحسین امیرخانی', publisher: 'انتشارات یساولی', year: 1399, pages: 176, category: 'خوشنویسی', keywords: ['هنر', 'خط'], copies: 3 },
  { title: 'تاریخ هنر ایران', author: 'آرتور پوپ', translator: 'نجف دریابندری', publisher: 'انتشارات علمی و فرهنگی', year: 1394, pages: 624, category: 'نقاشی', keywords: ['هنر', 'تاریخ'], copies: 2 },
  { title: 'ردیف موسیقی ایرانی', author: 'میرزا عبدالله', publisher: 'انتشارات ماهور', year: 1397, pages: 288, category: 'موسیقی', keywords: ['موسیقی', 'ردیف'], copies: 2 },
  { title: 'قصه‌های خوب برای بچه‌های خوب', author: 'مهدی آذریزدی', publisher: 'انتشارات امیرکبیر', year: 1400, pages: 0, category: 'ادبیات کودک و نوجوان', keywords: ['کودک', 'داستان'], copies: 4, volumes: ['قصه‌های کلیله و دمنه', 'قصه‌های مرزبان‌نامه', 'قصه‌های سندبادنامه'] },
  { title: 'ماهی سیاه کوچولو', author: 'صمد بهرنگی', publisher: 'انتشارات کانون پرورش فکری', year: 1398, pages: 48, category: 'ادبیات کودک و نوجوان', keywords: ['کودک', 'تمثیل'], copies: 8 },
];

const MEMBER_NAMES: Array<[string, string]> = [
  ['علی', 'محمدی'], ['فاطمه', 'حسینی'], ['محمد', 'رضایی'], ['زهرا', 'کریمی'],
  ['حسین', 'موسوی'], ['مریم', 'جعفری'], ['رضا', 'احمدی'], ['سارا', 'صادقی'],
  ['امیر', 'نوری'], ['نرگس', 'رحیمی'], ['مهدی', 'اکبری'], ['الهام', 'قاسمی'],
  ['سعید', 'شریفی'], ['نیلوفر', 'زارعی'], ['حمید', 'مرادی'], ['پریسا', 'یوسفی'],
  ['بهرام', 'سلطانی'], ['شیما', 'باقری'], ['کاوه', 'نجفی'], ['لیلا', 'عباسی'],
  ['آرش', 'فتحی'], ['مینا', 'خسروی'], ['بابک', 'امینی'], ['رویا', 'داوودی'],
  ['فرهاد', 'اسدی'], ['سمیرا', 'طاهری'], ['نیما', 'کاظمی'], ['هستی', 'محمودی'],
  ['کیان', 'رستمی'], ['یاسمن', 'حیدری'],
];

/** تولید عدد شبه‌تصادفی قابل تکرار — Seed یکسان همیشه داده یکسان می‌سازد. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}

/** ISBN-13 معتبر می‌سازد (پیشوند ۹۷۸-۶۰۰ = ایران). */
function makeIsbn13(rng: () => number): string {
  let body = '978600';
  for (let i = 0; i < 6; i++) body += Math.floor(rng() * 10);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  return body + String((10 - (sum % 10)) % 10);
}

export async function seedDemo(prisma: PrismaClient): Promise<void> {
  const rng = makeRng(20260827);
  const branch = await prisma.branch.findFirstOrThrow({ where: { isDefault: true } });

  // ── ۱. مکان‌ها ─────────────────────────────────────────────────────────
  console.log('  ساخت درخت مکان‌ها...');
  const building = await prisma.location.create({
    data: {
      branchId: branch.id, kind: 'BUILDING', name: 'ساختمان اصلی',
      code: 'B1', fullCode: 'B1', depth: 0, note: DEMO_MARKER,
    },
  });
  await prisma.location.update({ where: { id: building.id }, data: { path: `.${building.id}.` } });

  const shelfLevels: string[] = [];
  const sections = [
    { name: 'بخش ادبیات', code: 'S1', aisles: 3 },
    { name: 'بخش علوم انسانی', code: 'S2', aisles: 2 },
    { name: 'بخش علوم و فنی', code: 'S3', aisles: 2 },
    { name: 'بخش مرجع و کودک', code: 'S4', aisles: 1 },
  ];

  const floor = await prisma.location.create({
    data: {
      branchId: branch.id, parentId: building.id, kind: 'FLOOR', name: 'طبقه اول',
      code: 'F1', fullCode: 'B1-F1', depth: 1, path: `.${building.id}.`, note: DEMO_MARKER,
    },
  });
  await prisma.location.update({ where: { id: floor.id }, data: { path: `.${building.id}.${floor.id}.` } });
  const floorPath = `.${building.id}.${floor.id}.`;

  for (const sec of sections) {
    const section = await prisma.location.create({
      data: {
        branchId: branch.id, parentId: floor.id, kind: 'SECTION', name: sec.name,
        code: sec.code, fullCode: `B1-F1-${sec.code}`, depth: 2, path: floorPath, note: DEMO_MARKER,
      },
    });
    const secPath = `${floorPath}${section.id}.`;
    await prisma.location.update({ where: { id: section.id }, data: { path: secPath } });

    for (let a = 1; a <= sec.aisles; a++) {
      const aisleCode = `A${String(a).padStart(2, '0')}`;
      const aisle = await prisma.location.create({
        data: {
          branchId: branch.id, parentId: section.id, kind: 'AISLE', name: `راهروی ${a}`,
          code: aisleCode, fullCode: `B1-F1-${sec.code}-${aisleCode}`, depth: 3,
          path: secPath, sortOrder: a, note: DEMO_MARKER,
        },
      });
      const aislePath = `${secPath}${aisle.id}.`;
      await prisma.location.update({ where: { id: aisle.id }, data: { path: aislePath } });

      for (let sh = 1; sh <= 4; sh++) {
        const shelfCode = `SH${String(sh).padStart(2, '0')}`;
        const shelf = await prisma.location.create({
          data: {
            branchId: branch.id, parentId: aisle.id, kind: 'SHELF', name: `قفسه ${sh}`,
            code: shelfCode, fullCode: `B1-F1-${sec.code}-${aisleCode}-${shelfCode}`, depth: 4,
            path: aislePath, sortOrder: sh, capacity: 240, note: DEMO_MARKER,
          },
        });
        const shelfPath = `${aislePath}${shelf.id}.`;
        await prisma.location.update({ where: { id: shelf.id }, data: { path: shelfPath } });

        for (let lv = 1; lv <= 5; lv++) {
          const levelCode = `L${String(lv).padStart(2, '0')}`;
          const level = await prisma.location.create({
            data: {
              branchId: branch.id, parentId: shelf.id, kind: 'SHELF_LEVEL', name: `طبقه ${lv}`,
              code: levelCode,
              fullCode: `B1-F1-${sec.code}-${aisleCode}-${shelfCode}-${levelCode}`,
              depth: 5, path: shelfPath, sortOrder: lv, capacity: 48, note: DEMO_MARKER,
            },
          });
          await prisma.location.update({
            where: { id: level.id },
            data: { path: `${shelfPath}${level.id}.` },
          });
          shelfLevels.push(level.id);
        }
      }
    }
  }
  console.log(`  ✔ ${shelfLevels.length} طبقه قفسه ساخته شد`);

  // ── ۲. دسته‌بندی‌ها ────────────────────────────────────────────────────
  const categoryIdByName = new Map<string, string>();
  async function createCategory(name: string, parentId: string | null, parentPath: string, depth: number) {
    const cat = await prisma.category.create({
      data: { name, parentId, kind: 'SUBJECT', depth, path: parentPath, description: DEMO_MARKER },
    });
    const path = `${parentPath}${cat.id}.`;
    await prisma.category.update({ where: { id: cat.id }, data: { path } });
    categoryIdByName.set(name, cat.id);
    return { id: cat.id, path };
  }

  for (const top of CATEGORY_TREE) {
    const t = await createCategory(top.name, null, '.', 0);
    for (const mid of top.children ?? []) {
      const m = await createCategory(mid.name, t.id, t.path, 1);
      for (const leaf of mid.children ?? []) {
        await createCategory(leaf, m.id, m.path, 2);
      }
    }
  }
  console.log(`  ✔ ${categoryIdByName.size} دسته‌بندی ساخته شد`);

  // ── ۳. ناشران و پدیدآورندگان ──────────────────────────────────────────
  const publisherIdByName = new Map<string, string>();
  for (const p of PUBLISHERS) {
    const pub = await prisma.publisher.create({ data: { ...p, note: DEMO_MARKER } });
    publisherIdByName.set(p.name, pub.id);
  }

  const personIdByName = new Map<string, string>();
  for (const p of PERSONS) {
    const person = await prisma.person.create({ data: { ...p, note: DEMO_MARKER } });
    personIdByName.set(p.fullName, person.id);
  }

  /** ناشر یا پدیدآورنده‌ای که در فهرست ثابت نبود را در لحظه می‌سازد. */
  async function ensurePublisher(name: string): Promise<string> {
    const found = publisherIdByName.get(name);
    if (found) return found;
    const created = await prisma.publisher.create({ data: { name, city: 'تهران', note: DEMO_MARKER } });
    publisherIdByName.set(name, created.id);
    return created.id;
  }
  async function ensurePerson(name: string): Promise<string> {
    const found = personIdByName.get(name);
    if (found) return found;
    const created = await prisma.person.create({ data: { fullName: name, note: DEMO_MARKER } });
    personIdByName.set(name, created.id);
    return created.id;
  }

  // ── ۴. کتاب‌ها و نسخه‌ها ───────────────────────────────────────────────
  console.log('  ساخت کتاب‌ها و نسخه‌های فیزیکی...');
  let accession = 1;
  let barcodeSeq = 1;
  const allCopyIds: string[] = [];

  function nextBarcode(): string {
    const body = `200${String(barcodeSeq++).padStart(9, '0')}`;
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
    return body + String((10 - (sum % 10)) % 10);
  }

  async function createCopies(bookId: string, count: number) {
    for (let c = 1; c <= count; c++) {
      const copy = await prisma.bookCopy.create({
        data: {
          bookId,
          branchId: branch.id,
          copyNumber: c,
          accessionNumber: String(accession++).padStart(6, '0'),
          libraryCode: `BK-${String(accession).padStart(6, '0')}`,
          barcode: nextBarcode(),
          locationId: pick(rng, shelfLevels),
          positionCode: String(Math.floor(rng() * 48) + 1).padStart(2, '0'),
          acquisitionSource: rng() > 0.75 ? 'DONATION' : 'PURCHASE',
          acquiredAt: new Date(Date.now() - Math.floor(rng() * 1200) * 86_400_000),
          purchasePrice: Math.floor(rng() * 40 + 10) * 10_000,
          condition: rng() > 0.85 ? 'FAIR' : 'GOOD',
          internalNote: DEMO_MARKER,
        },
      });
      allCopyIds.push(copy.id);
    }
  }

  for (const spec of BOOKS) {
    const publisherId = await ensurePublisher(spec.publisher);
    const authorId = await ensurePerson(spec.author);
    const translatorId = spec.translator ? await ensurePerson(spec.translator) : null;
    const categoryId = categoryIdByName.get(spec.category);

    const contributors = [
      { personId: authorId, role: 'AUTHOR' as const, position: 0 },
      ...(translatorId ? [{ personId: translatorId, role: 'TRANSLATOR' as const, position: 1 }] : []),
    ];

    const book = await prisma.book.create({
      data: {
        title: spec.title,
        subtitle: spec.subtitle,
        originalTitle: spec.originalTitle,
        publisherId,
        publicationYear: spec.year,
        publicationPlace: 'تهران',
        edition: Math.floor(rng() * 12) + 1,
        isbn13: makeIsbn13(rng),
        pageCount: spec.pages || null,
        language: 'fa',
        format: pick(rng, ['VAZIRI', 'ROQEI', 'JEEBI'] as const),
        bindingType: rng() > 0.5 ? 'HARDCOVER' : 'PAPERBACK',
        keywords: spec.keywords,
        summary: `${spec.title} اثر ${spec.author}. ${DEMO_MARKER}`,
        totalVolumes: spec.volumes?.length,
        internalNote: DEMO_MARKER,
        contributors: { create: contributors },
        categories: categoryId ? { create: [{ categoryId, isPrimary: true }] } : undefined,
      },
    });

    if (spec.volumes) {
      // کتاب چندجلدی: هر جلد یک رکورد مستقل با نسخه‌های فیزیکی خودش
      for (const [i, volTitle] of spec.volumes.entries()) {
        const vol = await prisma.book.create({
          data: {
            title: spec.title,
            volumeTitle: volTitle,
            volumeNumber: i + 1,
            totalVolumes: spec.volumes.length,
            parentBookId: book.id,
            publisherId,
            publicationYear: spec.year,
            publicationPlace: 'تهران',
            isbn13: makeIsbn13(rng),
            pageCount: Math.floor(rng() * 400) + 300,
            language: 'fa',
            keywords: spec.keywords,
            internalNote: DEMO_MARKER,
            contributors: { create: contributors },
            categories: categoryId ? { create: [{ categoryId, isPrimary: true }] } : undefined,
          },
        });
        await createCopies(vol.id, spec.copies);
      }
    } else {
      await createCopies(book.id, spec.copies);
    }
  }

  const bookCount = await prisma.book.count();
  console.log(`  ✔ ${bookCount} عنوان و ${allCopyIds.length} نسخه فیزیکی ساخته شد`);

  // ── ۵. اعضا ────────────────────────────────────────────────────────────
  const types = await prisma.membershipType.findMany();
  const defaultType = types.find((t) => t.isDefault) ?? types[0]!;
  const memberIds: string[] = [];

  for (const [i, [first, last]] of MEMBER_NAMES.entries()) {
    const joined = new Date(Date.now() - Math.floor(rng() * 900 + 30) * 86_400_000);
    const member = await prisma.member.create({
      data: {
        branchId: branch.id,
        memberCode: `M-${String(i + 1).padStart(5, '0')}`,
        firstName: first,
        lastName: last,
        nationalId: String(1_000_000_000 + Math.floor(rng() * 899_999_999)),
        mobile: `09${String(Math.floor(rng() * 1_000_000_000)).padStart(9, '0')}`,
        email: `member${i + 1}@example.test`,
        membershipTypeId: i % 5 === 0 ? pick(rng, types).id : defaultType.id,
        joinedAt: joined,
        expiresAt: new Date(joined.getTime() + 365 * 86_400_000),
        // چند عضو غیرفعال و منقضی برای اینکه فیلترهای داشبورد داده واقعی داشته باشند
        status: i % 11 === 0 ? 'INACTIVE' : i % 13 === 0 ? 'EXPIRED' : 'ACTIVE',
        note: DEMO_MARKER,
      },
    });
    memberIds.push(member.id);
  }
  console.log(`  ✔ ${memberIds.length} عضو ساخته شد`);

  // ── ۶. امانت‌ها (شامل بازگشتی، جاری و دیرکرد) ────────────────────────
  console.log('  ساخت سوابق امانت...');
  const activeMembers = await prisma.member.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
  const usedCopies = new Set<string>();
  let loanSeq = 1;
  let returned = 0;
  let active = 0;
  let overdue = 0;

  // ۶.۱ امانت‌های بازگشت‌داده‌شده — تاریخچه برای گزارش «پرترددترین کتاب»
  for (let i = 0; i < 260; i++) {
    const copyId = pick(rng, allCopyIds);
    const memberId = pick(rng, activeMembers).id;
    const loanedAt = new Date(Date.now() - Math.floor(rng() * 330 + 20) * 86_400_000);
    const dueAt = new Date(loanedAt.getTime() + 14 * 86_400_000);
    const returnedAt = new Date(dueAt.getTime() + Math.floor(rng() * 20 - 11) * 86_400_000);
    await prisma.loan.create({
      data: {
        loanNumber: `1405${String(loanSeq++).padStart(6, '0')}`,
        branchId: branch.id, memberId, copyId,
        status: 'RETURNED',
        loanedAt, dueAt, originalDueAt: dueAt,
        returnedAt: returnedAt > loanedAt ? returnedAt : dueAt,
        renewalCount: rng() > 0.75 ? 1 : 0,
      },
    });
    returned++;
  }

  // ۶.۲ امانت‌های جاری — قید `loans_one_open_per_copy` یعنی هر نسخه فقط یک بار
  for (let i = 0; i < 55; i++) {
    let copyId = pick(rng, allCopyIds);
    let guard = 0;
    while (usedCopies.has(copyId) && guard++ < 50) copyId = pick(rng, allCopyIds);
    if (usedCopies.has(copyId)) continue;
    usedCopies.add(copyId);

    const memberId = pick(rng, activeMembers).id;
    const loanedAt = new Date(Date.now() - Math.floor(rng() * 12 + 1) * 86_400_000);
    const dueAt = new Date(loanedAt.getTime() + 14 * 86_400_000);
    await prisma.loan.create({
      data: {
        loanNumber: `1405${String(loanSeq++).padStart(6, '0')}`,
        branchId: branch.id, memberId, copyId, status: 'ACTIVE',
        loanedAt, dueAt, originalDueAt: dueAt,
      },
    });
    await prisma.bookCopy.update({ where: { id: copyId }, data: { status: 'ON_LOAN' } });
    active++;
  }

  // ۶.۳ امانت‌های دیرکردی + جریمه متناظر
  for (let i = 0; i < 14; i++) {
    let copyId = pick(rng, allCopyIds);
    let guard = 0;
    while (usedCopies.has(copyId) && guard++ < 50) copyId = pick(rng, allCopyIds);
    if (usedCopies.has(copyId)) continue;
    usedCopies.add(copyId);

    const memberId = pick(rng, activeMembers).id;
    const overdueDays = Math.floor(rng() * 25) + 2;
    const dueAt = new Date(Date.now() - overdueDays * 86_400_000);
    const loanedAt = new Date(dueAt.getTime() - 14 * 86_400_000);

    const loan = await prisma.loan.create({
      data: {
        loanNumber: `1405${String(loanSeq++).padStart(6, '0')}`,
        branchId: branch.id, memberId, copyId, status: 'OVERDUE',
        loanedAt, dueAt, originalDueAt: dueAt,
      },
    });
    await prisma.bookCopy.update({ where: { id: copyId }, data: { status: 'ON_LOAN' } });

    const amount = overdueDays * 5_000;
    const fine = await prisma.fine.create({
      data: {
        memberId, loanId: loan.id, type: 'LATE_RETURN',
        amount, overdueDays,
        reason: `دیرکرد ${overdueDays} روزه`,
        status: rng() > 0.6 ? 'PAID' : 'UNPAID',
        paidAmount: 0,
        note: DEMO_MARKER,
      },
    });
    if (fine.status === 'PAID') {
      await prisma.$transaction([
        prisma.payment.create({
          data: { fineId: fine.id, amount, method: 'CASH', note: DEMO_MARKER },
        }),
        prisma.fine.update({
          where: { id: fine.id },
          data: { paidAmount: amount, settledAt: new Date() },
        }),
      ]);
    }
    overdue++;
  }
  console.log(`  ✔ امانت: ${returned} بازگشتی، ${active} جاری، ${overdue} دیرکرد`);

  // ── ۷. رزروها ──────────────────────────────────────────────────────────
  const loanedBooks = await prisma.bookCopy.findMany({
    where: { status: 'ON_LOAN' }, select: { bookId: true }, take: 10,
  });
  const seenPairs = new Set<string>();
  let reservations = 0;
  for (const { bookId } of loanedBooks) {
    const memberId = pick(rng, activeMembers).id;
    const pairKey = `${bookId}:${memberId}`;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    await prisma.reservation.create({
      data: {
        bookId, memberId, status: 'PENDING', queuePosition: 1,
        reservedAt: new Date(Date.now() - Math.floor(rng() * 6) * 86_400_000),
        note: DEMO_MARKER,
      },
    });
    reservations++;
  }
  console.log(`  ✔ ${reservations} رزرو ساخته شد`);

  // ── ۸. چند نسخه با وضعیت غیرعادی ──────────────────────────────────────
  const spare = allCopyIds.filter((id) => !usedCopies.has(id));
  const statusSamples = [
    { status: 'DAMAGED' as const, count: 6 },
    { status: 'IN_REPAIR' as const, count: 3 },
    { status: 'LOST' as const, count: 4 },
    { status: 'NOT_LOANABLE' as const, count: 5 },
  ];
  let idx = 0;
  for (const s of statusSamples) {
    for (let i = 0; i < s.count && idx < spare.length; i++, idx++) {
      await prisma.bookCopy.update({
        where: { id: spare[idx]! },
        data: {
          status: s.status,
          isLoanable: s.status !== 'NOT_LOANABLE' && s.status !== 'LOST',
        },
      });
    }
  }
  console.log(`  ✔ ${idx} نسخه با وضعیت‌های خاص علامت‌گذاری شد`);

  // ── ۹. همگام‌سازی شمارنده‌ها ──────────────────────────────────────────
  // این گام حیاتی است: رکوردهای بالا مستقیماً درج شدند و از `NumberingService`
  // عبور نکردند، بنابراین شمارنده‌ها هنوز روی صفر هستند. بدون این همگام‌سازی،
  // اولین کتابی که کتابدار ثبت کند شماره ثبت «000001» می‌گیرد که تکراری است.
  const synced = await syncNumberingSequences(prisma as never, {
    solarYear: currentJalaliYear(),
    solarMonth: currentJalaliMonth(),
  });
  for (const r of synced.filter((x) => x.changed)) {
    console.log(`  ✔ شمارنده «${r.key}»: ${r.previous} → ${r.current}`);
  }
}

/** حذف کامل داده نمایشی — برای گذار از محیط آموزش به محیط واقعی. */
export async function purgeDemo(prisma: PrismaClient): Promise<void> {
  // ترتیب حذف از برگ به ریشه است تا کلیدهای خارجی نقض نشوند.
  await prisma.$transaction([
    prisma.payment.deleteMany({ where: { note: DEMO_MARKER } }),
    prisma.fine.deleteMany({ where: { note: DEMO_MARKER } }),
    prisma.reservation.deleteMany({ where: { note: DEMO_MARKER } }),
  ]);
  await prisma.loan.deleteMany({ where: { copy: { internalNote: DEMO_MARKER } } });
  await prisma.bookCopy.deleteMany({ where: { internalNote: DEMO_MARKER } });
  await prisma.book.deleteMany({ where: { internalNote: DEMO_MARKER } });
  await prisma.member.deleteMany({ where: { note: DEMO_MARKER } });
  await prisma.person.deleteMany({ where: { note: DEMO_MARKER } });
  await prisma.publisher.deleteMany({ where: { note: DEMO_MARKER } });
  await prisma.category.deleteMany({ where: { description: DEMO_MARKER } });
  await prisma.location.deleteMany({ where: { note: DEMO_MARKER } });
  console.log('✔ تمام داده نمایشی حذف شد');
}
