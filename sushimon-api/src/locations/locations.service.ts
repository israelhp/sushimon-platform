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

@Injectable()
export class LocationsService {
  constructor(@Inject(LocationsRepository) private readonly repo: LocationsRepository) {}

  async listDepartments(): Promise<DepartmentListDto> {
    return { items: sortByName(await this.repo.listDepartments()) };
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
