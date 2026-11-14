import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module.js';
import { BranchesModule } from '../branches/branches.module.js';
import type { Env } from '../config/env.js';
import { AdminBranchScheduleController } from './admin-branch-schedule.controller.js';
import { BranchAvailabilityService } from './branch-availability.service.js';
import { BRANCH_AVAILABILITY_PORT } from './branch-availability.port.js';
import { BranchClosuresService } from './branch-closures.service.js';
import { BranchHoursService } from './branch-hours.service.js';
import { BranchScheduleRepository } from './branch-schedule.repository.js';
import { BUSINESS_TIMEZONE, CLOCK, SystemClock } from './clock.js';
import { PublicBranchScheduleController } from './public-branch-schedule.controller.js';

/**
 * F08: horarios semanales, cierres extraordinarios y motor único de disponibilidad. Exporta el puerto
 * `BRANCH_AVAILABILITY_PORT` (y su implementación) para checkout/pedidos (F19/F20). F07 no depende de F08.
 */
@Module({
  imports: [AuditModule, BranchesModule],
  controllers: [PublicBranchScheduleController, AdminBranchScheduleController],
  providers: [
    BranchScheduleRepository,
    BranchHoursService,
    BranchClosuresService,
    BranchAvailabilityService,
    { provide: BRANCH_AVAILABILITY_PORT, useExisting: BranchAvailabilityService },
    { provide: CLOCK, useClass: SystemClock },
    {
      provide: BUSINESS_TIMEZONE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): string =>
        config.get('BUSINESS_TIMEZONE', { infer: true }),
    },
  ],
  exports: [BRANCH_AVAILABILITY_PORT, BranchAvailabilityService],
})
export class BranchScheduleModule {}
