import { Module } from '@nestjs/common';
import { DashboardController, ReportsController } from './reports.controller';
import { DashboardService } from './dashboard.service';
import { ReportsService } from './reports.service';

@Module({
  controllers: [DashboardController, ReportsController],
  providers: [DashboardService, ReportsService],
  exports: [DashboardService, ReportsService],
})
export class ReportsModule {}
