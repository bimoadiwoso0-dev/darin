import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CopiesController } from './copies.controller';
import { CopiesService } from './copies.service';

@Module({
  imports: [AuditModule],
  controllers: [CopiesController],
  providers: [CopiesService],
  exports: [CopiesService],
})
export class HoldingsModule {}
