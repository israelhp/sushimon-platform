'use client';

import { useMutation } from '@tanstack/react-query';
import { useDataClient } from '@/lib/data-access/provider';
import type { ApiError } from '@/lib/data-access/errors';
import type { OrderReorderPreview } from '@/lib/data-access/models';
import { previewOrderReorder } from '@/services/orders';

export interface ReorderPreviewArgs {
  orderId: string;
  /** `null` = la sucursal del pedido original. */
  branchId: string | null;
  /** Credencial de invitado (`X-Order-Token`); nunca viaja en la URL ni entra en una clave. */
  guestToken: string | null;
}

/**
 * F23 (spec 024 §9.4) — «Volver a pedir»: vista previa de SOLO LECTURA (`POST /v1/orders/{id}/reorder-preview`). Es una
 * `useMutation` y NO una consulta: el resultado vive solo en el diálogo (sin clave ni persistencia; `gcTime: 0` lo descarta al
 * desmontar). No crea pedidos, no toca el historial ni el carrito: añadir es decisión explícita del cliente.
 */
export function useReorderPreview() {
  const client = useDataClient();
  return useMutation<OrderReorderPreview, ApiError, ReorderPreviewArgs>({
    mutationFn: ({ orderId, branchId, guestToken }) =>
      previewOrderReorder(client, orderId, { branchId, guestToken }),
    gcTime: 0,
    retry: false,
  });
}
