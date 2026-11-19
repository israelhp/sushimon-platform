import 'reflect-metadata';
import { AdminOrdersController } from './admin-orders.controller.js';
import { StaffGuard } from '../../auth/staff.guard.js';
import { MfaGuard } from '../../auth/mfa.guard.js';
import { COMMAND_SPECS } from './order-transition.matrix.js';

const PERMISSIONS_KEY = 'auth:requiredPermissions';
const PATH = 'path';
const METHOD = 'method';

/** Fila 42: toda operación lleva `@RequireStaff` con SU permiso (ninguna a nivel de clase) y `board` va antes que `:id`. */
describe('AdminOrdersController (fila 42)', () => {
  const proto = AdminOrdersController.prototype as unknown as Record<string, () => unknown>;
  const handlers = Object.getOwnPropertyNames(proto).filter(
    (n) => n !== 'constructor' && Reflect.getMetadata(PATH, proto[n] as object) !== undefined,
  );
  const route = (n: string) => [
    Reflect.getMetadata(METHOD, proto[n] as object) as number,
    Reflect.getMetadata(PATH, proto[n] as object) as string,
  ];
  const permissionOf = (n: string) =>
    Reflect.getMetadata(PERMISSIONS_KEY, proto[n] as object) as string[] | undefined;

  it('expone exactamente las 9 operaciones del contrato', () => {
    expect(handlers.map((n) => route(n)[1]).sort()).toEqual(
      [
        '/',
        'board',
        ':id',
        ':id/accept',
        ':id/reject',
        ':id/start-preparing',
        ':id/mark-ready',
        ':id/complete',
        ':id/cancel',
      ]
        .map((p) => (p === '/' ? '/' : p))
        .sort(),
    );
    expect(handlers).toHaveLength(9);
  });

  it('cada ruta declara @RequireStaff con su permiso y los guards StaffGuard + MfaGuard', () => {
    const expected: Record<string, string> = {
      '/': 'orders.read',
      board: 'orders.read',
      ':id': 'orders.read',
    };
    for (const spec of Object.values(COMMAND_SPECS))
      expected[`:id/${spec.route}`] = spec.permission;
    for (const n of handlers) {
      const path = route(n)[1] as string;
      expect(permissionOf(n), `${n} (${path})`).toEqual([expected[path]]);
      const guards = Reflect.getMetadata('__guards__', proto[n] as object) as unknown[];
      expect(guards).toEqual(expect.arrayContaining([StaffGuard, MfaGuard]));
    }
    // ningún @RequireStaff a nivel de clase
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AdminOrdersController)).toBeUndefined();
  });

  it('`board` se declara antes que `:id` (si no, `board` se interpretaría como identificador)', () => {
    const order = Object.getOwnPropertyNames(proto).filter((n) => handlers.includes(n));
    const paths = order.map((n) => route(n)[1]);
    expect(paths.indexOf('board')).toBeLessThan(paths.indexOf(':id'));
  });

  it('los permisos legados no se usan', () => {
    const all = handlers.flatMap((n) => permissionOf(n) ?? []);
    expect(all).not.toContain('orders.status');
    expect(all).not.toContain('orders.dispatch');
  });
});
