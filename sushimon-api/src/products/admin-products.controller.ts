import {
  Body,
  Controller,
  Delete,
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
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentStaff } from '../auth/current-user.decorator.js';
import { RequireStaff } from '../auth/staff.guard.js';
import type { StaffContext } from '../identity/identity.types.js';
import { AdminProductsService } from './admin-products.service.js';
import {
  CreateProductRequest,
  DEFAULT_PAGE_SIZE,
  ListAdminProductsQuery,
  UpdateProductRequest,
} from './dto/product-requests.dto.js';
import { AdminProductDto, AdminProductPageDto } from './dto/product-responses.dto.js';
import { ProductsQueryService } from './products-query.service.js';

const UNAUTHORIZED = { status: 401, description: 'Token ausente, inválido o expirado' } as const;
const BUSY = { status: 503, description: 'PRODUCTS_BUSY (reintentable)' } as const;

/**
 * Backoffice de productos: JWT → personal activo con el permiso de CADA operación → aal2. Lectura: `catalog.read`
 * (cualquier alcance). Escrituras: `catalog.create`/`catalog.update` con alcance GLOBAL (se comprueba en el servicio).
 * Borrado físico solo sin usos (ADR-0035); desactivar sigue siendo la alternativa. La respuesta lleva `no-store` (middleware de `/v1/admin`).
 */
@ApiTags('products')
@ApiBearerAuth()
@Controller('admin/products')
export class AdminProductsController {
  constructor(
    @Inject(ProductsQueryService) private readonly queries: ProductsQueryService,
    @Inject(AdminProductsService) private readonly commands: AdminProductsService,
  ) {}

  @Get()
  @RequireStaff('catalog.read')
  @ApiOperation({
    operationId: 'listAdminProducts',
    summary: 'Productos del backoffice (paginado, activos e inactivos)',
  })
  @ApiOkResponse({ type: AdminProductPageDto })
  @ApiResponse({ status: 400, description: 'Parámetros de consulta inválidos' })
  @ApiResponse(UNAUTHORIZED)
  list(@Query() query: ListAdminProductsQuery): Promise<AdminProductPageDto> {
    return this.queries.listAdmin({
      ...(query.q !== undefined ? { q: query.q } : {}),
      ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
      ...(query.active !== undefined ? { active: query.active } : {}),
      sort: query.sort ?? 'name',
      order: query.order ?? 'asc',
      page: query.page ?? 1,
      pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
    });
  }

  @Post()
  @RequireStaff('catalog.create')
  @ApiOperation({ operationId: 'createAdminProduct', summary: 'Crea un producto' })
  @ApiCreatedResponse({ type: AdminProductDto })
  @ApiResponse({ status: 400, description: 'Datos inválidos o campos no permitidos' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse({ status: 409, description: 'PRODUCT_SLUG_TAKEN o PRODUCT_SKU_TAKEN' })
  @ApiResponse({
    status: 422,
    description: 'PRODUCT_CATEGORY_INVALID o PRODUCT_MEDIA_INVALID',
  })
  @ApiResponse(BUSY)
  create(
    @CurrentStaff() staff: StaffContext,
    @Body() body: CreateProductRequest,
  ): Promise<AdminProductDto> {
    return this.commands.create(staff, body);
  }

  @Get(':id')
  @RequireStaff('catalog.read')
  @ApiOperation({
    operationId: 'getAdminProduct',
    summary: 'Detalle administrativo de un producto',
  })
  @ApiOkResponse({ type: AdminProductDto })
  @ApiResponse({ status: 400, description: 'UUID inválido' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse({ status: 404, description: 'PRODUCT_NOT_FOUND' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminProductDto> {
    return this.queries.getAdmin(id);
  }

  @Patch(':id')
  @RequireStaff('catalog.update')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'updateAdminProduct',
    summary: 'Edita un producto (incluye activar/desactivar y reemplazar imágenes)',
  })
  @ApiOkResponse({ type: AdminProductDto })
  @ApiResponse({ status: 400, description: 'Datos inválidos, cuerpo vacío o campos no permitidos' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse({ status: 404, description: 'PRODUCT_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'PRODUCT_SLUG_TAKEN o PRODUCT_SKU_TAKEN' })
  @ApiResponse({
    status: 422,
    description: 'PRODUCT_CATEGORY_INVALID o PRODUCT_MEDIA_INVALID',
  })
  @ApiResponse(BUSY)
  update(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateProductRequest,
  ): Promise<AdminProductDto> {
    return this.commands.update(staff, id, body);
  }

  @Delete(':id')
  @RequireStaff('catalog.update')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'deleteAdminProduct',
    summary: 'Elimina físicamente un producto que no tiene pedidos, promociones ni banners',
  })
  @ApiNoContentResponse({ description: 'Producto eliminado. Sin cuerpo' })
  @ApiResponse({ status: 400, description: 'id no es un UUID' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse({ status: 404, description: 'PRODUCT_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description: 'PRODUCT_IN_USE (usage: orders, promotions, banners)',
  })
  @ApiResponse(BUSY)
  async remove(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.commands.remove(staff, id);
  }
}
