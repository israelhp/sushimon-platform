import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator.js';
import { CacheControl } from '../common/http/cache-control.js';
import { CategoriesQueryService } from './categories-query.service.js';
import { PublicCategoryTreeDto } from './dto/category-responses.dto.js';

/** Caché compartida corta con revalidación; sin `ETag` (spec F10 D7). Solo en respuestas exitosas. */
export const CATEGORIES_PUBLIC_CACHE = 'public, max-age=60, stale-while-revalidate=300';

@ApiTags('categories')
@Public()
@Controller('store/categories')
export class PublicCategoriesController {
  constructor(
    @Inject(CategoriesQueryService) private readonly categories: CategoriesQueryService,
  ) {}

  @Get()
  @CacheControl(CATEGORIES_PUBLIC_CACHE)
  @ApiOperation({
    operationId: 'listStoreCategories',
    summary: 'Árbol público de categorías visibles',
  })
  @ApiOkResponse({ type: PublicCategoryTreeDto })
  async list(): Promise<PublicCategoryTreeDto> {
    return { items: await this.categories.findVisibleTree() };
  }
}
