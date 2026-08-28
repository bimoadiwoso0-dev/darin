import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { parseCorsOrigins } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    // بدنه بزرگ فقط برای Import فایل مجاز است؛ محدودیت واقعی در StorageService است
    bodyParser: true,
  });

  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService);
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  // ── امنیت ──────────────────────────────────────────────────────────────
  app.use(
    helmet({
      // API هیچ HTML سرو نمی‌کند؛ CSP روی سرور رابط کاربری (Nginx) اعمال می‌شود
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );
  app.use(cookieParser());

  app.enableCors({
    origin: parseCorsOrigins(config.get<string>('CORS_ORIGINS', '')),
    // بدون این، مرورگر کوکی HttpOnly احراز هویت را ارسال نمی‌کند
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['Content-Disposition'], // برای دانلود خروجی Excel
  });

  app.setGlobalPrefix('api');

  // پشت Nginx اجرا می‌شود؛ بدون این، IP همه کاربران 127.0.0.1 ثبت می‌شد.
  // `getInstance()` نوع `any` می‌دهد؛ همین‌جا به شکل واقعی‌اش محدود می‌شود.
  const httpInstance = app.getHttpAdapter().getInstance() as {
    set: (key: string, value: unknown) => void;
  };
  httpInstance.set('trust proxy', 1);

  // ── مستندات API ────────────────────────────────────────────────────────
  if (!isProduction) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Darin LMS API')
      .setDescription('واسط برنامه‌نویسی سامانه مدیریت کتابخانه دارین')
      .setVersion('1.0')
      .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'bearer')
      .addCookieAuth('darin_at')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  app.enableShutdownHooks();

  const port = config.get<number>('API_PORT', 3001);
  await app.listen(port, '0.0.0.0');

  const logger = app.get(Logger);
  logger.log(`سرویس روی پورت ${port} در حال اجراست`);
  if (!isProduction) logger.log(`مستندات API: http://localhost:${port}/api/docs`);
}

bootstrap().catch((err: unknown) => {
  // در این مرحله Logger هنوز ممکن است آماده نباشد
  console.error('راه‌اندازی سرویس ناموفق بود:');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
