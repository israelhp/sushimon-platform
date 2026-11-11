import type { FulfillmentType, OrderAddress, OrderSchedule } from '@/lib/data-access/models';

/**
 * Modo de pedido del cliente (preferencia en localStorage `monsushi-order-mode-v1`):
 * recoger/domicilio, ahora/programado, dirección o zona y sucursal elegida.
 */
export const ORDER_MODE_STORAGE_KEY = 'monsushi-order-mode-v1';

export interface OrderMode {
  /** null = aún no elegido (el prototipo muestra "Empezar pedido"). */
  type: FulfillmentType | null;
  when: OrderSchedule;
  /** Sucursal para recoger (o la que cubre la dirección a domicilio). */
  branchId: string | null;
  /** Dirección a domicilio (al menos departamento/municipio/zona para cotizar). */
  address: OrderAddress | null;
}

export const DEFAULT_ORDER_MODE: OrderMode = {
  type: null,
  when: { kind: 'now' },
  branchId: null,
  address: null,
};

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

export function parseOrderMode(raw: string | null): OrderMode {
  if (!raw) return DEFAULT_ORDER_MODE;
  try {
    const v: unknown = JSON.parse(raw);
    if (!isObject(v) || (v.type !== 'pickup' && v.type !== 'delivery')) return DEFAULT_ORDER_MODE;
    const when = isObject(v.when) ? v.when : null;
    const schedule: OrderSchedule =
      when?.kind === 'scheduled' && typeof when.date === 'string' && typeof when.time === 'string'
        ? { kind: 'scheduled', date: when.date, time: when.time }
        : { kind: 'now' };
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
      type: v.type,
      when: schedule,
      branchId: typeof v.branchId === 'string' ? v.branchId : null,
      address,
    };
  } catch {
    return DEFAULT_ORDER_MODE;
  }
}

/**
 * Descarta un horario programado que ya no es válido (p. ej., quedó en el pasado). Recibe la
 * función de validación para no depender del reloj aquí.
 */
export function normalizeSchedule(
  mode: OrderMode,
  isValid: (when: OrderSchedule) => boolean,
): OrderMode {
  return mode.when.kind === 'scheduled' && !isValid(mode.when)
    ? { ...mode, when: { kind: 'now' } }
    : mode;
}
