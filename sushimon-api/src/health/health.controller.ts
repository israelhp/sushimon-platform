import { Controller, Inject, Get, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator.js';
import { PrismaService } from '../database/prisma.service.js';
import { HealthTokenGuard } from './health-token.guard.js';

export class HealthResponse {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';
}

export class ReadyChecks {
  @ApiProperty({ enum: ['up'] })
  database!: 'up';
  @ApiProperty({ enum: ['present'] })
  schemaApp!: 'present';
}

export class ReadyResponse {
  @ApiProperty({ enum: ['ok'] })
  status!: 'ok';
  @ApiProperty({ type: ReadyChecks })
  checks!: ReadyChecks;
}

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  @SkipThrottle()
  @ApiOperation({ operationId: 'getHealth', summary: 'Liveness probe (público, sin dependencias)' })
  @ApiOkResponse({ type: HealthResponse })
  getHealth(): HealthResponse {
    return { status: 'ok' };
  }

  @Get('ready')
  @UseGuards(HealthTokenGuard)
  @ApiSecurity('health-token')
  @ApiHeader({ name: 'x-health-token', required: false })
  @ApiOperation({
    operationId: 'getReadiness',
    summary: 'Readiness probe (interno): verifica la base de datos y el esquema `app`',
  })
  @ApiOkResponse({ type: ReadyResponse })
  @ApiResponse({ status: 401, description: 'Token de salud ausente o inválido' })
  @ApiResponse({ status: 503, description: 'Base de datos o esquema `app` no disponible' })
  async getReadiness(): Promise<ReadyResponse> {
    const { ok, schemaApp } = await this.prisma.checkConnection();
    if (!ok || !schemaApp) {
      // Mensaje genérico: no revela host, usuario ni causa interna.
      throw new ServiceUnavailableException('Dependencias no disponibles');
    }
    return { status: 'ok', checks: { database: 'up', schemaApp: 'present' } };
  }
}
