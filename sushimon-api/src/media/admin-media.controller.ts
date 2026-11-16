import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
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
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  MEDIA_COMPLETE_THROTTLE,
  MEDIA_DELETE_THROTTLE,
  MEDIA_INTENT_THROTTLE,
} from '../common/throttle/app-throttler.guard.js';
import { CurrentStaff } from '../auth/current-user.decorator.js';
import { RequireStaff } from '../auth/staff.guard.js';
import type { StaffContext } from '../identity/identity.types.js';
import { AdminMediaService } from './admin-media.service.js';
import {
  CompleteMediaUploadRequest,
  CreateMediaUploadIntentRequest,
  ListAdminMediaQuery,
} from './dto/media-requests.dto.js';
import {
  AdminMediaAssetDetailDto,
  AdminMediaAssetDto,
  AdminMediaAssetPageDto,
  AdminMediaUploadIntentDto,
} from './dto/media-responses.dto.js';
import { DEFAULT_PAGE_SIZE } from './media-policy.js';
import { MediaQueryService } from './media-query.service.js';

const UNAUTHORIZED = { status: 401, description: 'Token ausente, inválido o expirado' } as const;
const FORBIDDEN = {
  status: 403,
  description:
    'No es personal activo, falta el permiso (o el alcance global) o la sesión no es aal2',
} as const;
const NOT_FOUND = { status: 404, description: 'MEDIA_NOT_FOUND' } as const;
const BAD_UUID = { status: 400, description: 'UUID o cuerpo inválido' } as const;

/**
 * Biblioteca de medios (F14): JWT -> personal activo con el permiso de CADA operación -> aal2. Lectura: `catalog.read`.
 * Escritura: `catalog.update` con alcance GLOBAL (se comprueba en el servicio). `no-store` por el middleware de `/v1/admin`.
 */
@ApiTags('media')
@ApiBearerAuth()
@Controller('admin/media')
export class AdminMediaController {
  constructor(
    @Inject(AdminMediaService) private readonly commands: AdminMediaService,
    @Inject(MediaQueryService) private readonly queries: MediaQueryService,
  ) {}

  @Post('upload-intents')
  @RequireStaff('catalog.update')
  @Throttle(MEDIA_INTENT_THROTTLE)
  @ApiOperation({
    operationId: 'createAdminMediaUpload',
    summary: 'Autoriza una subida directa a R2 (URL PUT firmada de corta vida)',
  })
  @ApiCreatedResponse({ type: AdminMediaUploadIntentDto, description: 'Intent creado (PENDING)' })
  @ApiOkResponse({ type: AdminMediaUploadIntentDto, description: 'Deduplicado: sin URL de subida' })
  @ApiResponse(BAD_UUID)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({
    status: 422,
    description: 'MEDIA_TYPE_NOT_ALLOWED, MEDIA_TOO_LARGE o MEDIA_PENDING_LIMIT_REACHED',
  })
  @ApiResponse({ status: 503, description: 'MEDIA_STORAGE_UNAVAILABLE o MEDIA_BUSY' })
  async createUpload(
    @CurrentStaff() staff: StaffContext,
    @Body() body: CreateMediaUploadIntentRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AdminMediaUploadIntentDto> {
    const result = await this.commands.createUpload(staff, body);
    res.status(result.deduplicated ? 200 : 201);
    return result;
  }

  @Post('complete')
  @RequireStaff('catalog.update')
  @Throttle(MEDIA_COMPLETE_THROTTLE)
  @HttpCode(200)
  @ApiOperation({
    operationId: 'completeAdminMediaUpload',
    summary: 'Confirma una subida: verifica el objeto en R2 y deja el asset READY',
  })
  @ApiOkResponse({ type: AdminMediaAssetDto })
  @ApiResponse(BAD_UUID)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse(NOT_FOUND)
  @ApiResponse({ status: 410, description: 'MEDIA_UPLOAD_EXPIRED' })
  @ApiResponse({ status: 422, description: 'MEDIA_OBJECT_MISSING o MEDIA_CONTENT_MISMATCH' })
  @ApiResponse({ status: 503, description: 'MEDIA_STORAGE_UNAVAILABLE o MEDIA_BUSY' })
  complete(
    @CurrentStaff() staff: StaffContext,
    @Body() body: CompleteMediaUploadRequest,
  ): Promise<AdminMediaAssetDto> {
    return this.commands.complete(staff, body.assetId);
  }

  @Get()
  @RequireStaff('catalog.read')
  @ApiOperation({ operationId: 'listAdminMedia', summary: 'Biblioteca de medios (paginada)' })
  @ApiOkResponse({ type: AdminMediaAssetPageDto })
  @ApiResponse({ status: 400, description: 'Parámetros de consulta inválidos' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  list(@Query() query: ListAdminMediaQuery): Promise<AdminMediaAssetPageDto> {
    return this.queries.list({
      ...(query.kind !== undefined ? { kind: query.kind } : {}),
      ...(query.status !== undefined ? { status: query.status } : {}),
      ...(query.unreferenced !== undefined ? { unreferenced: query.unreferenced } : {}),
      page: query.page ?? 1,
      pageSize: query.pageSize ?? DEFAULT_PAGE_SIZE,
    });
  }

  @Get(':id')
  @RequireStaff('catalog.read')
  @ApiOperation({ operationId: 'getAdminMedia', summary: 'Detalle de un asset y dónde se usa' })
  @ApiOkResponse({ type: AdminMediaAssetDetailDto })
  @ApiResponse(BAD_UUID)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse(NOT_FOUND)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminMediaAssetDetailDto> {
    return this.queries.get(id);
  }

  @Delete(':id')
  @RequireStaff('catalog.update')
  @Throttle(MEDIA_DELETE_THROTTLE)
  @HttpCode(204)
  @ApiOperation({
    operationId: 'deleteAdminMedia',
    summary: 'Elimina un asset que ningún producto usa (y su objeto en R2)',
  })
  @ApiNoContentResponse({ description: 'Asset eliminado' })
  @ApiResponse(BAD_UUID)
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse(NOT_FOUND)
  @ApiResponse({ status: 409, description: 'MEDIA_IN_USE' })
  @ApiResponse({ status: 503, description: 'MEDIA_STORAGE_UNAVAILABLE o MEDIA_BUSY' })
  async remove(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.commands.remove(staff, id);
  }
}
