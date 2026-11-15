import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

export interface DepartmentRow {
  id: string;
  name: string;
}
export interface MunicipalityRow {
  id: string;
  departmentId: string;
  name: string;
}

/** Acceso de solo lectura a los catálogos geográficos (seed de la migración 0007). */
@Injectable()
export class LocationsRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  listDepartments(): Promise<DepartmentRow[]> {
    return this.prisma.department.findMany({ select: { id: true, name: true } });
  }

  /**
   * UNA consulta indexada por `department_id` (el UNIQUE `(department_id, name)` la cubre) que además distingue
   * «departamento inexistente» (`null`) de «existente sin municipios» (`[]`).
   */
  async listMunicipalities(departmentId: string): Promise<MunicipalityRow[] | null> {
    const rows = await this.prisma.$queryRaw<
      { department_id: string; id: string | null; name: string | null }[]
    >`
      SELECT d.id AS department_id, m.id, m.name
      FROM app.departments d
      LEFT JOIN app.municipalities m ON m.department_id = d.id
      WHERE d.id = ${departmentId}::uuid`;
    if (rows.length === 0) return null;
    return rows.flatMap((r) =>
      r.id !== null && r.name !== null ? [{ id: r.id, departmentId, name: r.name }] : [],
    );
  }
}
