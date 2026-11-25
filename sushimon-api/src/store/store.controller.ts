import { Controller, Get, Inject, Query, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator.js';
import {
  PRODUCTS_PUBLIC_THROTTLE,
  STORE_SEARCH_THROTTLE,
} from '../common/throttle/app-throttler.guard.js';
import { StoreBootstrapQuery, StoreMenuQuery, StoreSearchQuery } from './dto/store-requests.dto.js';
import {
  StoreBootstrapDto,
  StoreBranchMenuDto,
  StoreSearchPageDto,
} from './dto/store-responses.dto.js';
import { StoreBootstrapService } from './store-bootstrap.service.js';
import { StoreCacheInterceptor } from './store-cache.interceptor.js';
import { StoreCatalogService } from './store-catalog.service.js';
import { SEARCH_DEFAULT_PAGE_SIZE, MENU_MAX_PAGE_SIZE } from './store-policy.js';

/**
 * Agregados públicos de la tienda (F17, ADR-0023): Inicio, menú paginado y búsqueda. Controlador delgado: toda la
 * composición está en los servicios. Cada ruta tiene su propio contador de 60/min por IP (el guard cuenta por
 * clase + método).
 */
@ApiTags('store')
@Public()
@Throttle(PRODUCTS_PUBLIC_THROTTLE)
@Controller('store')
export class StoreController {
  constructor(
    @Inject(StoreBootstrapService) private readonly bootstrap: StoreBootstrapService,
    @Inject(StoreCatalogService) private readonly catalog: StoreCatalogService,
  ) {}

  @Get('bootstrap')
  @UseInterceptors(StoreCacheInterceptor)
  @ApiOperation({
    operationId: 'getStoreBootstrap',
    summary: 'Agregado de arranque del Inicio por sucursal (público, acotado)',
  })
  @ApiOkResponse({ type: StoreBootstrapDto })
  @ApiResponse({
    status: 400,
    description: '`branchId` mal formado o parámetros desconocidos (p. ej. `locale`, retirado)',
  })
  @ApiResponse({ status: 404, description: 'BRANCH_NOT_FOUND: no existe o está inactiva' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  @ApiResponse({ status: 503, description: 'STORE_BUSY (reintentable)' })
  getBootstrap(@Query() query: StoreBootstrapQuery): Promise<StoreBootstrapDto> {
    return this.bootstrap.getBootstrap({
      ...(query.branchId !== undefined ? { branchId: query.branchId } : {}),
    });
  }

  @Get('menu')
  @UseInterceptors(StoreCacheInterceptor)
  @ApiOperation({
    operationId: 'getStoreBranchMenu',
    summary:
      'Menú público por sucursal en tarjetas (precio efectivo, disponibilidad e info promocional), paginado',
  })
  @ApiOkResponse({ type: StoreBranchMenuDto })
  @ApiResponse({
    status: 400,
    description:
      '`branchId` mal formado, `available=true` sin `branchId`, orden o paginación inválidos',
  })
  @ApiResponse({ status: 404, description: 'BRANCH_NOT_FOUND: no existe o está inactiva' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  @ApiResponse({ status: 503, description: 'STORE_BUSY (reintentable)' })
  getMenu(@Query() query: StoreMenuQuery): Promise<StoreBranchMenuDto> {
    return this.catalog.menu({
      ...(query.branchId !== undefined ? { branchId: query.branchId } : {}),
      ...(query.categorySlug !== undefined ? { categorySlug: query.categorySlug } : {}),
      ...(query.available !== undefined ? { available: query.available } : {}),
      sort: query.sort ?? 'menu',
      order: query.order ?? 'asc',
      page: query.page ?? 1,
      pageSize: query.pageSize ?? MENU_MAX_PAGE_SIZE,
    });
  }

  @Get('search')
  @Throttle(STORE_SEARCH_THROTTLE)
  @UseInterceptors(StoreCacheInterceptor)
  @ApiOperation({
    operationId: 'searchStoreProducts',
    summary: 'Búsqueda pública de productos del menú (paginada y acotada)',
  })
  @ApiOkResponse({ type: StoreSearchPageDto })
  @ApiResponse({
    status: 400,
    description:
      '`q` ausente, de longitud inválida o con caracteres no permitidos; `branchId` mal formado; `available=true` sin `branchId`; paginación fuera de rango',
  })
  @ApiResponse({ status: 404, description: 'BRANCH_NOT_FOUND: no existe o está inactiva' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  @ApiResponse({ status: 503, description: 'STORE_BUSY (reintentable)' })
  search(@Query() query: StoreSearchQuery): Promise<StoreSearchPageDto> {
    return this.catalog.search({
      q: query.q,
      ...(query.branchId !== undefined ? { branchId: query.branchId } : {}),
      ...(query.categorySlug !== undefined ? { categorySlug: query.categorySlug } : {}),
      ...(query.available !== undefined ? { available: query.available } : {}),
      page: query.page ?? 1,
      pageSize: query.pageSize ?? SEARCH_DEFAULT_PAGE_SIZE,
    });
  }
}
