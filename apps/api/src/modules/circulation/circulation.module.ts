import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FinesController, LoansController, ReservationsController } from './circulation.controller';
import { FinesService } from './fines.service';
import { LoanPolicyService } from './loan-policy.service';
import { LoansService } from './loans.service';
import { ReservationsService } from './reservations.service';

@Module({
  imports: [AuditModule],
  controllers: [LoansController, ReservationsController, FinesController],
  providers: [LoansService, ReservationsService, FinesService, LoanPolicyService],
  exports: [LoansService, ReservationsService, FinesService, LoanPolicyService],
})
export class CirculationModule {}
