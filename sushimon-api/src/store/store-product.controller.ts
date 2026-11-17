import { Controller, Get, Inject, Param, Query, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator.js';
import { PRODUCTS_PUBLIC_THROTTLE } from '../common/throttle/app-throttler.guard.js';
import { ProductSlugParam } from '../products/dto/product-requests.dto.js';
import { StoreProductDetailQuery } from './dto/store-requests.dto.js';
import { StoreProductDetailDto } from './dto/store-responses.dto.js';
import { ProductDetailCacheInterceptor } from './store-cache.interceptor.js';
import { StoreProductService } from './store-product.service.js';

/** `GET /v1/store/products/{slug}` (F11/F12), movida aquí en F17 para componer F13 y F15 sin ciclos entre módulos. */
@ApiTags('products')
@Public()
@Throttle(PRODUCTS_PUBLIC_THROTTLE)
@Controller('store/products')
export class StoreProductController {
  constructor(@Inject(StoreProductService) private readonly products: StoreProductService) {}

  @Get(':slug')
  @UseInterceptors(ProductDetailCacheInterceptor)
  @ApiOperation({
    operationId: 'getStoreProduct',
    summary: 'Ficha pública de un producto visible (con oferta de sucursal opcional)',
  })
  @ApiOkResponse({ type: StoreProductDetailDto })
  @ApiResponse({ status: 400, description: 'Slug o `branchId` con forma inválida' })
  @ApiResponse({
    status: 404,
    description:
      'PRODUCT_NOT_FOUND, o BRANCH_NOT_FOUND si se envió `branchId` inexistente/inactiva',
  })
  get(
    @Param() params: ProductSlugParam,
    @Query() query: StoreProductDetailQuery,
  ): Promise<StoreProductDetailDto> {
    return this.products.getDetail(params.slug, query.branchId);
  }
}
