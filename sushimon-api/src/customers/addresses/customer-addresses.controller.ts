import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Principal } from '../../auth/auth.types.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { CustomerAddressesService } from './customer-addresses.service.js';
import {
  CreateCustomerAddressDto,
  CustomerAddressDto,
  CustomerAddressListDto,
  UpdateCustomerAddressDto,
} from './dto/customer-address.dto.js';

/**
 * Direcciones del cliente autenticado (F05). Sin ids de cliente en la ruta: el sujeto es siempre el del JWT.
 * Contrato: `packages/contracts/openapi/openapi.yaml` (operationIds listMyAddresses … setDefaultMyAddress).
 */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me/addresses')
export class CustomerAddressesController {
  constructor(
    @Inject(CustomerAddressesService) private readonly addresses: CustomerAddressesService,
  ) {}

  @Get()
  @ApiOperation({ operationId: 'listMyAddresses', summary: 'Lista las direcciones del cliente' })
  @ApiOkResponse({ type: CustomerAddressListDto })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido o expirado' })
  list(@CurrentUser() principal: Principal): Promise<CustomerAddressListDto> {
    return this.addresses.list(principal);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ operationId: 'createMyAddress', summary: 'Crea una dirección del cliente' })
  @ApiBody({ type: CreateCustomerAddressDto })
  @ApiCreatedResponse({ type: CustomerAddressDto })
  @ApiResponse({ status: 400, description: 'Datos inválidos o municipio inexistente' })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido o expirado' })
  @ApiResponse({ status: 409, description: 'Límite alcanzado o duplicado' })
  create(
    @CurrentUser() principal: Principal,
    @Body() body: CreateCustomerAddressDto,
  ): Promise<CustomerAddressDto> {
    return this.addresses.create(principal, body);
  }

  @Get(':id')
  @ApiOperation({ operationId: 'getMyAddress', summary: 'Detalle de una dirección del cliente' })
  @ApiOkResponse({ type: CustomerAddressDto })
  @ApiResponse({ status: 400, description: 'Identificador inválido' })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido o expirado' })
  @ApiResponse({ status: 404, description: 'No existe o no pertenece al cliente' })
  get(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomerAddressDto> {
    return this.addresses.get(principal, id);
  }

  @Patch(':id')
  @ApiOperation({ operationId: 'updateMyAddress', summary: 'Edita una dirección del cliente' })
  @ApiBody({ type: UpdateCustomerAddressDto })
  @ApiOkResponse({ type: CustomerAddressDto })
  @ApiResponse({
    status: 400,
    description: 'Datos inválidos, campo no permitido o identificador inválido',
  })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido o expirado' })
  @ApiResponse({ status: 404, description: 'No existe o no pertenece al cliente' })
  @ApiResponse({ status: 409, description: 'Duplicado' })
  update(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCustomerAddressDto,
  ): Promise<CustomerAddressDto> {
    return this.addresses.update(principal, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ operationId: 'deleteMyAddress', summary: 'Elimina una dirección del cliente' })
  @ApiNoContentResponse({ description: 'Dirección eliminada' })
  @ApiResponse({ status: 400, description: 'Identificador inválido' })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido o expirado' })
  @ApiResponse({ status: 404, description: 'No existe o no pertenece al cliente' })
  async remove(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.addresses.remove(principal, id);
  }

  @Patch(':id/default')
  @ApiOperation({
    operationId: 'setDefaultMyAddress',
    summary: 'Marca una dirección como predeterminada',
  })
  @ApiOkResponse({ type: CustomerAddressDto })
  @ApiResponse({ status: 400, description: 'Identificador inválido' })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido o expirado' })
  @ApiResponse({ status: 404, description: 'No existe o no pertenece al cliente' })
  setDefault(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CustomerAddressDto> {
    return this.addresses.setDefault(principal, id);
  }
}
