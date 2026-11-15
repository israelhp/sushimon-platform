import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class DepartmentDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, example: 'Guatemala' }) name!: string;
}
export class DepartmentListDto {
  @ApiProperty({ type: [DepartmentDto] }) items!: DepartmentDto[];
}
export class MunicipalityDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) departmentId!: string;
  @ApiProperty({ type: String, example: 'Mixco' }) name!: string;
}
export class MunicipalityListDto {
  @ApiProperty({ type: [MunicipalityDto] }) items!: MunicipalityDto[];
}

export class ListMunicipalitiesQuery {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  departmentId!: string;
}
