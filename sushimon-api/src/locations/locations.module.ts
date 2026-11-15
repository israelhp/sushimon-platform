import { Module } from '@nestjs/common';
import { LocationsController } from './locations.controller.js';
import { LocationsRepository } from './locations.repository.js';
import { LocationsService } from './locations.service.js';

/** F09: catálogos geográficos públicos (departamentos y municipios). Sin dependencias salvo la base de datos. */
@Module({
  controllers: [LocationsController],
  providers: [LocationsRepository, LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
