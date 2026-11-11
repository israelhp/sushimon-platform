'use client';

import { useQuery } from '@tanstack/react-query';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { useDemoSession } from '@/features/session/demo-session';
import { queryKeys } from '@/features/query-keys';
import { useDataClient } from '@/lib/data-access/provider';
import { listDeliveries } from '@/services/backoffice-orders';

/**
 * Pedido a domicilio de un día anterior (el detalle se abre desde Entregas, que lista varios días; el tablero
 * solo carga "hoy"). Consulta ese día con el mismo query que Entregas, así comparten caché. Solo se activa si
 * el pedido no está entre los de hoy y se conoce su día.
 */
export function usePastOrder(orderId: string, day: string | null, enabled: boolean) {
  const client = useDataClient();
  const { branchId } = useShell();
  const staff = !!useDemoSession().staff;
  const filters = { from: day ?? undefined, to: day ?? undefined, branchId };
  const query = useQuery({
    queryKey: queryKeys.backoffice.deliveries(filters),
    queryFn: () => listDeliveries(client, filters),
    enabled: enabled && staff && !!day,
  });
  return { order: query.data?.find((o) => o.id === orderId), isPending: query.isPending && !!day };
}
