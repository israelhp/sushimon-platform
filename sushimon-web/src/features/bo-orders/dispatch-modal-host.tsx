'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { DispatchModal } from '@/features/bo-deliveries/components/DispatchModal';
import { useDataClient } from '@/lib/data-access/provider';

/**
 * Host del modal "Despachar pedido" SIMULADO (PedidosYa / repartidor propio de demostración). Mantiene la firma
 * `{ orderId, onClose }` que monta `DispatchModalProvider`; el flujo vive en `bo-deliveries`.
 *
 * F28 (spec 029 §13): con datos REALES (`http`) el despacho simulado se RETIRA: el reparto propio es real y vive en Entregas (crear
 * y asignar), y PedidosYa sigue bloqueado hasta tener documentación y credenciales. Aquí solo se redirige a Entregas.
 */
export function DispatchModalHost({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const client = useDataClient();
  const router = useRouter();
  const real = client.kind === 'http';
  useEffect(() => {
    if (!real) return;
    onClose();
    router.push('/backoffice/entregas');
  }, [real, onClose, router]);
  if (real) return null;
  return <DispatchModal orderId={orderId} onClose={onClose} />;
}
