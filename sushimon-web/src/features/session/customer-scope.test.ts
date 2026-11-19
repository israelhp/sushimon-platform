import { describe, expect, it } from 'vitest';
import { queryKeys } from '../query-keys';
import { isOtherIdentity } from './customer-scope';

describe('F21 · claves privadas y guardia de caché por identidad', () => {
  it('queryKeys.orders.tracking = [orders, tracking, scope|guest, id]; el token nunca entra', () => {
    expect(queryKeys.orders.tracking(null, 'o1')).toEqual(['orders', 'tracking', 'guest', 'o1']);
    expect(queryKeys.orders.tracking('u1', 'o1')).toEqual(['orders', 'tracking', 'u1', 'o1']);
    expect(queryKeys.orders.tracking(null, 'o1')).not.toEqual(
      queryKeys.orders.tracking(null, 'o2'),
    );
    expect(queryKeys.orders.tracking('u1', 'o1')).not.toEqual(
      queryKeys.orders.tracking('u2', 'o1'),
    );
    // Comparte prefijo con `orders.all` (la mutación de pedidos lo invalida).
    expect(queryKeys.orders.tracking(null, 'o1').slice(0, 1)).toEqual(queryKeys.orders.all);
  });

  it('descarta tracking y placed de OTRA identidad; conserva los propios y lo público', () => {
    // Sin sesión (invitado): se conservan los de `guest`, se descartan los de una cuenta.
    expect(isOtherIdentity(queryKeys.orders.tracking(null, 'o'), null)).toBe(false);
    expect(isOtherIdentity(queryKeys.orders.placed(null, 'o'), null)).toBe(false);
    expect(isOtherIdentity(queryKeys.orders.tracking('u1', 'o'), null)).toBe(true);
    expect(isOtherIdentity(queryKeys.orders.placed('u1', 'o'), null)).toBe(true);
    // Con sesión u1: se descartan los de invitado y los de otra cuenta.
    expect(isOtherIdentity(queryKeys.orders.tracking('u1', 'o'), 'u1')).toBe(false);
    expect(isOtherIdentity(queryKeys.orders.tracking('u2', 'o'), 'u1')).toBe(true);
    expect(isOtherIdentity(queryKeys.orders.tracking(null, 'o'), 'u1')).toBe(true);
    expect(isOtherIdentity(queryKeys.orders.placed(null, 'o'), 'u1')).toBe(true);
    // Lo existente (customer.*) sigue igual y lo público/otros pedidos no se tocan.
    expect(isOtherIdentity(queryKeys.customer.account.me('u2'), 'u1')).toBe(true);
    expect(isOtherIdentity(queryKeys.customer.account.me('u1'), 'u1')).toBe(false);
    expect(isOtherIdentity(queryKeys.orders.detail('MON-1'), 'u1')).toBe(false);
    expect(isOtherIdentity(queryKeys.store.publicBranches, 'u1')).toBe(false);
  });
});
