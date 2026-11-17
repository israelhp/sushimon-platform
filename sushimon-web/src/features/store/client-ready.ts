'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * `false` durante el render de hidratación y `true` en cuanto el navegador toma el control. El modo de pedido (sucursal) se lee de
 * localStorage, que el servidor no conoce: hasta entonces los datos por sucursal NO deben consultarse (si no, cada carga emitiría una
 * solicitud sin sucursal que se descarta de inmediato). En pruebas (sin hidratación) es `true` desde el primer render.
 */
export function useClientReady(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
