import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator.js';
import { PRODUCTS_PUBLIC_THROTTLE } from '../common/throttle/app-throttler.guard.js';
import { CacheControl } from '../common/http/cache-control.js';
import {
  DEFAULT_PAGE_SIZE,
  ListStoreProductsQuery,
  ProductSlugParam,
} from './dto/product-requests.dto.js';
import { PublicProductDetailDto, PublicProductPageDto } from './dto/product-responses.dto.js';
import { notFound } from './product-policy.js';
import { ProductsQueryService } from './products-query.service.js';

/** Caché compartida corta con revalidación; sin `ETag` (spec F11 D6). Solo en respuestas exitosas. */
export const PRODUCTS_PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300';

@ApiTags('products')
@Public()
@Throttle(PRODUCTS_PUBLIC_THROTTLE)
@Controller('store/products')
export class PublicProductsController {
  constructor(@Inject(ProductsQueryService) private readonly products: ProductsQueryService) {}

  @Get()
  @CacheControl(PRODUCTS_PUBLIC_CACHE)
  @ApiOperation({
    operationId: 'listStoreProducts',
    summary: 'Productos públicos visibles (paginado, con búsqueda y filtro por categoría)',
  })
  @ApiOkResponse({ type: PublicProductPageDto })
  @ApiResponse({ status: 400, description: 'Parámetros de consulta inválidos' })
  list(@Query() query: ListStoreProductsQuery): Promise<PublicProductPageDto> {
    return this.products.getPublicList({
      ...(query.categorySlug !== undefined ? { categorySlug: query.categorySlug } : {}),
      ...(query.q !== undefined ? { q: query.q } : {}),
      page: query.page ?? 1,
      pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
    });
  }

  @Get(':slug')
  @CacheControl(PRODUCTS_PUBLIC_CACHE)
  @ApiOperation({ operationId: 'getStoreProduct', summary: 'Ficha pública de un producto visible' })
  @ApiOkResponse({ type: PublicProductDetailDto })
  @ApiResponse({ status: 400, description: 'Slug con forma inválida' })
  @ApiResponse({ status: 404, description: 'PRODUCT_NOT_FOUND' })
  async get(@Param() params: ProductSlugParam): Promise<PublicProductDetailDto> {
    const product = await this.products.findVisibleBySlug(params.slug);
    if (!product) throw notFound();
    return product;
  }
}
