import { Controller, Get, Inject, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator.js';
import { CacheControl, PUBLIC_CACHE_CONTROL } from '../common/http/cache-control.js';
import { BranchesQueryService } from './branches-query.service.js';
import { PublicBranchDto, PublicBranchListResponse } from './dto/branch-responses.dto.js';

@ApiTags('branches')
@Public()
@Controller('branches')
export class PublicBranchesController {
  constructor(@Inject(BranchesQueryService) private readonly branches: BranchesQueryService) {}

  @Get()
  @CacheControl(PUBLIC_CACHE_CONTROL)
  @ApiOperation({ operationId: 'listPublicBranches', summary: 'Sucursales activas (público)' })
  @ApiOkResponse({ type: PublicBranchListResponse })
  async list(): Promise<PublicBranchListResponse> {
    return { items: await this.branches.listPublic() };
  }

  @Get(':id')
  @CacheControl(PUBLIC_CACHE_CONTROL)
  @ApiOperation({
    operationId: 'getPublicBranch',
    summary: 'Detalle público de una sucursal activa',
  })
  @ApiOkResponse({ type: PublicBranchDto })
  @ApiResponse({ status: 400, description: 'El identificador no es un UUID' })
  @ApiResponse({ status: 404, description: 'No existe o no está activa' })
  getOne(@Param('id', ParseUUIDPipe) id: string): Promise<PublicBranchDto> {
    return this.branches.getPublicById(id);
  }
}
