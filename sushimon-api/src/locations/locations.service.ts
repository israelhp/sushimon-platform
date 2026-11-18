import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { codedException } from '../common/errors/coded-exception.js';
import type { DepartmentListDto, MunicipalityListDto } from './dto/location-responses.dto.js';
import { LocationsRepository } from './locations.repository.js';

const collator = new Intl.Collator('es', { sensitivity: 'base' });

/**
 * Orden alfabético en español sin distinguir acentos ni mayúsculas, desempate por `id`. Se ordena en la API
 * (conjuntos pequeños): la colación de BD no es fiable entre entornos.
 */
export function sortByName<T extends { id: string; name: string }>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) => collator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Tope del memo de municipios (el seed tiene ~340). */
const MUNICIPALITY_CACHE_MAX = 1_000;

@Injectable()
export class LocationsService {
  private readonly municipalities = new Map<
    string,
    { id: string; name: string; departmentName: string }
  >();

  constructor(@Inject(LocationsRepository) private readonly repo: LocationsRepository) {}

  async listDepartments(): Promise<DepartmentListDto> {
    return { items: sortByName(await this.repo.listDepartments()) };
  }

  /**
   * Municipio y departamento por id; `null` si no existe. Lo consume la cotización (F19). El catálogo geográfico es un
   * seed permanente (migración 0007, ~340 filas, sin API de escritura): los ENCONTRADOS se memorizan por proceso para
   * quitar una consulta por cotización (A1). Los inexistentes NO se memorizan (no hay crecimiento por entradas hostiles).
   */
  async findMunicipality(
    id: string,
  ): Promise<{ id: string; name: string; departmentName: string } | null> {
    const cached = this.municipalities.get(id);
    if (cached) return cached;
    const found = await this.repo.findMunicipality(id);
    if (found && this.municipalities.size < MUNICIPALITY_CACHE_MAX) {
      this.municipalities.set(id, found);
    }
    return found;
  }

  async listMunicipalities(departmentId: string): Promise<MunicipalityListDto> {
    const rows = await this.repo.listMunicipalities(departmentId);
    if (rows === null) {
      throw codedException(
        HttpStatus.NOT_FOUND,
        'DEPARTMENT_NOT_FOUND',
        'El departamento no existe',
      );
    }
    return { items: sortByName(rows) };
  }
}
