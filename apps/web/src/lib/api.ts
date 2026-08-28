import { ERROR_MESSAGES_FA, type ApiErrorBody } from '@darin/shared';

/**
 * کلاینت HTTP سامانه.
 *
 * ── چرا کلاس اختصاصی و نه fetch خام ──────────────────────────────────────
 * سه رفتار در هر درخواست تکرار می‌شود و باید یک‌جا حل شود:
 *   ۱. ارسال کوکی احراز هویت (`credentials: 'include'`)
 *   ۲. تبدیل پاسخ خطا به یک `ApiError` با پیام فارسی
 *   ۳. تمدید خودکار نشست وقتی Access Token منقضی شده
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** خطاهای اعتبارسنجی به شکل `{ field: [messages] }` — برای نمایش زیر فیلد فرم. */
  get fieldErrors(): Record<string, string[]> | null {
    if (this.code !== 'VALIDATION_FAILED') return null;
    if (typeof this.details !== 'object' || this.details === null) return null;
    return this.details as Record<string, string[]>;
  }

  /** آیا کاربر دارای مجوز می‌تواند از این محدودیت عبور کند؟ */
  get isOverridable(): boolean {
    return (
      typeof this.details === 'object' &&
      this.details !== null &&
      (this.details as { overridable?: boolean }).overridable === true
    );
  }

  /** فهرست تخلفات قوانین امانت — برای نمایش در دیالوگ تأیید. */
  get violations(): Array<{ code: string; message: string; overridable: boolean }> {
    if (typeof this.details !== 'object' || this.details === null) return [];
    const v = (this.details as { violations?: unknown }).violations;
    if (!Array.isArray(v)) return [];
    // `Array.isArray` فقط می‌گوید آرایه است، نه آرایه‌ی چه چیزی
    return v as Array<{ code: string; message: string; overridable: boolean }>;
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
  /** پارامترهای Query — مقادیر undefined و null حذف می‌شوند */
  params?: Record<string, unknown>;
  /** برای دانلود فایل: پاسخ به‌صورت Blob برگردانده می‌شود */
  raw?: boolean;
};

const BASE = '/api';

/** جلوگیری از چند تلاش هم‌زمان برای تمدید نشست. */
let refreshPromise: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      // اجازه تلاش مجدد در آینده
      setTimeout(() => { refreshPromise = null; }, 0);
    }
  })();
  return refreshPromise;
}

function buildUrl(path: string, params?: Record<string, unknown>): string {
  const url = new URL(BASE + path, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        if (value.length === 0) continue;
        url.searchParams.set(key, value.join(','));
      } else if (value instanceof Date) {
        url.searchParams.set(key, value.toISOString());
      } else {
        // eslint-disable-next-line @typescript-eslint/no-base-to-string -- آرایه و Date بالاتر جدا شده‌اند؛ اینجا فقط مقدار ساده می‌ماند
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.pathname + url.search;
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody | null = null;
  try {
    body = (await response.json()) as ApiErrorBody;
  } catch {
    // پاسخ JSON نبود (مثلاً خطای Nginx یا قطع شبکه)
  }

  const code = body?.code ?? 'INTERNAL';
  const message =
    body?.message ??
    ERROR_MESSAGES_FA[code as keyof typeof ERROR_MESSAGES_FA] ??
    'ارتباط با سرور برقرار نشد.';

  return new ApiError(response.status, code, message, body?.details, body?.requestId);
}

async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
  isRetry = false,
): Promise<T> {
  const { body, params, raw, headers, ...rest } = options;

  const init: RequestInit = {
    ...rest,
    method,
    credentials: 'include',
    headers: {
      ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
  };

  if (body !== undefined) {
    init.body = body instanceof FormData ? body : JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, params), init);
  } catch {
    throw new ApiError(
      0,
      'NETWORK',
      'ارتباط با سرور برقرار نشد. اتصال شبکه را بررسی کنید.',
    );
  }

  // ── تمدید خودکار نشست ────────────────────────────────────────────────
  // Access Token فقط ۱۵ دقیقه عمر دارد. اگر منقضی شده، یک بار تمدید و
  // درخواست تکرار می‌شود — کتابدار نباید وسط ثبت امانت به صفحه ورود پرت شود.
  if (response.status === 401 && !isRetry && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) return request<T>(method, path, options, true);
  }

  if (!response.ok) throw await toApiError(response);

  if (raw) return response as unknown as T;
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string, params?: Record<string, unknown>) =>
    request<T>('GET', path, { params }),

  post: <T>(path: string, body?: unknown, params?: Record<string, unknown>) =>
    request<T>('POST', path, { body, params }),

  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body }),

  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body }),

  delete: <T>(path: string) => request<T>('DELETE', path),

  /** آپلود فایل با FormData. */
  upload: <T>(path: string, formData: FormData) =>
    request<T>('POST', path, { body: formData }),

  /**
   * دانلود فایل (خروجی Excel، پشتیبان، برچسب).
   * نام فایل از هدر `Content-Disposition` خوانده می‌شود تا نام فارسی
   * گزارش حفظ شود.
   */
  download: async (path: string, params?: Record<string, unknown>): Promise<void> => {
    const response = await request<Response>('GET', path, { params, raw: true });
    const blob = await response.blob();

    const disposition = response.headers.get('Content-Disposition') ?? '';
    const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    const plainMatch = /filename="?([^";]+)"?/i.exec(disposition);
    const fileName = utf8Match
      ? decodeURIComponent(utf8Match[1]!)
      : (plainMatch?.[1] ?? 'download');

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  },
};

/** شکل استاندارد پاسخ لیستی. */
export interface Paginated<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    [key: string]: unknown;
  };
}
