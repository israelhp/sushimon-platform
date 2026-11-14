import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AdminBranchesController } from './admin-branches.controller.js';
import { BranchesCommandsService } from './branches-commands.service.js';
import { BranchesQueryService } from './branches-query.service.js';
import { BranchesRepository } from './branches.repository.js';
import { PublicBranchesController } from './public-branches.controller.js';

/** F07. `BranchesQueryService` se exporta para F08/F09/F13/F17. */
@Module({
  imports: [AuditModule],
  controllers: [PublicBranchesController, AdminBranchesController],
  providers: [BranchesRepository, BranchesQueryService, BranchesCommandsService],
  exports: [BranchesQueryService],
})
export class BranchesModule {}
