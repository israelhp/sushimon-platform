import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentStaff } from '../auth/current-user.decorator.js';
import { RequireStaff } from '../auth/staff.guard.js';
import type { StaffContext } from '../identity/identity.types.js';
import { DEFAULT_PAGE_SIZE } from '../products/dto/product-requests.dto.js';
import { AdminBranchProductsService } from './admin-branch-products.service.js';
import {
  ListAdminBranchProductsQuery,
  SetBranchProductPricingRequest,
  SetProductAvailabilityRequest,
} from './dto/branch-product-requests.dto.js';
import {
  AdminBranchProductPageDto,
  AdminBranchProductStateDto,
  AdminProductBranchesDto,
} from './dto/branch-product-responses.dto.js';

const UNAUTHORIZED = { status: 401, description: 'Token ausente, inválido o expirado' } as const;
const FORBIDDEN = {
  status: 403,
  description: 'No es personal activo, falta el permiso o la sesión no es aal2',
} as const;
const BUSY = { status: 503, description: 'BRANCH_PRODUCTS_BUSY (reintentable)' } as const;

/**
 * Backoffice de precio y disponibilidad por sucursal (F13): JWT → personal activo con el permiso de CADA operación →
 * aal2 → alcance POR SUCURSAL (se resuelve en el servicio con `canAccess`/`scopeFor`). `no-store` por el middleware de
 * `/v1/admin`.
 */
@ApiTags('branch-products')
@ApiBearerAuth()
@Controller('admin')
export class AdminBranchProductsController {
  constructor(
    @Inject(AdminBranchProductsService) private readonly service: AdminBranchProductsService,
  ) {}

  @Get('branches/:id/products')
  @RequireStaff('catalog.read')
  @ApiOperation({
    operationId: 'listAdminBranchProducts',
    summary: 'Matriz de precio y disponibilidad de los productos de una sucursal (backoffice)',
  })
  @ApiOkResponse({ type: AdminBranchProductPageDto })
  @ApiResponse({ status: 400, description: 'Parámetros de consulta o UUID inválidos' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'BRANCH_NOT_FOUND: no existe o fuera de alcance' })
  listForBranch(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListAdminBranchProductsQuery,
  ): Promise<AdminBranchProductPageDto> {
    return this.service.listForBranch(staff, id, {
      ...(query.q !== undefined ? { q: query.q } : {}),
      ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
      ...(query.available !== undefined ? { available: query.available } : {}),
      ...(query.hasOverride !== undefined ? { hasOverride: query.hasOverride } : {}),
      page: query.page ?? 1,
      pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
    });
  }

  @Get('products/:id/branches')
  @RequireStaff('catalog.read')
  @ApiOperation({
    operationId: 'listAdminProductBranches',
    summary: 'Matriz de precio y disponibilidad de un producto por sucursal (backoffice)',
  })
  @ApiOkResponse({ type: AdminProductBranchesDto })
  @ApiResponse({ status: 400, description: 'UUID inválido' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'PRODUCT_NOT_FOUND' })
  listForProduct(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminProductBranchesDto> {
    return this.service.listForProduct(staff, id);
  }

  @Put('branches/:id/products/:productId/pricing')
  @RequireStaff('catalog.update')
  @ApiOperation({
    operationId: 'setAdminBranchProductPricing',
    summary: 'Fija o elimina el precio de sucursal (override) de un producto',
  })
  @ApiOkResponse({ type: AdminBranchProductStateDto })
  @ApiResponse({ status: 400, description: 'Forma inválida' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'BRANCH_NOT_FOUND o PRODUCT_NOT_FOUND' })
  @ApiResponse({ status: 422, description: 'BRANCH_PRICE_INVALID' })
  @ApiResponse(BUSY)
  setPricing(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() body: SetBranchProductPricingRequest,
  ): Promise<AdminBranchProductStateDto> {
    return this.service.setPricing(staff, id, productId, body);
  }

  @Patch('products/:id/availability')
  @RequireStaff('catalog.manage_availability')
  @ApiOperation({
    operationId: 'setAdminProductAvailability',
    summary: 'Marca un producto como disponible o agotado en una sucursal',
  })
  @ApiOkResponse({ type: AdminBranchProductStateDto })
  @ApiResponse({ status: 400, description: 'Forma inválida' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'BRANCH_NOT_FOUND o PRODUCT_NOT_FOUND' })
  @ApiResponse(BUSY)
  setAvailability(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SetProductAvailabilityRequest,
  ): Promise<AdminBranchProductStateDto> {
    return this.service.setAvailability(staff, id, body);
  }
}
