import type { OrderAddress } from '@/lib/data-access/models';

/**
 * Modo de pedido del cliente (preferencia en localStorage `monsushi-order-mode-v1`): dirección o zona de entrega y
 * sucursal que la cubre. Desde ADR-0036 la tienda es SOLO a domicilio e inmediata: no hay recoger ni programar.
 * Un valor guardado antes (`type: 'pickup'`, o `when` programado) se tolera sin error: `pickup` se descarta (vuelve a
 * «sin elegir») y `when` se ignora.
 */
export const ORDER_MODE_STORAGE_KEY = 'monsushi-order-mode-v1';

/** Única modalidad de pedidos nuevos (ADR-0036). */
export type OrderModeType = 'delivery';

export interface OrderMode {
  /** null = aún no elegido (el prototipo muestra "Empezar pedido"). */
  type: OrderModeType | null;
  /** Sucursal que cubre la dirección a domicilio. */
  branchId: string | null;
  /** Dirección a domicilio (al menos departamento/municipio/zona para cotizar). */
  address: OrderAddress | null;
}

export const DEFAULT_ORDER_MODE: OrderMode = {
  type: null,
  branchId: null,
  address: null,
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

export function parseOrderMode(raw: string | null): OrderMode {
  if (!raw) return DEFAULT_ORDER_MODE;
  try {
    const v: unknown = JSON.parse(raw);
    // Un modo guardado `pickup` (o cualquier otro valor) ya no existe: se descarta.
    if (!isObject(v) || v.type !== 'delivery') return DEFAULT_ORDER_MODE;
    const a = isObject(v.address) ? v.address : null;
    const address: OrderAddress | null =
      a && typeof a.department === 'string' && typeof a.municipality === 'string'
        ? {
            department: a.department,
            municipality: a.municipality,
            zone: typeof a.zone === 'string' ? a.zone : '',
            line: typeof a.line === 'string' ? a.line : '',
            references: typeof a.references === 'string' ? a.references : '',
          }
        : null;
    return {
      type: 'delivery',
      branchId: typeof v.branchId === 'string' ? v.branchId : null,
      address,
    };
  } catch {
    return DEFAULT_ORDER_MODE;
  }
}
