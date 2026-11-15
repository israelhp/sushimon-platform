import type { DataClient } from '@/lib/data-access/types';
import type {
  DeliveryCoverageCheckRequest,
  DeliveryCoverageCheckResponse,
} from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/**
 * F09 — Cobertura PÚBLICA por proveedor (`checkDeliveryCoverage`). No crea nada ni recibe importes: la tarifa propia
 * (`providers.OWN.baseFee`) y la elegibilidad las deriva SIEMPRE el servidor. Sucursal inexistente o inactiva => 422
 * `BRANCH_NOT_AVAILABLE`; municipio inexistente => 422 `MUNICIPALITY_NOT_FOUND`.
 */
export const checkDeliveryCoverage = (
  client: DataClient,
  input: DeliveryCoverageCheckRequest,
  signal?: AbortSignal,
) =>
  client.request<DeliveryCoverageCheckResponse>(paths.deliveryCoverageCheck(), {
    method: 'POST',
    body: input,
    signal,
  });
