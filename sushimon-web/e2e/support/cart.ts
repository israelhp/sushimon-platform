/**
 * Carrito `monsushi-cart-v2` para sembrar `localStorage` en las pruebas (F18). Mismo esquema que `lib/cart-rules.ts`; se escribe
 * aquí a mano para que las pruebas NO dependan del código bajo prueba. Los ids del mock no son UUID (el carrito no los exige).
 */
export const CART_KEY = 'monsushi-cart-v2';

export interface SeedLine {
  productId: string;
  quantity?: number;
  note?: string;
  /** Precio provisional por unidad SIN extras (centavos). */
  unitCents: number;
  name?: string;
  selections?: { groupId: string; optionId: string }[];
  options?: {
    groupId: string;
    optionId: string;
    groupName: string;
    optionName: string;
    extraCents: number;
  }[];
}

/** Siembra un carrito de UNA sucursal; `updatedAt` = ahora (el TTL es de 7 días). */
export function cartV2(branchId: string, lines: SeedLine[], updatedAt = Date.now()): string {
  return JSON.stringify({
    v: 2,
    branchId,
    updatedAt,
    lines: lines.map((l) => ({
      productId: l.productId,
      slug: l.productId,
      quantity: l.quantity ?? 1,
      note: l.note ?? '',
      selections: (l.selections ?? []).map((s) => ({ ...s, quantity: 1 })),
      display: {
        name: l.name ?? l.productId,
        imageUrl: null,
        unitCents: l.unitCents,
        currency: 'GTQ',
        seenAt: updatedAt,
        options: l.options ?? [],
      },
    })),
  });
}

/** Modo de pedido guardado (ADR-0036: la tienda es solo a domicilio e inmediata). */
export const deliveryMode = (branchId: string) =>
  JSON.stringify({
    type: 'delivery',
    branchId,
    address: {
      department: 'Guatemala',
      municipality: 'Guatemala',
      zone: '10',
      line: '6a avenida 10-50',
      references: '',
    },
  });

export const DUMPLINGS = { productId: 'dumplings', name: 'Dumplings', unitCents: 5300 } as const;
