import { describe, expect, it } from 'vitest';
import en from '@/i18n/messages/en.json';
import es from '@/i18n/messages/es.json';
import { PERMISSION_CATALOG, ROLE_SEEDS } from '@/mocks/fixtures/rbac';
import {
  SCREEN_PERMISSION,
  can,
  canGlobally,
  canSee,
  homeScreen,
  permissionModule,
  visibleScreens,
  type Grants,
} from './permissions';

const grants: Grants = {
  'orders.read': { allBranches: false, branchIds: ['b1', 'b2'] },
  'staff.read': { allBranches: true, branchIds: [] },
  'reports.read': { allBranches: false, branchIds: [] },
};

describe('can(grants, permiso, sucursal?)', () => {
  it('sin sucursal: basta con tener el permiso en algún alcance', () => {
    expect(can(grants, 'orders.read')).toBe(true);
    expect(can(grants, 'staff.read')).toBe(true);
    expect(can(grants, 'orders.accept')).toBe(false);
    // Un permiso con alcance vacío no concede nada.
    expect(can(grants, 'reports.read')).toBe(false);
  });

  it('con sucursal: global siempre; acotado solo en sus sucursales', () => {
    expect(can(grants, 'orders.read', 'b2')).toBe(true);
    expect(can(grants, 'orders.read', 'b3')).toBe(false);
    expect(can(grants, 'staff.read', 'cualquiera')).toBe(true);
  });

  it('denegar por defecto sin contexto', () => {
    expect(can(null, 'orders.read')).toBe(false);
    expect(can(undefined, 'orders.read', 'b1')).toBe(false);
    expect(can({}, 'orders.read')).toBe(false);
  });

  it('canGlobally exige alcance global', () => {
    expect(canGlobally(grants, 'staff.read')).toBe(true);
    expect(canGlobally(grants, 'orders.read')).toBe(false);
  });
});

describe('pantallas', () => {
  it('cada pantalla depende de un permiso de lectura y el inicio es la primera visible', () => {
    expect(canSee(grants, 'pedidos')).toBe(true);
    expect(canSee(grants, 'usuarios')).toBe(true);
    expect(canSee(grants, 'panel')).toBe(false);
    expect(visibleScreens(grants)).toEqual(['pedidos', 'usuarios']);
    expect(homeScreen(grants)).toBe('pedidos');
    expect(homeScreen({ 'dashboard.read': { allBranches: true, branchIds: [] } })).toBe('panel');
    expect(homeScreen({})).toBe('panel');
    expect(Object.values(SCREEN_PERMISSION).every((p) => p.includes('.'))).toBe(true);
  });

  it('módulo de un permiso', () => {
    expect(permissionModule('staff.assign_roles')).toBe('staff');
  });
});

describe('catálogo granular del mock (spec 006)', () => {
  const codes = PERMISSION_CATALOG.map((p) => p.code);

  it('tiene 46 permisos únicos con formato modulo.accion', () => {
    expect(codes).toHaveLength(46);
    expect(new Set(codes).size).toBe(46);
    for (const code of codes) expect(code).toMatch(/^[a-z]+\.[a-z_]+$/);
  });

  it('admin contiene el catálogo completo y es de sistema; el resto solo permisos conocidos', () => {
    const admin = ROLE_SEEDS.find((r) => r.code === 'admin')!;
    expect(admin.isSystem).toBe(true);
    expect([...admin.permissions].sort()).toEqual([...codes].sort());
    for (const role of ROLE_SEEDS) {
      for (const p of role.permissions) expect(codes, `${role.code}:${p}`).toContain(p);
    }
    expect(ROLE_SEEDS.filter((r) => r.isSystem).map((r) => r.code)).toEqual(['admin']);
  });
});

describe('etiquetas de roles y módulos (i18n)', () => {
  const modules = [...new Set(PERMISSION_CATALOG.map((p) => permissionModule(p.code)))];

  for (const [name, messages] of [
    ['es', es],
    ['en', en],
  ] as const) {
    it(`${name}: cada rol y módulo tiene etiqueta`, () => {
      const bo = messages.backoffice as unknown as Record<string, Record<string, string>>;
      for (const r of ROLE_SEEDS) {
        expect(bo.roles?.[r.code], `roles.${r.code}`).toBeTruthy();
        expect(bo.roleDescriptions?.[r.code], `roleDescriptions.${r.code}`).toBeTruthy();
      }
      for (const m of modules)
        expect(bo.permissionModules?.[m], `permissionModules.${m}`).toBeTruthy();
    });
  }

  it('el backoffice es solo español: en.json copia el español en roles y módulos', () => {
    expect(en.backoffice.permissionModules).toEqual(es.backoffice.permissionModules);
    expect(en.backoffice.roleDescriptions).toEqual(es.backoffice.roleDescriptions);
  });
});
