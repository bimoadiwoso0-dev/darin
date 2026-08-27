import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { QueueService } from './queue/queue.service';
import { StorageService } from './storage/storage.service';

/**
 * سرویس‌های زیرساختی مشترک.
 *
 * `@Global` است چون تقریباً هر ماژول دامنه به `PrismaService` نیاز دارد و
 * وارد کردن دستی آن در ۲۰ ماژول فقط نویز است. این تنها ماژول Global سیستم
 * است — منطق کسب‌وکار هرگز Global نمی‌شود.
 */
@Global()
@Module({
  providers: [PrismaService, QueueService, StorageService],
  exports: [PrismaService, QueueService, StorageService],
})
export class InfrastructureModule {}
