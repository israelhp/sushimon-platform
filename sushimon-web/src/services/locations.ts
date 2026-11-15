import type { DataClient } from '@/lib/data-access/types';
import type { Department, Municipality } from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';
import type { components } from '@sushimon/contracts';

/**
 * F09 — Catálogos geográficos PÚBLICOS y de solo lectura (`listLocationDepartments`, `listLocationMunicipalities`).
 * Ordenados por la API (es, sin distinguir acentos). Los ids son UUID POR ENTORNO: nunca se fijan en el cliente.
 * `departmentId` inexistente => 404 `DEPARTMENT_NOT_FOUND`; un departamento sin municipios cargados => `[]`.
 */
export async function listDepartments(client: DataClient): Promise<Department[]> {
  const res = await client.get<components['schemas']['DepartmentListResponse']>(
    paths.locationDepartments(),
  );
  return res.items;
}

export async function listMunicipalities(
  client: DataClient,
  departmentId: string,
): Promise<Municipality[]> {
  const res = await client.get<components['schemas']['MunicipalityListResponse']>(
    paths.locationMunicipalities(),
    { query: { departmentId } },
  );
  return res.items;
}
