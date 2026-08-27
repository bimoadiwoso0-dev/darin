/** قرارداد صفحه‌بندی و پاسخ لیستی — یکسان در تمام Endpoint های لیستی. */

export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 200;

export interface PageQuery {
  page?: number;
  pageSize?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** وقتی `true` است، `total` تخمینی است (برای جدول‌های خیلی بزرگ بدون فیلتر). */
  estimated?: boolean;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export function normalizePageQuery(q: PageQuery): { page: number; pageSize: number; skip: number; take: number } {
  const page = Math.max(1, Math.floor(q.page ?? 1));
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Math.floor(q.pageSize ?? PAGE_SIZE_DEFAULT)));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

export function buildPageMeta(page: number, pageSize: number, total: number, estimated = false): PageMeta {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), estimated };
}

/** پاسخ استاندارد خطا — همان شکلی که Frontend انتظار دارد. */
export interface ApiErrorBody {
  code: string;
  message: string;
  details?: Record<string, string[]> | unknown;
  requestId?: string;
}
