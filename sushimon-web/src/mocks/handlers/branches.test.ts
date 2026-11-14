import { describe, expect, it } from 'vitest';
import type { AdminBranch, AdminBranchPage, Branch, PublicBranch } from '@/lib/data-access/models';
import { ApiError } from '@/lib/data-access/errors';
import { paths } from '@/lib/data-access/paths';
import * as schedule from '@/services/branch-schedule';
import * as branches from '@/services/branches';
import { listBranches } from '@/services/store';
import { createHarness } from '../testing';

const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (e) {
    return e instanceof ApiError ? e.status : -1;
  }
};
const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiError) return e;
  }
  throw new Error('se esperaba un ApiError');
};
const base = {
  code: 'zona-11',
  name: 'Zona 11',
  address: '3a avenida 12-30, Zona 11',
  active: true,
};

describe('F07 público: /v1/branches', () => {
  it('lista solo sucursales activas y solo campos públicos', async () => {
    const h = createHarness();
    const list = await branches.listPublicBranches(h.client);
    expect(list.map((b) => b.code)).toEqual(['sucursal-1', 'sucursal-2', 'sucursal-3']);
    expect(Object.keys(list[0]!).sort()).toEqual(
      ['address', 'code', 'id', 'latitude', 'longitude', 'name', 'phone'].sort(),
    );
    expect(list[0]).not.toHaveProperty('active');
    expect(list[0]).not.toHaveProperty('isOpen');
    expect(list[0]).not.toHaveProperty('createdAt');
  });

  it('el detalle de una inactiva o inexistente es 404', async () => {
    const h = createHarness();
    expect((await branches.getPublicBranch(h.client, 'sucursal-2')).name).toBe('Sucursal 2');
    expect(await status(branches.getPublicBranch(h.client, 'sucursal-4'))).toBe(404);
    expect(await status(branches.getPublicBranch(h.client, 'nope'))).toBe(404);
  });

  it('no existe DELETE ni las rutas viejas de backoffice', async () => {
    const h = createHarness();
    h.asStaff('admin');
    expect(await status(h.client.delete(paths.adminBranch('sucursal-1')))).toBe(404);
    expect(await status(h.client.get('/v1/backoffice/branches'))).toBe(404);
  });
});

describe('F07 admin: autorización y alcance', () => {
  it('sin sesión 401; cocina (sin branches.read) 403; escenario forbidden 403', async () => {
    const h = createHarness();
    expect(await status(branches.listAdminBranches(h.client))).toBe(401);
    h.asStaff('kitchen');
    expect(await status(branches.listAdminBranches(h.client))).toBe(403);
    expect(await status(branches.createAdminBranch(h.client, base))).toBe(403);
    const f = createHarness('forbidden');
    f.asStaff('admin');
    expect(await status(branches.listAdminBranches(f.client))).toBe(403);
  });

  it('encargado (branches.read acotada): lista solo la suya, detalle ajeno 404, sin editar ni crear', async () => {
    const h = createHarness();
    h.asStaff('manager');
    const page = await branches.listAdminBranches(h.client);
    expect(page.items.map((b) => b.id)).toEqual(['sucursal-1']);
    expect(page.total).toBe(1);
    expect(await status(branches.getAdminBranch(h.client, 'sucursal-3'))).toBe(404);
    // Sin `branches.update` / `branches.create`: 403 (el permiso se comprueba antes que el alcance).
    expect(await status(branches.updateAdminBranch(h.client, 'sucursal-1', { name: 'X' }))).toBe(
      403,
    );
    expect(await status(branches.createAdminBranch(h.client, base))).toBe(403);
  });

  it('con branches.update en su sucursal: edita la suya, la ajena 404 y el alta sigue siendo 403', async () => {
    const h = createHarness();
    h.store.roles.find((r) => r.code === 'manager')!.permissions.push('branches.update');
    h.asStaff('manager');
    expect(
      (await branches.updateAdminBranch(h.client, 'sucursal-1', { name: 'Nuevo nombre' })).name,
    ).toBe('Nuevo nombre');
    expect(await status(branches.updateAdminBranch(h.client, 'sucursal-3', { name: 'X' }))).toBe(
      404,
    );
    expect(
      await status(branches.setAdminBranchStatus(h.client, 'sucursal-3', { active: true })),
    ).toBe(404);
    expect(await status(branches.createAdminBranch(h.client, base))).toBe(403);
  });
});

