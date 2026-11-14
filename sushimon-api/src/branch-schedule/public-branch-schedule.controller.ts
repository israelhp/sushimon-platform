import { Controller, Get, Inject, Param, ParseUUIDPipe, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator.js';
import { CacheControl, PUBLIC_CACHE_CONTROL } from '../common/http/cache-control.js';
import { AvailabilityCacheInterceptor } from './availability-cache.interceptor.js';
import { BranchAvailabilityService } from './branch-availability.service.js';
import { BranchHoursService } from './branch-hours.service.js';
import {
  BranchAvailabilityDto,
  PublicBranchHoursDto,
} from './dto/branch-schedule-responses.dto.js';

const BAD_UUID = { status: 400, description: 'El identificador no es un UUID' } as const;
const NOT_ACTIVE = { status: 404, description: 'No existe o no está activa' } as const;

/** Públicos de F08. Solo informativos: el checkout NUNCA se apoya en estas respuestas cacheadas. */
@ApiTags('branch-schedule')
@Public()
@Controller('branches')
export class PublicBranchScheduleController {
  constructor(
    @Inject(BranchHoursService) private readonly hours: BranchHoursService,
    @Inject(BranchAvailabilityService) private readonly availability: BranchAvailabilityService,
  ) {}

  @Get(':id/hours')
  @CacheControl(PUBLIC_CACHE_CONTROL)
  @ApiOperation({
    operationId: 'getBranchHours',
    summary: 'Horario semanal público y próximos cierres de una sucursal activa',
  })
  @ApiOkResponse({ type: PublicBranchHoursDto })
  @ApiResponse(BAD_UUID)
  @ApiResponse(NOT_ACTIVE)
  getHours(@Param('id', ParseUUIDPipe) id: string): Promise<PublicBranchHoursDto> {
    return this.hours.getPublic(id);
  }

  @Get(':id/availability')
  @UseInterceptors(AvailabilityCacheInterceptor)
  @ApiOperation({
    operationId: 'getBranchAvailability',
    summary: 'Disponibilidad operativa actual de una sucursal activa',
  })
  @ApiOkResponse({ type: BranchAvailabilityDto })
  @ApiResponse(BAD_UUID)
  @ApiResponse(NOT_ACTIVE)
  getAvailability(@Param('id', ParseUUIDPipe) id: string): Promise<BranchAvailabilityDto> {
    return this.availability.getPublic(id);
  }
}
