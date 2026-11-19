/** Fila ligera del historial del cliente (F23). Sin líneas, contacto, dirección ni notas. */
export interface MyOrderRow {
  id: string;
  orderNumber: bigint;
  status: string;
  branchId: string;
  branchName: string;
  fulfillmentType: string;
  deliveryProvider: string | null;
  /** Cadena decimal exacta (`"165.00"`). */
  total: string;
  paymentMethodPreference: string | null;
  placedAt: Date;
  updatedAt: Date;
  /** Unidades (suma de cantidades), agregadas en la misma sentencia. */
  itemCount: number;
  /** `placed_at` en ISO UTC con microsegundos (el `Date` de JS trunca a ms y rompería el keyset). */
  placedAtKey: string;
}

export interface MyOrdersFilter {
  /** `sub` verificado del JWT: el ÚNICO origen del propietario. */
  authUserId: string;
  status: string[] | null;
  branchId: string | null;
  from: Date | null;
  to: Date | null;
  cursor: { placedAtKey: string; id: string } | null;
  limit: number;
}
