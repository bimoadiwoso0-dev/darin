import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  imports: [AuditModule],
  controllers: [MembersController],
  providers: [MembersService],
  exports: [MembersService],
})
export class MembersModule {}
