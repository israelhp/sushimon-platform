import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
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
import {
  AttachProductMediaRequest,
  ReorderProductMediaRequest,
  UpdateProductMediaRequest,
} from './dto/product-media-requests.dto.js';
import { AdminProductMediaDto, AdminProductMediaListDto } from './dto/product-responses.dto.js';
import { ProductMediaService } from './product-media.service.js';

const UNAUTHORIZED = { status: 401, description: 'Token ausente, inválido o expirado' } as const;
const FORBIDDEN = {
  status: 403,
  description:
    'No es personal activo, falta `catalog.update` con alcance global o la sesión no es aal2',
} as const;
const BAD_REQUEST = { status: 400, description: 'UUID o cuerpo inválido' } as const;
const BUSY = { status: 503, description: 'PRODUCTS_BUSY (reintentable)' } as const;

/**
 * Imágenes de producto (F14). JWT -> personal activo con `catalog.update` -> aal2 -> alcance GLOBAL (en el servicio).
 * `PUT .../media/order` es un literal: no choca con `:mediaId` (solo `PATCH`/`DELETE` lo usan). `no-store` por middleware.
 */
@ApiTags('media')
@ApiBearerAuth()
@Controller('admin/products/:id/media')
export class AdminProductMediaController {
  constructor(@Inject(ProductMediaService) private readonly service: ProductMediaService) {}

  @Post()
  @RequireStaff('catalog.update')
  @ApiOperation({
    operationId: 'attachAdminProductMedia',
    summary: 'Adjunta un asset READY a un producto',
  })
  @ApiCreatedResponse({ type: AdminProductMediaDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'PRODUCT_NOT_FOUND o MEDIA_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'MEDIA_ALREADY_ATTACHED' })
  @ApiResponse({ status: 422, description: 'MEDIA_ASSET_NOT_READY o PRODUCT_MEDIA_INVALID' })
  @ApiResponse(BUSY)
  attach(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AttachProductMediaRequest,
  ): Promise<AdminProductMediaDto> {
    return this.service.attach(staff, id, body);
  }

  @Put('order')
  @RequireStaff('catalog.update')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'reorderAdminProductMedia',
    summary: 'Reordena las imágenes de un producto',
  })
  @ApiOkResponse({ type: AdminProductMediaListDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'PRODUCT_NOT_FOUND' })
  @ApiResponse({ status: 422, description: 'MEDIA_REORDER_MISMATCH' })
  @ApiResponse(BUSY)
  reorder(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ReorderProductMediaRequest,
  ): Promise<AdminProductMediaListDto> {
    return this.service.reorder(staff, id, body.orderedIds);
  }

  @Patch(':mediaId')
  @RequireStaff('catalog.update')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'updateAdminProductMedia',
    summary: 'Edita el texto alternativo de una imagen del producto',
  })
  @ApiOkResponse({ type: AdminProductMediaDto })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'PRODUCT_NOT_FOUND o PRODUCT_MEDIA_NOT_FOUND' })
  @ApiResponse({ status: 422, description: 'PRODUCT_MEDIA_INVALID' })
  @ApiResponse(BUSY)
  update(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
    @Body() body: UpdateProductMediaRequest,
  ): Promise<AdminProductMediaDto> {
    return this.service.updateAlt(staff, id, mediaId, body);
  }

  @Delete(':mediaId')
  @RequireStaff('catalog.update')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'detachAdminProductMedia',
    summary: 'Desvincula una imagen del producto (no borra el asset)',
  })
  @ApiNoContentResponse({ description: 'Imagen desvinculada' })
  @ApiResponse(BAD_REQUEST)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'PRODUCT_NOT_FOUND o PRODUCT_MEDIA_NOT_FOUND' })
  @ApiResponse(BUSY)
  async detach(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ): Promise<void> {
    await this.service.detach(staff, id, mediaId);
  }
}
