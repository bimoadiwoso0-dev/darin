import { z } from 'zod';

/**
 * اعتبارسنجی متغیرهای محیطی هنگام بالا آمدن برنامه.
 *
 * اگر تنظیمی اشتباه یا ناامن باشد، برنامه **همان لحظه** با پیام روشن متوقف
 * می‌شود — نه اینکه ساعت‌ها بعد در میانه یک عملیات کتابخانه خطا بدهد.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_NAME: z.string().default('Darin'),
    API_PORT: z.coerce.number().int().positive().default(3001),
    PUBLIC_WEB_URL: z.string().url().default('http://localhost:5173'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL الزامی است'),

    REDIS_URL: z.string().optional(),
    QUEUE_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET باید حداقل ۳۲ نویسه باشد'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET باید حداقل ۳۲ نویسه باشد'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL: z.string().default('7d'),

    COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    COOKIE_DOMAIN: z.string().optional(),
    CORS_ORIGINS: z.string().default('http://localhost:5173'),

    RATE_LIMIT_TTL: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),

    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_PATH: z.string().default('./storage'),
    MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().default(15),

    BACKUP_PATH: z.string().default('./storage/backups'),
    PG_DUMP_PATH: z.string().default('pg_dump'),
    PSQL_PATH: z.string().default('psql'),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    LOG_PRETTY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .superRefine((env, ctx) => {
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message:
          'JWT_REFRESH_SECRET باید با JWT_ACCESS_SECRET متفاوت باشد؛ در غیر این صورت یک Access Token را می‌توان به‌جای Refresh Token جا زد.',
      });
    }
    if (env.NODE_ENV === 'production') {
      if (!env.COOKIE_SECURE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['COOKIE_SECURE'],
          message: 'در محیط Production باید COOKIE_SECURE=true باشد (نیازمند HTTPS).',
        });
      }
      if (env.JWT_ACCESS_SECRET.startsWith('CHANGE_ME')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_ACCESS_SECRET'],
          message: 'مقدار پیش‌فرض JWT_ACCESS_SECRET را عوض کنید.',
        });
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`);
    throw new Error(
      `پیکربندی محیط نامعتبر است. فایل .env را بررسی کنید:\n${lines.join('\n')}\n`,
    );
  }
  return result.data;
}

/** فهرست دامنه‌های مجاز CORS از رشته جداشده با کاما. */
export function parseCorsOrigins(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
