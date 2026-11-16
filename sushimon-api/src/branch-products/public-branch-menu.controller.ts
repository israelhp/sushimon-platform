import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator.js';
import { CacheControl } from '../common/http/cache-control.js';
import { PRODUCTS_PUBLIC_THROTTLE } from '../common/throttle/app-throttler.guard.js';
import { BranchMenuQueryService } from './branch-menu-query.service.js';
import { StoreBranchMenuQuery } from './dto/branch-product-requests.dto.js';
import { StoreBranchMenuDto } from './dto/branch-product-responses.dto.js';

/** Caché compartida corta SIN `stale-while-revalidate` ni `ETag` (spec F13 D4/D5). Solo en respuestas exitosas. */
export const BRANCH_MENU_CACHE = 'public, max-age=15';

@ApiTags('branch-products')
@Public()
@Throttle(PRODUCTS_PUBLIC_THROTTLE)
@Controller('store/menu')
export class PublicBranchMenuController {
  constructor(@Inject(BranchMenuQueryService) private readonly menu: BranchMenuQueryService) {}

  @Get()
  @CacheControl(BRANCH_MENU_CACHE)
  @ApiOperation({
    operationId: 'getStoreBranchMenu',
    summary:
      'Precio efectivo y disponibilidad por sucursal de los productos visibles (overlay del menú)',
  })
  @ApiOkResponse({ type: StoreBranchMenuDto })
  @ApiResponse({ status: 400, description: '`branchId` ausente o que no es un UUID' })
  @ApiResponse({ status: 404, description: 'BRANCH_NOT_FOUND: no existe o está inactiva' })
  get(@Query() query: StoreBranchMenuQuery): Promise<StoreBranchMenuDto> {
    return this.menu.getMenu(query.branchId);
  }
}
