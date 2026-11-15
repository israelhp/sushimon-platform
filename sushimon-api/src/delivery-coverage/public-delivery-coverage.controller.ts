import { Body, Controller, Header, HttpCode, Inject, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator.js';
import { DeliveryCoverageService } from './delivery-coverage.service.js';
import { DeliveryCoverageCheckRequest } from './dto/delivery-zone-requests.dto.js';
import { DeliveryCoverageCheckResponseDto } from './dto/delivery-zone-responses.dto.js';

/**
 * Comprobación pública y orientativa de cobertura (F09 D19). `no-store`. NO crea pedidos ni solicita motorista, y
 * no acepta costos del cliente: el DTO es una lista blanca (propiedades desconocidas => 400). La validación real
 * la repite F20 al crear el pedido con `DeliveryCoverageService.check`.
 */
@ApiTags('delivery-coverage')
@Public()
@Controller('delivery-coverage')
export class PublicDeliveryCoverageController {
  constructor(
    @Inject(DeliveryCoverageService) private readonly coverage: DeliveryCoverageService,
  ) {}

  @Post('check')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    operationId: 'checkDeliveryCoverage',
    summary: 'Comprueba cobertura de entrega a domicilio por proveedor (público, informativo)',
  })
  @ApiOkResponse({ type: DeliveryCoverageCheckResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Forma inválida (UUID, zone, propiedades desconocidas)',
  })
  @ApiResponse({ status: 422, description: 'BRANCH_NOT_AVAILABLE o MUNICIPALITY_NOT_FOUND' })
  check(@Body() body: DeliveryCoverageCheckRequest): Promise<DeliveryCoverageCheckResponseDto> {
    return this.coverage.check({
      branchId: body.branchId,
      municipalityId: body.municipalityId,
      zone: body.zone ?? null,
    });
  }
}
