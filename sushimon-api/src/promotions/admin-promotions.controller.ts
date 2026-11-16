import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentStaff } from '../auth/current-user.decorator.js';
import { RequireStaff } from '../auth/staff.guard.js';
import { PROMOTION_WRITE_THROTTLE } from '../common/throttle/app-throttler.guard.js';
import type { StaffContext } from '../identity/identity.types.js';
import { DEFAULT_PAGE_SIZE } from '../products/dto/product-requests.dto.js';
import { AdminPromotionsService } from './admin-promotions.service.js';
import {
  CreatePromotionRequest,
  ListAdminPromotionsQuery,
  UpdatePromotionRequest,
  UpdatePromotionStatusRequest,
} from './dto/promotion-requests.dto.js';
import { AdminPromotionDto, AdminPromotionPageDto } from './dto/promotion-responses.dto.js';

const UNAUTHORIZED = { status: 401, description: 'Token ausente, inválido o expirado' } as const;
const FORBIDDEN = {
  status: 403,
  description:
    'No es personal activo, falta el permiso, la sesión no es aal2 o PROMOTION_SCOPE_FORBIDDEN',
} as const;
const BUSY = { status: 503, description: 'PROMOTIONS_BUSY (reintentable)' } as const;
const RATE = { status: 429, description: 'RATE_LIMITED' } as const;

/** Backoffice de promociones (F15): permiso por método + aal2 (`RequireStaff`); alcance por sucursal en el servicio. */
@ApiTags('promotions')
@ApiBearerAuth()
@Controller('admin/promotions')
export class AdminPromotionsController {
  constructor(@Inject(AdminPromotionsService) private readonly service: AdminPromotionsService) {}

  @Get()
  @RequireStaff('promotions.read')
  @ApiOperation({ operationId: 'listAdminPromotions', summary: 'Promociones del backoffice' })
  @ApiOkResponse({ type: AdminPromotionPageDto })
  @ApiResponse({ status: 400, description: 'Parámetros de consulta inválidos' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({
    status: 404,
    description: 'BRANCH_NOT_FOUND: filtro de sucursal fuera de alcance',
  })
  list(
    @CurrentStaff() staff: StaffContext,
    @Query() query: ListAdminPromotionsQuery,
  ): Promise<AdminPromotionPageDto> {
    return this.service.list(staff, {
      ...(query.branchId !== undefined ? { branchId: query.branchId } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.kind !== undefined ? { kind: query.kind } : {}),
      ...(query.from !== undefined ? { from: query.from } : {}),
      ...(query.to !== undefined ? { to: query.to } : {}),
      ...(query.q !== undefined ? { q: query.q } : {}),
      ...(query.sort !== undefined ? { sort: query.sort } : {}),
      ...(query.order !== undefined ? { order: query.order } : {}),
      page: query.page ?? 1,
      pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
    });
  }

  @Post()
  @RequireStaff('promotions.create')
  @Throttle(PROMOTION_WRITE_THROTTLE)
  @ApiOperation({ operationId: 'createAdminPromotion', summary: 'Crea una promoción o cupón' })
  @ApiResponse({ status: 201, type: AdminPromotionDto })
  @ApiResponse({ status: 400, description: 'Forma inválida' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'BRANCH_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'PROMOTION_CODE_TAKEN' })
  @ApiResponse({ status: 422, description: 'PROMOTION_VALUE/PERIOD/SCHEDULE/SCOPE_INVALID' })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  create(
    @CurrentStaff() staff: StaffContext,
    @Body() body: CreatePromotionRequest,
  ): Promise<AdminPromotionDto> {
    return this.service.create(staff, body);
  }

  @Get(':id')
  @RequireStaff('promotions.read')
  @ApiOperation({
    operationId: 'getAdminPromotion',
    summary: 'Detalle administrativo de una promoción',
  })
  @ApiOkResponse({ type: AdminPromotionDto })
  @ApiResponse({ status: 400, description: 'UUID inválido' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'PROMOTION_NOT_FOUND' })
  get(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminPromotionDto> {
    return this.service.get(staff, id);
  }

  @Patch(':id')
  @RequireStaff('promotions.update')
  @Throttle(PROMOTION_WRITE_THROTTLE)
  @ApiOperation({ operationId: 'updateAdminPromotion', summary: 'Edita una promoción (parcial)' })
  @ApiOkResponse({ type: AdminPromotionDto })
  @ApiResponse({ status: 400, description: 'Forma inválida' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'PROMOTION_NOT_FOUND o BRANCH_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'PROMOTION_VERSION_CONFLICT o PROMOTION_CODE_TAKEN' })
  @ApiResponse({ status: 422, description: 'PROMOTION_VALUE/PERIOD/SCHEDULE/SCOPE_INVALID' })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  update(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePromotionRequest,
  ): Promise<AdminPromotionDto> {
    return this.service.update(staff, id, body);
  }

  @Patch(':id/status')
  @RequireStaff('promotions.update')
  @Throttle(PROMOTION_WRITE_THROTTLE)
  @ApiOperation({
    operationId: 'updateAdminPromotionStatus',
    summary: 'Activa o desactiva una promoción (idempotente)',
  })
  @ApiOkResponse({ type: AdminPromotionDto })
  @ApiResponse({ status: 400, description: 'Forma inválida' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'PROMOTION_NOT_FOUND' })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  updateStatus(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePromotionStatusRequest,
  ): Promise<AdminPromotionDto> {
    return this.service.updateStatus(staff, id, body);
  }
}
