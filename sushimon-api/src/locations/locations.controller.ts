import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator.js';
import { CacheControl } from '../common/http/cache-control.js';
import {
  DepartmentListDto,
  ListMunicipalitiesQuery,
  MunicipalityListDto,
} from './dto/location-responses.dto.js';
import { LocationsService } from './locations.service.js';

/** Catálogo de solo lectura que cambia por migración: caché pública larga, SOLO en 2xx (errores `no-store`). */
export const LOCATIONS_CACHE_CONTROL =
  'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400';

@ApiTags('locations')
@Public()
@Controller('locations')
export class LocationsController {
  constructor(@Inject(LocationsService) private readonly locations: LocationsService) {}

  @Get('departments')
  @CacheControl(LOCATIONS_CACHE_CONTROL)
  @ApiOperation({
    operationId: 'listLocationDepartments',
    summary: 'Departamentos de Guatemala (catálogo público)',
  })
  @ApiOkResponse({ type: DepartmentListDto })
  listDepartments(): Promise<DepartmentListDto> {
    return this.locations.listDepartments();
  }

  @Get('municipalities')
  @CacheControl(LOCATIONS_CACHE_CONTROL)
  @ApiOperation({
    operationId: 'listLocationMunicipalities',
    summary: 'Municipios de un departamento (catálogo público)',
  })
  @ApiOkResponse({ type: MunicipalityListDto })
  @ApiResponse({ status: 400, description: '`departmentId` ausente o no es un UUID' })
  @ApiResponse({ status: 404, description: 'DEPARTMENT_NOT_FOUND' })
  listMunicipalities(@Query() query: ListMunicipalitiesQuery): Promise<MunicipalityListDto> {
    return this.locations.listMunicipalities(query.departmentId);
  }
}
