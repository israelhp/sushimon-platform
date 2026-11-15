import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentStaff } from '../auth/current-user.decorator.js';
import { RequireStaff } from '../auth/staff.guard.js';
import type { StaffContext } from '../identity/identity.types.js';
import { DeliverySettingsService } from './delivery-settings.service.js';
import { DeliveryZonesService } from './delivery-zones.service.js';
import {
  CreateDeliveryZoneRequest,
  ListDeliveryZonesQuery,
  UpdateBranchDeliverySettingsRequest,
  UpdateDeliveryZoneRequest,
  UpdateDeliveryZoneStatusRequest,
} from './dto/delivery-zone-requests.dto.js';
import {
  AdminDeliveryZoneDto,
  AdminDeliveryZonePageDto,
  BranchDeliverySettingsDto,
} from './dto/delivery-zone-responses.dto.js';

const UNAUTHORIZED = { status: 401, description: 'Token ausente, inválido o expirado' } as const;
const NOT_FOUND = { status: 404, description: 'No existe o fuera de alcance' } as const;
const BAD_REQUEST = { status: 400, description: 'Forma de la solicitud inválida' } as const;

/**
 * Backoffice de zonas propias (F09). JWT (global) → personal activo con el permiso de CADA operación → aal2. El
 * alcance por sucursal se resuelve en el servicio; fuera de alcance = 404. `no-store` lo aplica el middleware
 * del prefijo `/v1/admin`. Sin DELETE (no hay borrado físico).
 */
@ApiTags('delivery-zones')
@ApiBearerAuth()
@Controller('admin/delivery-zones')
export class AdminDeliveryZonesController {
  constructor(@Inject(DeliveryZonesService) private readonly zones: DeliveryZonesService) {}

  @Get()
  @RequireStaff('branches.read')
  @ApiOperation({
    operationId: 'listAdminDeliveryZones',
    summary: 'Zonas de entrega propias (backoffice, paginado)',
  })
  @ApiOkResponse({ type: AdminDeliveryZonePageDto })
  @ApiResponse({ status: 400, description: 'Parámetros de consulta inválidos' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse({ status: 404, description: '`branchId` inexistente o fuera de alcance' })
  list(
    @CurrentStaff() staff: StaffContext,
    @Query() query: ListDeliveryZonesQuery,
  ): Promise<AdminDeliveryZonePageDto> {
    return this.zones.list(staff, query);
  }

  @Post()
  @RequireStaff('branches.manage_delivery_zones')
  @ApiOperation({
    operationId: 'createAdminDeliveryZone',
    summary: 'Crea una zona de entrega propia',
  })
  @ApiCreatedResponse({ type: AdminDeliveryZoneDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse({ status: 404, description: 'Sucursal inexistente o fuera de alcance' })
  @ApiResponse({ status: 409, description: 'DELIVERY_ZONE_DUPLICATE' })
  @ApiResponse({ status: 422, description: 'MUNICIPALITY_NOT_FOUND' })
  create(
    @CurrentStaff() staff: StaffContext,
    @Body() body: CreateDeliveryZoneRequest,
  ): Promise<AdminDeliveryZoneDto> {
    return this.zones.create(staff, body);
  }

  @Get(':id')
  @RequireStaff('branches.read')
  @ApiOperation({
    operationId: 'getAdminDeliveryZone',
    summary: 'Detalle de una zona de entrega propia',
  })
  @ApiOkResponse({ type: AdminDeliveryZoneDto })
  @ApiResponse({ status: 400, description: 'El identificador no es un UUID' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(NOT_FOUND)
  get(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminDeliveryZoneDto> {
    return this.zones.get(staff, id);
  }

  @Patch(':id')
  @RequireStaff('branches.manage_delivery_zones')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'updateAdminDeliveryZone',
    summary: 'Edita etiqueta y/o tarifa de una zona',
  })
  @ApiOkResponse({ type: AdminDeliveryZoneDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(NOT_FOUND)
  @ApiResponse({
    status: 409,
    description: 'DELIVERY_ZONE_VERSION_CONFLICT o DELIVERY_ZONE_DUPLICATE',
  })
  update(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDeliveryZoneRequest,
  ): Promise<AdminDeliveryZoneDto> {
    return this.zones.update(staff, id, body);
  }

  @Patch(':id/status')
  @RequireStaff('branches.manage_delivery_zones')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'updateAdminDeliveryZoneStatus',
    summary: 'Activa o desactiva una zona (no hay borrado físico)',
  })
  @ApiOkResponse({ type: AdminDeliveryZoneDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(NOT_FOUND)
  setStatus(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateDeliveryZoneStatusRequest,
  ): Promise<AdminDeliveryZoneDto> {
    return this.zones.setStatus(staff, id, body);
  }
}

/** Configuración logística por sucursal (F09 D4). Mismas reglas de seguridad que las zonas. */
@ApiTags('delivery-zones')
@ApiBearerAuth()
@Controller('admin/branches')
export class AdminDeliverySettingsController {
  constructor(
    @Inject(DeliverySettingsService) private readonly settings: DeliverySettingsService,
  ) {}

  @Get(':id/delivery-settings')
  @RequireStaff('branches.read')
  @ApiOperation({
    operationId: 'getAdminBranchDeliverySettings',
    summary: 'Configuración logística de una sucursal',
  })
  @ApiOkResponse({ type: BranchDeliverySettingsDto })
  @ApiResponse({ status: 400, description: 'El identificador no es un UUID' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(NOT_FOUND)
  get(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BranchDeliverySettingsDto> {
    return this.settings.get(staff, id);
  }

  @Patch(':id/delivery-settings')
  @RequireStaff('branches.manage_delivery_zones')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'updateAdminBranchDeliverySettings',
    summary: 'Actualiza los indicadores logísticos de una sucursal',
  })
  @ApiOkResponse({ type: BranchDeliverySettingsDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(NOT_FOUND)
  update(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateBranchDeliverySettingsRequest,
  ): Promise<BranchDeliverySettingsDto> {
    return this.settings.update(staff, id, body);
  }
}
