import { Global, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { NumberingController } from './numbering.controller';
import { NumberingService } from './numbering.service';

/** Global است چون کاتالوگ، اعضا و امانت هر سه به تولید شماره نیاز دارند. */
@Global()
@Module({
  imports: [AuditModule],
  controllers: [NumberingController],
  providers: [NumberingService],
  exports: [NumberingService],
})
export class NumberingModule {}
