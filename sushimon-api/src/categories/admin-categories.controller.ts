import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentStaff } from '../auth/current-user.decorator.js';
import { RequireStaff } from '../auth/staff.guard.js';
import type { StaffContext } from '../identity/identity.types.js';
import { AdminCategoriesService } from './admin-categories.service.js';
import { CategoriesQueryService } from './categories-query.service.js';
import {
  CreateCategoryRequest,
  ListAdminCategoriesQuery,
  ReorderCategoriesRequest,
  UpdateCategoryRequest,
} from './dto/category-requests.dto.js';
import { AdminCategoryDto, AdminCategoryListDto } from './dto/category-responses.dto.js';

const UNAUTHORIZED = { status: 401, description: 'Token ausente, inválido o expirado' } as const;
const BUSY = { status: 503, description: 'CATEGORIES_BUSY (reintentable)' } as const;

/**
 * Backoffice de categorías: JWT → personal activo con el permiso de CADA operación → aal2. Lectura: `catalog.read`
 * (cualquier alcance). Escrituras: `catalog.create`/`catalog.update` con alcance GLOBAL (se comprueba en el servicio).
 * Sin DELETE: se desactiva. La respuesta lleva `no-store` (middleware de `/v1/admin`).
 */
@ApiTags('categories')
@ApiBearerAuth()
@Controller('admin/categories')
export class AdminCategoriesController {
  constructor(
    @Inject(CategoriesQueryService) private readonly queries: CategoriesQueryService,
    @Inject(AdminCategoriesService) private readonly commands: AdminCategoriesService,
  ) {}

  @Get()
  @RequireStaff('catalog.read')
  @ApiOperation({
    operationId: 'listAdminCategories',
    summary: 'Categorías del backoffice (lista plana, activas e inactivas)',
  })
  @ApiOkResponse({ type: AdminCategoryListDto })
  @ApiResponse({ status: 400, description: 'Parámetros de consulta inválidos' })
  @ApiResponse(UNAUTHORIZED)
  list(@Query() query: ListAdminCategoriesQuery): Promise<AdminCategoryListDto> {
    return this.queries.listAdmin(query);
  }

  @Post()
  @RequireStaff('catalog.create')
  @ApiOperation({ operationId: 'createAdminCategory', summary: 'Crea una categoría' })
  @ApiCreatedResponse({ type: AdminCategoryDto })
  @ApiResponse({ status: 400, description: 'Datos inválidos o campos no permitidos' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse({ status: 409, description: 'CATEGORY_SLUG_TAKEN' })
  @ApiResponse({
    status: 422,
    description: 'CATEGORY_PARENT_INVALID, CATEGORY_DEPTH_EXCEEDED o CATEGORY_LIMIT_REACHED',
  })
  @ApiResponse(BUSY)
  create(
    @CurrentStaff() staff: StaffContext,
    @Body() body: CreateCategoryRequest,
  ): Promise<AdminCategoryDto> {
    return this.commands.create(staff, body);
  }

  // `reorder` se declara antes que `:id` (PUT vs PATCH no chocan, pero el orden evita ambigüedades futuras).
  @Put('reorder')
  @RequireStaff('catalog.update')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'reorderAdminCategories',
    summary: 'Reordena los hijos de un padre (o las raíces)',
  })
  @ApiOkResponse({ type: AdminCategoryListDto })
  @ApiResponse({ status: 400, description: 'Datos inválidos o campos no permitidos' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse({ status: 404, description: 'parentId inexistente' })
  @ApiResponse({ status: 422, description: 'CATEGORY_REORDER_MISMATCH' })
  @ApiResponse(BUSY)
  reorder(
    @CurrentStaff() staff: StaffContext,
    @Body() body: ReorderCategoriesRequest,
  ): Promise<AdminCategoryListDto> {
    return this.commands.reorder(staff, body);
  }

  @Patch(':id')
  @RequireStaff('catalog.update')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'updateAdminCategory',
    summary: 'Edita una categoría (incluye mover y activar/desactivar)',
  })
  @ApiOkResponse({ type: AdminCategoryDto })
  @ApiResponse({ status: 400, description: 'Datos inválidos, cuerpo vacío o campos no permitidos' })
  @ApiResponse(UNAUTHORIZED)
  @ApiResponse({ status: 404, description: 'La categoría no existe' })
  @ApiResponse({ status: 409, description: 'CATEGORY_SLUG_TAKEN' })
  @ApiResponse({
    status: 422,
    description: 'CATEGORY_CYCLE, CATEGORY_DEPTH_EXCEEDED o CATEGORY_PARENT_INVALID',
  })
  @ApiResponse(BUSY)
  update(
    @CurrentStaff() staff: StaffContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCategoryRequest,
  ): Promise<AdminCategoryDto> {
    return this.commands.update(staff, id, body);
  }
}
