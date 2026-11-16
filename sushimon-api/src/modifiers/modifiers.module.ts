import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AdminModifiersController } from './admin-modifiers.controller.js';
import { AdminModifiersService } from './admin-modifiers.service.js';
import { ModifierSelectionService } from './modifier-selection.service.js';
import { ModifiersQueryService } from './modifiers-query.service.js';
import { ModifiersRepository } from './modifiers.repository.js';

/**
 * F12. `ModifiersQueryService` (ficha pública de productos) y `ModifierSelectionService` (validador para F19/F20)
 * se exportan. No importa `ProductsModule` (la dependencia es `products → modifiers`): la existencia del producto se
 * comprueba con SQL propio.
 */
@Module({
  imports: [AuditModule],
  controllers: [AdminModifiersController],
  providers: [
    ModifiersRepository,
    ModifiersQueryService,
    AdminModifiersService,
    ModifierSelectionService,
  ],
  exports: [ModifiersQueryService, ModifierSelectionService],
})
export class ModifiersModule {}
