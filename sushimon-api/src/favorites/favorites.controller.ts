import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Principal } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { CacheControl } from '../common/http/cache-control.js';
import {
  FAVORITES_ADD_THROTTLE,
  FAVORITES_LIST_THROTTLE,
  FAVORITES_REMOVE_THROTTLE,
} from '../common/throttle/app-throttler.guard.js';
import { CustomerFavoritesDto, ListFavoritesQuery, NoQuery } from './dto/favorites.dto.js';
import {
  DEFAULT_FAVORITES_PAGE_SIZE,
  FAVORITES_CACHE_CONTROL,
  FAVORITES_ROUTE,
} from './favorites.constants.js';
import { FavoritesService } from './favorites.service.js';

/**
 * Favoritos del cliente autenticado (F06). Solo JWT de cliente: sin `@RequireStaff` ni MFA (un empleado usa SUS
 * favoritos como cliente). El propietario sale SIEMPRE del JWT; el único parámetro es el id de producto. Sin cuerpo.
 */
@ApiTags('me')
@ApiBearerAuth()
@Controller(FAVORITES_ROUTE)
export class FavoritesController {
  constructor(@Inject(FavoritesService) private readonly favorites: FavoritesService) {}

  @Get()
  @Throttle(FAVORITES_LIST_THROTTLE)
  @CacheControl(FAVORITES_CACHE_CONTROL)
  @ApiOperation({
    operationId: 'listMyFavorites',
    summary: 'Favoritos del cliente autenticado (lista paginada + ids completos)',
  })
  @ApiOkResponse({ type: CustomerFavoritesDto })
  @ApiResponse({ status: 400, description: 'Parámetros de consulta inválidos o desconocidos' })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido o expirado' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  async list(
    @CurrentUser() principal: Principal,
    @Query() query: ListFavoritesQuery,
  ): Promise<CustomerFavoritesDto> {
    const view = await this.favorites.list(principal, {
      page: query.page ?? 1,
      pageSize: query.pageSize ?? DEFAULT_FAVORITES_PAGE_SIZE,
    });
    return {
      ...view,
      items: view.items.map((i) => ({ ...i, addedAt: i.addedAt.toISOString() })),
    };
  }

  @Put(':productId')
  @HttpCode(204)
  @Throttle(FAVORITES_ADD_THROTTLE)
  @CacheControl(FAVORITES_CACHE_CONTROL)
  @ApiOperation({
    operationId: 'addMyFavorite',
    summary: 'Marca un producto como favorito (idempotente)',
  })
  @ApiParam({ name: 'productId', type: String, format: 'uuid' })
  @ApiNoContentResponse({ description: 'El producto es favorito del cliente' })
  @ApiResponse({ status: 400, description: '`productId` no es un UUID' })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido o expirado' })
  @ApiResponse({ status: 404, description: 'PRODUCT_NOT_FOUND' })
  @ApiResponse({ status: 422, description: 'FAVORITES_LIMIT_REACHED' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  @ApiResponse({ status: 503, description: 'CATALOG_UNAVAILABLE' })
  add(
    @CurrentUser() principal: Principal,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    // Lista blanca vacía: cualquier parámetro de consulta => 400 (no se lee).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Query() _query: NoQuery,
  ): Promise<void> {
    return this.favorites.add(principal, productId);
  }

  @Delete(':productId')
  @HttpCode(204)
  @Throttle(FAVORITES_REMOVE_THROTTLE)
  @CacheControl(FAVORITES_CACHE_CONTROL)
  @ApiOperation({
    operationId: 'removeMyFavorite',
    summary: 'Quita un producto de los favoritos (idempotente)',
  })
  @ApiParam({ name: 'productId', type: String, format: 'uuid' })
  @ApiNoContentResponse({ description: 'El producto ya no es favorito del cliente' })
  @ApiResponse({ status: 400, description: '`productId` no es un UUID' })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido o expirado' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  remove(
    @CurrentUser() principal: Principal,
    @Param('productId', new ParseUUIDPipe()) productId: string,
    // Lista blanca vacía: cualquier parámetro de consulta => 400 (no se lee).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    @Query() _query: NoQuery,
  ): Promise<void> {
    return this.favorites.remove(principal, productId);
  }
}
