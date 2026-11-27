import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentStaff } from '../auth/current-user.decorator.js';
import { RequireStaff } from '../auth/staff.guard.js';
import { BANNER_WRITE_THROTTLE } from '../common/throttle/app-throttler.guard.js';
import type { StaffContext } from '../identity/identity.types.js';
import { AdminBannersService } from './admin-banners.service.js';
import {
  CreateBannerRequest,
  DeleteBannerQuery,
  NoQuery,
  UpdateBannerRequest,
} from './dto/banner-requests.dto.js';
import { AdminBannerDto, AdminBannerListDto } from './dto/banner-responses.dto.js';

const UNAUTHORIZED = { status: 401, description: 'Token ausente, inválido o expirado' } as const;
const FORBIDDEN = {
  status: 403,
  description: 'No es personal activo, falta el permiso con alcance global o la sesión no es aal2',
} as const;
const BUSY = { status: 503, description: 'BANNERS_BUSY (reintentable)' } as const;
const RATE = { status: 429, description: 'RATE_LIMITED' } as const;

/** Backoffice de banners (F16 simplificado, ADR-0033): permiso por método + aal2 (`RequireStaff`); alcance GLOBAL en el servicio. */
@ApiTags('banners')
@ApiBearerAuth()
@Controller('admin/banners')
export class AdminBannersController {
  constructor(@Inject(AdminBannersService) private readonly service: AdminBannersService) {}

  @Get()
  @RequireStaff('banners.read')
  @ApiOperation({
    operationId: 'listAdminBanners',
    summary: 'Banners del backoffice (todos, activos e inactivos; máx. 5)',
  })
  @ApiOkResponse({ type: AdminBannerListDto })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse(BUSY)
  list(@CurrentStaff() staff: StaffContext, @Query() query: NoQuery): Promise<AdminBannerListDto> {
    void query; // sin parámetros: el DTO vacío solo hace que `forbidNonWhitelisted` rechace cualquiera
    return this.service.list(staff);
  }

  @Post()
  @RequireStaff('banners.create')
  @Throttle(BANNER_WRITE_THROTTLE)
  @ApiOperation({
    operationId: 'createAdminBanner',
    summary: 'Crea un banner (imagen + texto alternativo)',
  })
  @ApiResponse({ status: 201, type: AdminBannerDto })
  @ApiResponse({ status: 400, description: 'Forma inválida o `imageAlt` fuera de 1..120' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 409, description: 'BANNER_LIMIT_REACHED: ya existen 5 banners' })
  @ApiResponse({ status: 422, description: 'BANNER_IMAGE_INVALID o BANNER_ALT_INVALID' })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  create(
    @CurrentStaff() staff: StaffContext,
    @Body() body: CreateBannerRequest,
  ): Promise<AdminBannerDto> {
    return this.service.create(staff, body);
  }

  @Get(':id')
  @RequireStaff('banners.read')
  @ApiOperation({ operationId: 'getAdminBanner', summary: 'Detalle administrativo de un banner' })
  @ApiOkResponse({ type: AdminBannerDto })
  @ApiResponse({ status: 400, description: 'UUID inválido' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'BANNER_NOT_FOUND' })
  get(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AdminBannerDto> {
    return this.service.get(staff, id);
  }

  @Patch(':id')
  @RequireStaff('banners.update')
  @Throttle(BANNER_WRITE_THROTTLE)
  @ApiOperation({
    operationId: 'updateAdminBanner',
    summary: 'Edita un banner (imagen, texto alternativo, activo; concurrencia optimista)',
  })
  @ApiOkResponse({ type: AdminBannerDto })
  @ApiResponse({ status: 400, description: 'Forma inválida' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'BANNER_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'BANNER_VERSION_CONFLICT' })
  @ApiResponse({ status: 422, description: 'BANNER_IMAGE_INVALID o BANNER_ALT_INVALID' })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  update(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateBannerRequest,
  ): Promise<AdminBannerDto> {
    return this.service.update(staff, id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireStaff('banners.update')
  @Throttle(BANNER_WRITE_THROTTLE)
  @ApiOperation({
    operationId: 'deleteAdminBanner',
    summary: 'Elimina un banner (borrado físico) y libera su imagen',
  })
  @ApiResponse({ status: 204, description: 'Banner eliminado (sin cuerpo)' })
  @ApiResponse({
    status: 400,
    description: 'UUID mal formado o `expectedVersion` ausente/no entero',
  })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse(FORBIDDEN)
  @ApiResponse({ status: 404, description: 'BANNER_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'BANNER_VERSION_CONFLICT' })
  @ApiResponse(RATE)
  @ApiResponse(BUSY)
  remove(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: DeleteBannerQuery,
  ): Promise<void> {
    return this.service.remove(staff, id, query.expectedVersion);
  }
}
