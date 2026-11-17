import type { DataClient } from '@/lib/data-access/types';
import type {
  Branch,
  Category,
  JobApplication,
  JobApplicationRequest,
  BannerLocale,
  StoreBootstrap,
  StoreConfig,
  StoreSearchPage,
} from '@/lib/data-access/models';
import { ApiError } from '@/lib/data-access/errors';
import { storeSearchQuery, type StoreSearchParams } from '@/lib/store-rules';
import { paths } from '@/lib/data-access/paths';

/** Datos públicos de la tienda: configuración, sucursales, catálogo, empleo (las promociones F15: `services/promotions`). */

/**
 * SIMULADO (MOCK_ONLY): `GET /v1/store/config` NO existe en la API (docs/contracts/planned-endpoints.md). Con el adaptador http no se
 * emite la solicitud (antes daba 404 en cada carga): falla de inmediato con el mismo 404 que ya manejaban las pantallas.
 */
export const getStoreConfig = (client: DataClient): Promise<StoreConfig> =>
  client.kind === 'http'
    ? Promise.reject(
        new ApiError(404, 'not_found', 'GET /v1/store/config no existe en la API (sin solicitud)'),
      )
    : client.get<StoreConfig>(paths.storeConfig());

/**
 * Público (F17): agregado de arranque del Inicio por sucursal e idioma. Sin `branchId`: `branch`/`availability` `null`, sin
 * promociones. 404 `BRANCH_NOT_FOUND`; 429 `RATE_LIMITED`; 503 `STORE_BUSY`. Nunca trae datos del cliente.
 */
export const getStoreBootstrap = (
  client: DataClient,
  params: { branchId?: string | null; locale?: BannerLocale } = {},
  signal?: AbortSignal,
) =>
  client.get<StoreBootstrap>(paths.storeBootstrap(), {
    query: {
      branchId: params.branchId ?? undefined,
      // `es` es el valor por defecto del servidor: se omite para que la URL sea canónica.
      locale: params.locale && params.locale !== 'es' ? params.locale : undefined,
    },
    signal,
    public: true,
  });

/**
 * Público (F17): búsqueda paginada. `q` de 2 a 80 caracteres (400 si no), canónica en la URL. Sin resultados = 200 con `items=[]`.
 * 404 `BRANCH_NOT_FOUND`; 429 `RATE_LIMITED`; 503 `STORE_BUSY`.
 */
export const searchStoreProducts = (
  client: DataClient,
  params: StoreSearchParams,
  signal?: AbortSignal,
) =>
  client.get<StoreSearchPage>(paths.storeSearch(), {
    query: storeSearchQuery(params),
    signal,
    public: true,
  });

/**
 * Vista OPERATIVA SIMULADA de las sucursales (horario, abierta ahora, cobertura: F08/F09, sin contrato todavía).
 * Para identidad y estado administrativo (F07) usa `services/branches`.
 */
export const listBranches = (client: DataClient) =>
  client.get<Branch[]>(paths.demoBranchOperations());

export const listCategories = (client: DataClient) => client.get<Category[]>(paths.categories());

export const submitJobApplication = (client: DataClient, input: JobApplicationRequest) =>
  client.post<JobApplication>(paths.jobApplications(), input);
