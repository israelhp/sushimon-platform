import { Controller, Get, Inject, Query, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator.js';
import { BoundedCacheInterceptor } from '../common/http/bounded-cache.js';
import { PRODUCTS_PUBLIC_THROTTLE } from '../common/throttle/app-throttler.guard.js';
import { StoreBannersQuery } from './dto/banner-requests.dto.js';
import { StoreBannerListDto } from './dto/banner-responses.dto.js';
import { PublicBannersReader } from './public-banners.reader.js';

@ApiTags('banners')
@Public()
@Throttle(PRODUCTS_PUBLIC_THROTTLE)
@Controller('store/banners')
export class PublicBannersController {
  constructor(@Inject(PublicBannersReader) private readonly reader: PublicBannersReader) {}

  @Get()
  @UseInterceptors(BoundedCacheInterceptor)
  @ApiOperation({
    operationId: 'listStoreBanners',
    summary: 'Banners publicados del Inicio de la tienda (público, solo lectura)',
  })
  @ApiOkResponse({ type: StoreBannerListDto })
  @ApiResponse({ status: 400, description: '`branchId` mal formado o `locale` fuera de `es|en`' })
  @ApiResponse({ status: 404, description: 'BRANCH_NOT_FOUND: no existe o está inactiva' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  @ApiResponse({ status: 503, description: 'BANNERS_BUSY (reintentable)' })
  async list(@Query() query: StoreBannersQuery): Promise<StoreBannerListDto> {
    const locale = query.locale ?? 'es';
    const result = await this.reader.findActiveBanners({
      branchId: query.branchId ?? null,
      locale,
    });
    return {
      branchId: query.branchId ?? null,
      locale,
      generatedAt: result.generatedAt,
      nextChangeAt: result.nextChangeAt,
      items: result.items,
    };
  }
}
