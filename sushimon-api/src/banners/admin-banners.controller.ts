import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentStaff } from '../auth/current-user.decorator.js';
import { RequireStaff } from '../auth/staff.guard.js';
import { BANNER_WRITE_THROTTLE } from '../common/throttle/app-throttler.guard.js';
import type { StaffContext } from '../identity/identity.types.js';
import { DEFAULT_PAGE_SIZE } from '../products/dto/product-requests.dto.js';
import { AdminBannersService } from './admin-banners.service.js';
import {
  CreateBannerRequest,
  ListAdminBannersQuery,
  ReorderBannersRequest,
  UpdateBannerRequest,
  UpdateBannerStatusRequest,
} from './dto/banner-requests.dto.js';
import {
  AdminBannerDto,
  AdminBannerOrderDto,
  AdminBannerPageDto,
} from './dto/banner-responses.dto.js';

const UNAUTHORIZED = { status: 401, description: 'Token ausente, inválido o expirado' } as const;
const FORBIDDEN = {
  status: 403,
  description:
    'No es personal activo, falta el permiso, la sesión no es aal2 o BANNER_SCOPE_FORBIDDEN',
} as const;
const BUSY = { status: 503, description: 'BANNERS_BUSY (reintentable)' } as const;
const RATE = { status: 429, description: 'RATE_LIMITED' } as const;

/**
 * Backoffice de banners (F16): permiso por método + aal2 (`RequireStaff`); alcance por sucursal en el servicio. La ruta
 * estática `order` se declara ANTES que `:id` para que no se interprete como identificador.
 */
@ApiTags('banners')
@ApiBearerAuth()
@Controller('admin/banners')
export class AdminBannersController {
  constructor(@Inject(AdminBannersService) private readonly service: AdminBannersService) {}

  @Get()
  @RequireStaff('banners.read')
  @ApiOperation({ operationId: 'listAdminBanners', summary: 'Banners del backoffice' })
  @ApiOkResponse({ type: AdminBannerPageDto })
  @ApiResponse({ status: 400, description: 'Parámetros de consulta inválidos' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({
    status: 404,
    description: 'BRANCH_NOT_FOUND: filtro de sucursal fuera de alcance',
  })
  list(
    @CurrentStaff() staff: StaffContext,
    @Query() query: ListAdminBannersQuery,
  ): Promise<AdminBannerPageDto> {
    return this.service.list(staff, {
      ...(query.branchId !== undefined ? { branchId: query.branchId } : {}),
      ...(query.lifecycle !== undefined ? { lifecycle: query.lifecycle } : {}),
      ...(query.q !== undefined ? { q: query.q } : {}),
      ...(query.sort !== undefined ? { sort: query.sort } : {}),
      ...(query.order !== undefined ? { order: query.order } : {}),
      page: query.page ?? 1,
      pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
    });
  }

  @Post()
  @RequireStaff('banners.create')
  @Throttle(BANNER_WRITE_THROTTLE)
  @ApiOperation({ operationId: 'createAdminBanner', summary: 'Crea un banner' })
  @ApiResponse({ status: 201, type: AdminBannerDto })
  @ApiResponse({ status: 400, description: 'Forma inválida' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'BRANCH_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'BANNER_CODE_TAKEN' })
  @ApiResponse({
    status: 422,
    description:
      'BANNER_IMAGE/TRANSLATION/CTA/PERIOD/SCOPE/PROMOTION_INVALID o BANNER_LIMIT_REACHED',
  })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  create(
    @CurrentStaff() staff: StaffContext,
    @Body() body: CreateBannerRequest,
  ): Promise<AdminBannerDto> {
    return this.service.create(staff, body);
  }

  @Put('order')
  @RequireStaff('banners.update')
  @Throttle(BANNER_WRITE_THROTTLE)
  @ApiOperation({
    operationId: 'reorderAdminBanners',
    summary: 'Reordena los banners no vencidos (prioridad atómica)',
  })
  @ApiOkResponse({ type: AdminBannerOrderDto })
  @ApiResponse({ status: 400, description: 'Forma inválida' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 422, description: 'BANNER_REORDER_MISMATCH' })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  reorder(
    @CurrentStaff() staff: StaffContext,
    @Body() body: ReorderBannersRequest,
  ): Promise<AdminBannerOrderDto> {
    return this.service.reorder(staff, body);
  }

  @Get(':id')
  @RequireStaff('banners.read')
  @ApiOperation({ operationId: 'getAdminBanner', summary: 'Detalle administrativo de un banner' })
  @ApiOkResponse({ type: AdminBannerDto })
  @ApiResponse({ status: 400, description: 'UUID inválido' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'BANNER_NOT_FOUND' })
  get(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminBannerDto> {
    return this.service.get(staff, id);
  }

  @Patch(':id')
  @RequireStaff('banners.update')
  @Throttle(BANNER_WRITE_THROTTLE)
  @ApiOperation({
    operationId: 'updateAdminBanner',
    summary: 'Edita un banner (parcial, con concurrencia optimista)',
  })
  @ApiOkResponse({ type: AdminBannerDto })
  @ApiResponse({ status: 400, description: 'Forma inválida' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'BANNER_NOT_FOUND o BRANCH_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'BANNER_VERSION_CONFLICT' })
  @ApiResponse({
    status: 422,
    description: 'BANNER_IMAGE/TRANSLATION/CTA/PERIOD/SCOPE/PROMOTION_INVALID',
  })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  update(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateBannerRequest,
  ): Promise<AdminBannerDto> {
    return this.service.update(staff, id, body);
  }

  @Patch(':id/status')
  @RequireStaff('banners.update')
  @Throttle(BANNER_WRITE_THROTTLE)
  @ApiOperation({
    operationId: 'updateAdminBannerStatus',
    summary: 'Activa o desactiva un banner (idempotente, sin versión)',
  })
  @ApiOkResponse({ type: AdminBannerDto })
  @ApiResponse({ status: 400, description: 'Forma inválida' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'BANNER_NOT_FOUND' })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  updateStatus(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateBannerStatusRequest,
  ): Promise<AdminBannerDto> {
    return this.service.updateStatus(staff, id, body);
  }
}
