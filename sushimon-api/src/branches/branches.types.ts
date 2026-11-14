/** Campos públicos de una sucursal activa. */
export interface PublicBranchView {
  id: string;
  code: string;
  name: string;
  address: string;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
}

/** Vista administrativa. `active` es el estado ADMINISTRATIVO (no "abierta ahora", F08). */
export interface AdminBranchView extends PublicBranchView {
  active: boolean;
  createdAt: string;
}

export type BranchSortField = 'name' | 'code' | 'createdAt';

export interface AdminBranchListQuery {
  q?: string;
  active?: boolean;
  sort?: BranchSortField;
  order?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface AdminBranchPageView {
  items: AdminBranchView[];
  page: number;
  pageSize: number;
  total: number;
}

/** Datos de dominio ya normalizados y validados (salida de branch-policy). */
export interface NewBranchData {
  code: string;
  name: string;
  address: string;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
  active: boolean;
}

/** Campos modificables por PATCH; solo vienen los presentes en la solicitud. */
export type BranchPatch = Partial<
  Pick<NewBranchData, 'name' | 'address' | 'phone' | 'latitude' | 'longitude'>
>;
