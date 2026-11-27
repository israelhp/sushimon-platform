import { Controller, Get, Inject, Query, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator.js';
import { PRODUCTS_PUBLIC_THROTTLE } from '../common/throttle/app-throttler.guard.js';
import { NoQuery } from './dto/banner-requests.dto.js';
import { StoreBannerListDto } from './dto/banner-responses.dto.js';
import { PublicBannersCacheInterceptor } from './public-banners-cache.interceptor.js';
import { PublicBannersReader } from './public-banners.reader.js';

@ApiTags('banners')
@Public()
@Throttle(PRODUCTS_PUBLIC_THROTTLE)
@Controller('store/banners')
export class PublicBannersController {
  constructor(@Inject(PublicBannersReader) private readonly reader: PublicBannersReader) {}

  @Get()
  @UseInterceptors(PublicBannersCacheInterceptor)
  @ApiOperation({
    operationId: 'listStoreBanners',
    summary: 'Banners activos del Inicio de la tienda (público, solo lectura)',
  })
  @ApiOkResponse({ type: StoreBannerListDto })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  @ApiResponse({ status: 503, description: 'BANNERS_BUSY (reintentable)' })
  async list(@Query() query: NoQuery): Promise<StoreBannerListDto> {
    void query; // sin parámetros: el DTO vacío solo hace que `forbidNonWhitelisted` rechace cualquiera
    return { items: await this.reader.findActiveBanners() };
  }
}
