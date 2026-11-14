import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { BranchesModule } from '../branches/branches.module.js';
import { AdminRolesController, AdminPermissionsController } from './admin-roles.controller.js';
import { AdminStaffController } from './admin-staff.controller.js';
import { RolesService } from './roles.service.js';
import { StaffCommandGuard } from './staff-command-guard.js';
import { StaffCommandsService } from './staff-commands.service.js';
import { StaffQueriesService } from './staff-queries.service.js';
import { StaffRepository } from './staff.repository.js';

/** F03: gestión de personal, roles y permisos. Valida sucursales con `BranchesQueryService` (F07). */
@Module({
  imports: [AuditModule, BranchesModule],
  controllers: [AdminStaffController, AdminRolesController, AdminPermissionsController],
  providers: [
    StaffRepository,
    StaffCommandGuard,
    StaffQueriesService,
    StaffCommandsService,
    RolesService,
  ],
})
export class StaffModule {}