describe('F07 admin: listado', () => {
  it('devuelve activas e inactivas con sus campos administrativos', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const page = await branches.listAdminBranches(h.client);
    expect(page).toMatchObject({ page: 1, pageSize: 20, total: 5 });
    const four = page.items.find((b) => b.code === 'sucursal-4')!;
    expect(four).toMatchObject({ active: false, latitude: null, longitude: null });
    expect(four.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('filtra por q (nombre o código) y por estado', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const q = await branches.listAdminBranches(h.client, { q: 'SUCURSAL 2' });
    expect(q.items.map((b) => b.id)).toEqual(['sucursal-2']);
    expect((await branches.listAdminBranches(h.client, { q: 'sucursal-' })).total).toBe(5);
    const inactive = await branches.listAdminBranches(h.client, { active: false });
    expect(inactive.items.map((b) => b.id)).toEqual(['sucursal-4', 'sucursal-5']);
    expect((await branches.listAdminBranches(h.client, { active: true })).total).toBe(3);
  });

  it('ordena y pagina', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const desc = await branches.listAdminBranches(h.client, { sort: 'code', order: 'desc' });
    expect(desc.items.map((b) => b.code)[0]).toBe('sucursal-5');
    const p2 = await branches.listAdminBranches(h.client, { page: 2, pageSize: 2 });
    expect(p2).toMatchObject({ page: 2, pageSize: 2, total: 5 });
    expect(p2.items.map((b) => b.id)).toEqual(['sucursal-3', 'sucursal-4']);
    expect((await branches.listAdminBranches(h.client, { page: 9 })).items).toEqual([]);
  });

  it('parámetros inválidos responden 400 con detalles', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const get = (query: Record<string, string>) =>
      h.client.get<AdminBranchPage>(paths.adminBranches(), { query });
    const queries: Record<string, string>[] = [
      { sort: 'phone' },
      { order: 'up' },
      { page: '0' },
      { page: 'x' },
      { pageSize: '101' },
      { active: 'si' },
      { q: 'x'.repeat(101) },
    ];
    for (const query of queries) {
      const e = await failure(get(query));
      expect(e.status, JSON.stringify(query)).toBe(400);
      expect(e.details?.length).toBeGreaterThan(0);
    }
  });
});

describe('F07 admin: alta', () => {
  it('crea, normaliza el código y aparece en público y en la operación simulada (sin horario configurado)', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const created = await branches.createAdminBranch(h.client, {
      ...base,
      code: '  Zona-11 ',
      phone: '+502 2222-3333',
    });
    expect(created).toMatchObject({
      code: 'zona-11',
      name: 'Zona 11',
      active: true,
      latitude: null,
      longitude: null,
      phone: '+502 2222-3333',
    });
    const pub = await branches.listPublicBranches(h.client);
    expect(pub.map((b) => b.code)).toContain('zona-11');
    const ops = (await listBranches(h.client)).find((b) => b.id === created.id) as Branch;
    expect(ops).toMatchObject({ coverage: [] });
    // F08: nace sin horario (no se asume abierta) y la disponibilidad lo dice el servidor.
    const week = await schedule.getAdminBranchHours(h.client, created.id);
    expect(week.days).toHaveLength(7);
    expect(week.days.every((d) => d.intervals.length === 0)).toBe(true);
    expect(await schedule.getBranchAvailability(h.client, created.id)).toMatchObject({
      reason: 'SCHEDULE_NOT_CONFIGURED',
      isOpenNow: false,
      isAcceptingOrders: false,
    });
  });

  it('un código duplicado responde 409 (también tras normalizar)', async () => {
    const h = createHarness();
    h.asStaff('admin');
    await branches.createAdminBranch(h.client, base);
    expect(await status(branches.createAdminBranch(h.client, { ...base, code: 'ZONA-11' }))).toBe(
      409,
    );
    expect(
      await status(branches.createAdminBranch(h.client, { ...base, code: 'sucursal-1' })),
    ).toBe(409);
  });

  it('valida con 400: código, obligatorios, teléfono, coordenadas y campos no permitidos', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const bad = (extra: Record<string, unknown>) =>
      failure(h.client.post(paths.adminBranches(), { ...base, ...extra }));
    for (const extra of [
      { code: 'A_B' },
      { code: 'a' },
      { code: '-ab' },
      { name: ' ' },
      { address: '' },
      { phone: '123' },
      { latitude: 14.6 },
      { longitude: -90.5 },
      { latitude: 91, longitude: 0 },
      { latitude: 0, longitude: 181 },
      { active: 'yes' },
      { id: 'x' },
    ]) {
      expect((await bad(extra)).status, JSON.stringify(extra)).toBe(400);
    }
    expect((await bad({ latitude: 14.6 })).details).toContain(
      'latitude/longitude: deben venir ambas o ninguna',
    );
  });

  it('acepta coordenadas completas y nace inactiva si se pide', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const c = await branches.createAdminBranch(h.client, {
      ...base,
      latitude: 14.6,
      longitude: -90.5,
      active: false,
    });
    expect(c).toMatchObject({ latitude: 14.6, longitude: -90.5, active: false });
    expect((await branches.listPublicBranches(h.client)).map((b) => b.id)).not.toContain(c.id);
  });

  it('sin `active` en el cuerpo la sucursal nace activa (default del contrato)', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const { active: _omit, ...withoutActive } = base;
    void _omit;
    const c = await h.client.post<AdminBranch>(paths.adminBranches(), withoutActive);
    expect(c.active).toBe(true);
  });

  it('no impone tope de sucursales', async () => {
    const h = createHarness();
    h.asStaff('admin');
    for (let i = 0; i < 4; i += 1) {
      await branches.createAdminBranch(h.client, { ...base, code: `extra-${i}` });
    }
    expect((await branches.listAdminBranches(h.client)).total).toBe(9);
  });
});

