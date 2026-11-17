import { Controller, Get, Inject, Query, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator.js';
import { PRODUCTS_PUBLIC_THROTTLE } from '../common/throttle/app-throttler.guard.js';
import { StorePromotionsQuery } from './dto/promotion-requests.dto.js';
import { StorePromotionListDto } from './dto/promotion-responses.dto.js';
import { PromotionsCacheInterceptor } from './promotions-cache.js';
import { PublicPromotionsService } from './public-promotions.service.js';

@ApiTags('promotions')
@Public()
@Throttle(PRODUCTS_PUBLIC_THROTTLE)
@Controller('store/promotions')
export class PublicPromotionsController {
  constructor(@Inject(PublicPromotionsService) private readonly service: PublicPromotionsService) {}

  @Get()
  @UseInterceptors(PromotionsCacheInterceptor)
  @ApiOperation({
    operationId: 'listStorePromotions',
    summary: 'Promociones y Happy Hour vigentes o próximas de una sucursal (público, informativo)',
  })
  @ApiOkResponse({ type: StorePromotionListDto })
  @ApiResponse({
    status: 400,
    description: '`branchId` ausente o mal formado, o `state` desconocido',
  })
  @ApiResponse({ status: 404, description: 'BRANCH_NOT_FOUND: no existe o está inactiva' })
  @ApiResponse({ status: 429, description: 'RATE_LIMITED' })
  list(@Query() query: StorePromotionsQuery): Promise<StorePromotionListDto> {
    return this.service.list(query.branchId, query.state ?? 'live', {
      ...(query.compact === true ? { compact: true } : {}),
    });
  }
}
