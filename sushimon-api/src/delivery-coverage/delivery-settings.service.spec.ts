import type { HttpException } from '@nestjs/common';
import { globalStaff, scopedStaff } from '../../test/support/staff-context.js';
import { A, B, coverageHarness, INACTIVE, MISSING } from '../../test/support/coverage-harness.js';
import { MockPedidosYaCoverageAdapter } from './mock-pedidosya-coverage.adapter.js';

const MANAGER = globalStaff(['branches.read', 'branches.manage_delivery_zones']);
const READER = globalStaff(['branches.read']);

async function failure(p: Promise<unknown>): Promise<HttpException> {
  try {
    await p;
  } catch (e) {
    return e as HttpException;
  }
  throw new Error('no falló');
}

describe('DeliverySettingsService', () => {
  it('fila ausente = defaults con isDefault y updatedAt null; sin escritura; refleja el adaptador (no es "conectado")', async () => {
    const h = coverageHarness();
    expect(await h.settings.get(READER, A)).toEqual({
      branchId: A,
      ownDeliveryZonesEnabled: false,
      pedidosyaEnabled: true,
      pedidosyaIntegrationStatus: 'BLOCKED_EXTERNAL',
      isDefault: true,
      updatedAt: null,
    });
    expect(h.repo.settings.size).toBe(0);
    const sim = coverageHarness(new MockPedidosYaCoverageAdapter('available'));
    expect((await sim.settings.get(READER, A)).pedidosyaIntegrationStatus).toBe('MOCK');
  });

  it('primer PATCH crea la fila (upsert) conservando el default del campo omitido; audita old/new solo de lo cambiado', async () => {
    const h = coverageHarness();
    const r = await h.settings.update(MANAGER, A, { ownDeliveryZonesEnabled: true });
    expect(r).toMatchObject({
      ownDeliveryZonesEnabled: true,
      pedidosyaEnabled: true,
      isDefault: false,
    });
    expect(r.updatedAt).toEqual(expect.any(String));
    expect(h.repo.audit).toEqual([
      expect.objectContaining({
        action: 'branch_delivery_settings.updated',
        entityType: 'branch_delivery_settings',
        entityId: A,
        branchId: A,
        oldValues: { ownDeliveryZonesEnabled: false },
        newValues: { ownDeliveryZonesEnabled: true },
      }),
    ]);
    const second = await h.settings.update(MANAGER, A, { pedidosyaEnabled: false });
    expect(second).toMatchObject({ ownDeliveryZonesEnabled: true, pedidosyaEnabled: false });
    expect(h.repo.audit.at(-1)).toMatchObject({
      oldValues: { pedidosyaEnabled: true },
      newValues: { pedidosyaEnabled: false },
    });
  });

  it('PATCH sin cambios reales (también sobre defaults sin fila) no escribe ni audita', async () => {
    const h = coverageHarness();
    const r = await h.settings.update(MANAGER, A, {
      ownDeliveryZonesEnabled: false,
      pedidosyaEnabled: true,
    });
    expect(r.isDefault).toBe(true);
    expect(h.repo.settings.size).toBe(0);
    expect(h.repo.audit).toEqual([]);
    await h.settings.update(MANAGER, A, { ownDeliveryZonesEnabled: true });
    await h.settings.update(MANAGER, A, { ownDeliveryZonesEnabled: true });
    expect(h.repo.audit).toHaveLength(1);
  });

  it('PATCH vacío => 400', async () => {
    const h = coverageHarness();
    expect((await failure(h.settings.update(MANAGER, A, {}))).getStatus()).toBe(400);
  });

  it('404: inexistente, fuera de alcance, sin permiso; sucursal INACTIVA sí se lee y se edita', async () => {
    const h = coverageHarness();
    const scopedA = scopedStaff(['branches.read', 'branches.manage_delivery_zones'], [A]);
    for (const p of [
      h.settings.get(MANAGER, MISSING),
      h.settings.get(scopedA, B),
      h.settings.get(globalStaff(['orders.read']), A),
      h.settings.update(MANAGER, MISSING, { pedidosyaEnabled: false }),
      h.settings.update(scopedA, B, { pedidosyaEnabled: false }),
      h.settings.update(READER, A, { pedidosyaEnabled: false }),
    ]) {
      expect((await failure(p)).getStatus()).toBe(404);
    }
    expect(h.repo.settings.size).toBe(0);
    expect((await h.settings.get(READER, INACTIVE)).isDefault).toBe(true);
    expect(
      (await h.settings.update(MANAGER, INACTIVE, { ownDeliveryZonesEnabled: true })).isDefault,
    ).toBe(false);
  });

  it('apagar OWN no borra zonas', async () => {
    const h = coverageHarness();
    await h.settings.update(MANAGER, A, { ownDeliveryZonesEnabled: true });
    h.repo.addZone({ branchId: A, municipalityId: 'e0000000-0000-4000-8000-000000000001' });
    await h.settings.update(MANAGER, A, { ownDeliveryZonesEnabled: false });
    expect(h.repo.zones.size).toBe(1);
  });

  it('atomicidad: si la escritura falla no queda fila ni auditoría', async () => {
    const h = coverageHarness();
    h.repo.failNextWriteWith = new Error('db caída');
    await failure(h.settings.update(MANAGER, A, { ownDeliveryZonesEnabled: true }));
    expect(h.repo.settings.size).toBe(0);
    expect(h.repo.audit).toEqual([]);
  });
});