describe('F07 admin: edición', () => {
  it('actualiza solo lo enviado y permite borrar teléfono y coordenadas con null', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const a = await branches.updateAdminBranch(h.client, 'sucursal-1', {
      name: 'Cuatro Grados',
      latitude: 14.6,
      longitude: -90.5,
    });
    expect(a).toMatchObject({ name: 'Cuatro Grados', latitude: 14.6, address: expect.any(String) });
    const b = await branches.updateAdminBranch(h.client, 'sucursal-1', {
      phone: null,
      latitude: null,
      longitude: null,
    });
    expect(b).toMatchObject({ phone: null, latitude: null, longitude: null, code: 'sucursal-1' });
    const pub = await branches.getPublicBranch(h.client, 'sucursal-1');
    expect(pub.name).toBe('Cuatro Grados');
  });

  it('code, active, createdAt e id no se aceptan (400); cuerpo vacío 400; inexistente 404', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const patch = (b: object) => status(h.client.patch(paths.adminBranch('sucursal-1'), b));
    expect(await patch({ code: 'nuevo' })).toBe(400);
    expect(await patch({ active: false })).toBe(400);
    expect(await patch({ createdAt: '2020-01-01T00:00:00Z' })).toBe(400);
    expect(await patch({ id: 'x' })).toBe(400);
    expect(await patch({})).toBe(400);
    expect(await patch({ latitude: 14.6 })).toBe(400); // quedaría una sola coordenada
    expect(await status(branches.updateAdminBranch(h.client, 'nope', { name: 'X' }))).toBe(404);
    const detail = await branches.getAdminBranch(h.client, 'sucursal-1');
    expect(detail.code).toBe('sucursal-1');
    expect(detail.active).toBe(true);
  });
});

describe('F07 admin: estado administrativo', () => {
  it('desactivar exige motivo (400); con motivo oculta la sucursal en público', async () => {
    const h = createHarness();
    h.asStaff('admin');
    expect(
      await status(branches.setAdminBranchStatus(h.client, 'sucursal-2', { active: false })),
    ).toBe(400);
    expect(
      await status(
        branches.setAdminBranchStatus(h.client, 'sucursal-2', { active: false, reason: '  ' }),
      ),
    ).toBe(400);
    expect(
      await status(
        branches.setAdminBranchStatus(h.client, 'sucursal-2', {
          active: false,
          reason: 'x'.repeat(201),
        }),
      ),
    ).toBe(400);
    const off = await branches.setAdminBranchStatus(h.client, 'sucursal-2', {
      active: false,
      reason: 'Remodelación',
    });
    expect(off.active).toBe(false);
    expect((await branches.listPublicBranches(h.client)).map((b) => b.id)).not.toContain(
      'sucursal-2',
    );
    expect(await status(branches.getPublicBranch(h.client, 'sucursal-2'))).toBe(404);
  });

  it('activar no exige motivo y es idempotente', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const on = await branches.setAdminBranchStatus(h.client, 'sucursal-4', { active: true });
    expect(on.active).toBe(true);
    expect(
      (await branches.setAdminBranchStatus(h.client, 'sucursal-4', { active: true })).active,
    ).toBe(true);
    expect((await branches.listPublicBranches(h.client)).map((b) => b.id)).toContain('sucursal-4');
  });

  it('`active` no toca el horario ni los cierres (F08): solo cambia el estado administrativo', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const before = (await schedule.getAdminBranchHours(h.client, 'sucursal-2')).version;
    const closuresBefore = h.store.closures.length;
    await branches.setAdminBranchStatus(h.client, 'sucursal-2', { active: false, reason: 'x' });
    await branches.setAdminBranchStatus(h.client, 'sucursal-2', { active: true });
    expect((await schedule.getAdminBranchHours(h.client, 'sucursal-2')).version).toBe(before);
    expect(h.store.closures).toHaveLength(closuresBefore);
  });

  it('cuerpo inválido 400 (active faltante o campos extra)', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const patch = (b: object) => status(h.client.patch(paths.adminBranchStatus('sucursal-1'), b));
    expect(await patch({})).toBe(400);
    expect(await patch({ active: 'no' })).toBe(400);
    expect(await patch({ active: true, name: 'X' })).toBe(400);
  });
});

describe('contrato: forma de los tipos', () => {
  it('AdminBranch y PublicBranch del mock cumplen el esquema', async () => {
    const h = createHarness();
    h.asStaff('admin');
    const a: AdminBranch = await branches.getAdminBranch(h.client, 'sucursal-1');
    const p: PublicBranch = await branches.getPublicBranch(h.client, 'sucursal-1');
    expect(a).toMatchObject(p);
  });
});
