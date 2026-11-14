import { ApiProperty } from '@nestjs/swagger';
import { HoursDayDto } from './branch-schedule-requests.dto.js';

export class PublicClosureWindowDto {
  @ApiProperty({ type: String, format: 'date-time', description: 'Instante UTC (`...Z`).' })
  startsAt!: string;
  @ApiProperty({ type: String, format: 'date-time', description: 'Instante UTC (`...Z`).' })
  endsAt!: string;
}

export class PublicBranchHoursDto {
  @ApiProperty({ type: String, format: 'uuid' })
  branchId!: string;
  @ApiProperty({ type: String, example: 'America/Guatemala' })
  timezone!: string;
  @ApiProperty({ type: [HoursDayDto], minItems: 7, maxItems: 7 })
  days!: HoursDayDto[];
  @ApiProperty({
    type: [PublicClosureWindowDto],
    maxItems: 10,
    description:
      'Cierres en curso o que empiezan en los próximos 30 días, por `startsAt`. Sin motivo.',
  })
  upcomingClosures!: PublicClosureWindowDto[];
}

export class AdminBranchHoursDto {
  @ApiProperty({ type: String, format: 'uuid' })
  branchId!: string;
  @ApiProperty({ type: String, example: 'America/Guatemala' })
  timezone!: string;
  @ApiProperty({
    type: String,
    pattern: '^[0-9a-f]{64}$',
    description: 'SHA-256 (hex minúsculas) del horario canónico. Reenviar como `expectedVersion`.',
  })
  version!: string;
  @ApiProperty({ type: [HoursDayDto], minItems: 7, maxItems: 7 })
  days!: HoursDayDto[];
}

export class BranchClosureDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  branchId!: string;
  @ApiProperty({ type: String, format: 'date-time', description: 'Instante UTC (`...Z`).' })
  startsAt!: string;
  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Instante UTC (`...Z`), exclusivo.',
  })
  endsAt!: string;
  @ApiProperty({ type: String, nullable: true, maxLength: 200 })
  reason!: string | null;
  @ApiProperty({
    type: String,
    enum: ['upcoming', 'active', 'past'],
    description: 'Calculado con el reloj del servidor al responder.',
  })
  status!: 'upcoming' | 'active' | 'past';
}

export class BranchClosureListDto {
  @ApiProperty({ type: [BranchClosureDto] })
  items!: BranchClosureDto[];
  @ApiProperty({ type: Number })
  page!: number;
  @ApiProperty({ type: Number })
  pageSize!: number;
  @ApiProperty({ type: Number })
  total!: number;
}

export const AVAILABILITY_REASONS = [
  'OPEN',
  'INACTIVE',
  'OUTSIDE_BUSINESS_HOURS',
  'EXCEPTIONAL_CLOSURE',
  'SCHEDULE_NOT_CONFIGURED',
] as const;

export class BranchAvailabilityDto {
  @ApiProperty({ type: String, format: 'uuid' })
  branchId!: string;
  @ApiProperty({ type: String, example: 'America/Guatemala' })
  timezone!: string;
  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Instante UTC (`...Z`) de la evaluación.',
  })
  serverTime!: string;
  @ApiProperty({ type: Boolean })
  isOpenNow!: boolean;
  @ApiProperty({
    type: Boolean,
    description: 'Hoy igual a `isOpenNow`. Siempre implica `isOpenNow`.',
  })
  isAcceptingOrders!: boolean;
  @ApiProperty({ type: String, enum: AVAILABILITY_REASONS })
  reason!: (typeof AVAILABILITY_REASONS)[number];
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  nextOpensAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  nextClosesAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  nextTransitionAt!: string | null;
}
