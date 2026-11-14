import { NotFoundException, type HttpException } from '@nestjs/common';
import { globalStaff, scopedStaff } from '../../test/support/staff-context.js';
import { A, B, MISSING, scheduleHarness } from '../../test/support/schedule-harness.js';

const MANAGER = globalStaff(['branches.read', 'branches.manage_hours']);
const NOW = '2026-11-16T18:00:00.000Z'; // lun 12:00 local

async function failure(p: Promise<unknown>): Promise<HttpException> {
  try {
    await p;
  } catch (e) {
    return e as HttpException;
  }
  throw new Error('no falló');
}
const code = (e: HttpException) => [e.getStatus(), (e.getResponse() as { code?: string }).code];

describe('BranchClosuresService', () => {
  describe('create', () => {
    it('crea un cierre futuro: normaliza a UTC, trunca al segundo, trim del motivo, audita', async () => {
      const h = scheduleHarness(NOW);
      const r = await h.closures.create(MANAGER, A, {
        startsAt: '2026-11-17T08:00:00.999-06:00',
        endsAt: '2026-11-17T12:00:00-06:00',
        reason: '  Mantenimiento  ',
      });
      expect(r).toMatchObject({
        branchId: A,
        startsAt: '2026-11-17T14:00:00.000Z',
        endsAt: '2026-11-17T18:00:00.000Z',
        reason: 'Mantenimiento',
        status: 'upcoming',
      });
      expect(h.repo.audit[0]).not.toHaveProperty('oldValues');
      expect(h.repo.audit).toEqual([
        expect.objectContaining({
          action: 'branch_closure.created',
          entityType: 'branch_closure',
          entityId: r.id,
          branchId: A,
          newValues: { startsAt: r.startsAt, endsAt: r.endsAt, reason: 'Mantenimiento' },
        }),
      ]);
    });

    it('permite un cierre de emergencia ya en curso (startsAt pasado, endsAt futuro) => active', async () => {
      const h = scheduleHarness(NOW);
      const r = await h.closures.create(MANAGER, A, {
        startsAt: '2026-11-16T17:00:00Z',
        endsAt: '2026-11-16T20:00:00Z',
      });
      expect(r).toMatchObject({ status: 'active', reason: null });
    });

    it('422 CLOSURE_RANGE_INVALID: no escribe ni audita', async () => {
      const h = scheduleHarness(NOW);
      const e = await failure(
        h.closures.create(MANAGER, A, {
          startsAt: '2026-11-16T10:00:00Z',
          endsAt: '2026-11-16T11:00:00Z',
        }),
      );
      expect(code(e)).toEqual([422, 'CLOSURE_RANGE_INVALID']);
      const violations = (e.getResponse() as { violations: { code: string; path: string }[] })
        .violations;
      expect(violations).toContainEqual(
        expect.objectContaining({ code: 'ALREADY_ENDED', path: 'endsAt' }),
      );
      expect(h.repo.closures).toHaveLength(0);
      expect(h.repo.audit).toHaveLength(0);
    });

    it('400: instante sin zona o motivo > 200 tras trim', async () => {
      const h = scheduleHarness(NOW);
      await expect(
        h.closures.create(MANAGER, A, {
          startsAt: '2026-11-17T10:00:00',
          endsAt: '2026-11-17T12:00:00Z',
        }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        h.closures.create(MANAGER, A, {
          startsAt: '2026-11-17T10:00:00Z',
          endsAt: '2026-11-17T12:00:00Z',
          reason: 'x'.repeat(201),
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('409 CLOSURE_OVERLAP con el cierre en conflicto en violations[0].path; contiguos permitidos', async () => {
      const h = scheduleHarness(NOW);
      const existing = h.repo.addClosure(A, '2026-11-17T10:00:00Z', '2026-11-17T12:00:00Z');
      const e = await failure(
        h.closures.create(MANAGER, A, {
          startsAt: '2026-11-17T11:00:00Z',
          endsAt: '2026-11-17T13:00:00Z',
        }),
      );
      expect(code(e)).toEqual([409, 'CLOSURE_OVERLAP']);
      expect(e.getResponse()).toMatchObject({ violations: [{ path: `closures/${existing.id}` }] });
      await expect(
        h.closures.create(MANAGER, A, {
          startsAt: '2026-11-17T12:00:00Z',
          endsAt: '2026-11-17T13:00:00Z',
        }),
      ).resolves.toBeDefined();
      await expect(
        h.closures.create(MANAGER, A, {
          startsAt: '2026-11-17T09:00:00Z',
          endsAt: '2026-11-17T10:00:00Z',
        }),
      ).resolves.toBeDefined();
    });

    it('un cierre de OTRA sucursal no genera solape', async () => {
      const h = scheduleHarness(NOW);
      h.repo.addClosure(B, '2026-11-17T10:00:00Z', '2026-11-17T12:00:00Z');
      await expect(
        h.closures.create(MANAGER, A, {
          startsAt: '2026-11-17T10:00:00Z',
          endsAt: '2026-11-17T12:00:00Z',
        }),
      ).resolves.toBeDefined();
    });

    it('EXCLUDE de BD (red de seguridad) => 409 CLOSURE_OVERLAP; rollback', async () => {
      const h = scheduleHarness(NOW);
      h.repo.failNextWriteWith = { code: '23P01', message: 'branch_closures_no_overlap' };
      const e = await failure(
        h.closures.create(MANAGER, A, {
          startsAt: '2026-11-17T10:00:00Z',
          endsAt: '2026-11-17T12:00:00Z',
        }),
      );
      expect(code(e)).toEqual([409, 'CLOSURE_OVERLAP']);
      expect(h.repo.audit).toHaveLength(0);
    });

    it('tope de 100 cierres vigentes o futuros por sucursal: el 101º => 422 CLOSURE_LIMIT_REACHED; los pasados no cuentan', async () => {
      const h = scheduleHarness(NOW);
      for (let i = 0; i < 50; i++)
        h.repo.addClosure(
          A,
          `2025-01-${String((i % 28) + 1).padStart(2, '0')}T0${i % 10}:00:00Z`,
          `2025-01-${String((i % 28) + 1).padStart(2, '0')}T0${i % 10}:30:00Z`,
        );
      for (let i = 0; i < 100; i++) {
        const start = Date.parse('2026-12-01T00:00:00Z') + i * 2 * 3_600_000;
        h.repo.addClosure(
          A,
          new Date(start).toISOString(),
          new Date(start + 3_600_000).toISOString(),
        );
      }
      h.repo.addClosure(B, '2026-12-01T00:00:00Z', '2026-12-01T01:00:00Z');
      const e = await failure(
        h.closures.create(MANAGER, A, {
          startsAt: '2027-01-01T00:00:00Z',
          endsAt: '2027-01-01T01:00:00Z',
        }),
      );
      expect(code(e)).toEqual([422, 'CLOSURE_LIMIT_REACHED']);
      expect(h.repo.closures.filter((c) => c.branchId === A)).toHaveLength(150);
      expect(h.repo.audit).toHaveLength(0);
      // Otra sucursal no se ve afectada y con 99 vigentes aún cabe uno.
      await expect(
        h.closures.create(MANAGER, B, {
          startsAt: '2027-01-01T00:00:00Z',
          endsAt: '2027-01-01T01:00:00Z',
        }),
      ).resolves.toBeDefined();
    });

    it('retroactividad: startsAt anterior a ahora - 1 h => 422 STARTS_TOO_EARLY en path startsAt', async () => {
      const h = scheduleHarness(NOW);
      const e = await failure(
        h.closures.create(MANAGER, A, {
          startsAt: '2026-11-16T16:59:59Z',
          endsAt: '2026-11-16T20:00:00Z',
        }),
      );
      expect(code(e)).toEqual([422, 'CLOSURE_RANGE_INVALID']);
      expect(e.getResponse()).toMatchObject({
        violations: [{ path: 'startsAt', code: 'STARTS_TOO_EARLY' }],
      });
      await expect(
        h.closures.create(MANAGER, A, {
          startsAt: '2026-11-16T17:00:00Z',
          endsAt: '2026-11-16T20:00:00Z',
        }),
      ).resolves.toBeDefined();
    });

    it('alcance: sin manage_hours en la sucursal o sucursal inexistente => 404', async () => {
      const h = scheduleHarness(NOW);
      const body = { startsAt: '2026-11-17T10:00:00Z', endsAt: '2026-11-17T12:00:00Z' };
      for (const staff of [
        globalStaff(['branches.read']),
        scopedStaff(['branches.manage_hours'], [B]),
      ]) {
        await expect(h.closures.create(staff, A, body)).rejects.toBeInstanceOf(NotFoundException);
      }
      await expect(h.closures.create(MANAGER, MISSING, body)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(h.repo.closures).toHaveLength(0);
    });
  });

  describe('list', () => {
    function seeded() {
      const h = scheduleHarness(NOW);
      const past = h.repo.addClosure(A, '2026-11-10T10:00:00Z', '2026-11-11T10:00:00Z', 'pasado');
      const active = h.repo.addClosure(A, '2026-11-16T15:00:00Z', '2026-11-16T20:00:00Z', 'activo');
      const up1 = h.repo.addClosure(A, '2026-11-20T10:00:00Z', '2026-11-20T12:00:00Z', 'futuro 1');
      const up2 = h.repo.addClosure(A, '2026-12-01T10:00:00Z', '2026-12-02T12:00:00Z', 'futuro 2');
      h.repo.addClosure(B, '2026-11-20T10:00:00Z', '2026-11-20T12:00:00Z', 'otra');
      return { h, past, active, up1, up2 };
    }
    const ids = (r: { items: { id: string }[] }) => r.items.map((i) => i.id);

    it('por defecto `current` = activos + futuros, ascendente, con motivo y estado; solo la sucursal pedida', async () => {
      const { h, active, up1, up2 } = seeded();
      const r = await h.closures.list(MANAGER, A, {});
      expect(ids(r)).toEqual([active.id, up1.id, up2.id]);
      expect(r).toMatchObject({ page: 1, pageSize: 20, total: 3 });
      expect(r.items.map((i) => i.status)).toEqual(['active', 'upcoming', 'upcoming']);
      expect(r.items[0]?.reason).toBe('activo');
    });

    it('status: upcoming, active, past (descendente) y all', async () => {
      const { h, past, active, up1, up2 } = seeded();
      expect(ids(await h.closures.list(MANAGER, A, { status: 'upcoming' }))).toEqual([
        up1.id,
        up2.id,
      ]);
      expect(ids(await h.closures.list(MANAGER, A, { status: 'active' }))).toEqual([active.id]);
      expect(ids(await h.closures.list(MANAGER, A, { status: 'past' }))).toEqual([past.id]);
      expect(ids(await h.closures.list(MANAGER, A, { status: 'all' }))).toEqual([
        up2.id,
        up1.id,
        active.id,
        past.id,
      ]);
    });

    it('from/to filtran los cierres que se solapan con [from, to); paginación', async () => {
      const { h, up1, up2 } = seeded();
      const r = await h.closures.list(MANAGER, A, {
        status: 'all',
        from: '2026-11-20T11:00:00Z',
        to: '2026-12-01T10:00:00Z',
      });
      expect(ids(r)).toEqual([up1.id]);
      const page = await h.closures.list(MANAGER, A, { status: 'all', page: 2, pageSize: 3 });
      expect(page).toMatchObject({ page: 2, pageSize: 3, total: 4 });
      expect(page.items).toHaveLength(1);
      expect(
        ids(await h.closures.list(MANAGER, A, { status: 'upcoming', to: '2026-11-20T10:00:00Z' })),
      ).toEqual([]);
      expect(up2.id).toBeDefined();
    });

    it('400: to <= from; fuera de alcance o inexistente => 404', async () => {
      const { h } = seeded();
      await expect(
        h.closures.list(MANAGER, A, { from: '2026-11-20T10:00:00Z', to: '2026-11-20T10:00:00Z' }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        h.closures.list(scopedStaff(['branches.read'], [B]), A, {}),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(h.closures.list(MANAGER, MISSING, {})).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update (D8)', () => {
    function seeded() {
      const h = scheduleHarness(NOW);
      return {
        h,
        past: h.repo.addClosure(A, '2026-11-10T10:00:00Z', '2026-11-11T10:00:00Z', 'p'),
        active: h.repo.addClosure(A, '2026-11-16T15:00:00Z', '2026-11-16T20:00:00Z', 'a'),
        future: h.repo.addClosure(A, '2026-11-20T10:00:00Z', '2026-11-20T12:00:00Z', 'f'),
        other: h.repo.addClosure(A, '2026-11-20T12:00:00Z', '2026-11-20T14:00:00Z'),
      };
    }

    it('futuro: cambia fechas y motivo; audita solo el diff real', async () => {
      const { h, future } = seeded();
      const r = await h.closures.update(MANAGER, A, future.id, {
        startsAt: '2026-11-19T10:00:00Z',
        reason: null,
      });
      expect(r).toMatchObject({
        startsAt: '2026-11-19T10:00:00.000Z',
        endsAt: '2026-11-20T12:00:00.000Z',
        reason: null,
      });
      expect(h.repo.audit.at(-1)).toMatchObject({
        action: 'branch_closure.updated',
        entityId: future.id,
        oldValues: { startsAt: '2026-11-20T10:00:00.000Z', reason: 'f' },
        newValues: { startsAt: '2026-11-19T10:00:00.000Z', reason: null },
      });
      expect(Object.keys(h.repo.audit.at(-1)?.newValues as object)).toEqual(['startsAt', 'reason']);
    });

    it('sin cambios reales: 200, sin escritura ni auditoría', async () => {
      const { h, future } = seeded();
      const spy = vi.spyOn(h.repo, 'updateClosure');
      const r = await h.closures.update(MANAGER, A, future.id, {
        reason: ' f ',
        endsAt: '2026-11-20T12:00:00Z',
      });
      expect(r.id).toBe(future.id);
      expect(spy).not.toHaveBeenCalled();
      expect(h.repo.audit).toHaveLength(0);
    });

    it('futuro que choca con otro => 409 CLOSURE_OVERLAP (excluyéndose a sí mismo)', async () => {
      const { h, future, other } = seeded();
      const e = await failure(
        h.closures.update(MANAGER, A, future.id, { endsAt: '2026-11-20T13:00:00Z' }),
      );
      expect(code(e)).toEqual([409, 'CLOSURE_OVERLAP']);
      expect(e.getResponse()).toMatchObject({ violations: [{ path: `closures/${other.id}` }] });
      await expect(
        h.closures.update(MANAGER, A, future.id, { endsAt: '2026-11-20T12:00:00Z', reason: 'x' }),
      ).resolves.toBeDefined();
    });

    it('en curso: solo acorta endsAt o cambia motivo; alargar o mover el inicio => 409 CLOSURE_NOT_EDITABLE', async () => {
      const { h, active } = seeded();
      const r = await h.closures.update(MANAGER, A, active.id, {
        endsAt: '2026-11-16T19:00:00Z',
        reason: 'b',
      });
      expect(r).toMatchObject({
        endsAt: '2026-11-16T19:00:00.000Z',
        reason: 'b',
        status: 'active',
      });
      expect(
        code(
          await failure(
            h.closures.update(MANAGER, A, active.id, { endsAt: '2026-11-16T21:00:00Z' }),
          ),
        ),
      ).toEqual([409, 'CLOSURE_NOT_EDITABLE']);
      expect(
        code(
          await failure(
            h.closures.update(MANAGER, A, active.id, { startsAt: '2026-11-16T14:00:00Z' }),
          ),
        ),
      ).toEqual([409, 'CLOSURE_NOT_EDITABLE']);
    });

    it('en curso: endsAt <= ahora lo termina YA (queda past con endsAt = ahora)', async () => {
      const { h, active } = seeded();
      const r = await h.closures.update(MANAGER, A, active.id, { endsAt: '2026-11-16T10:00:00Z' });
      expect(r).toMatchObject({ endsAt: NOW, status: 'past' });
      expect(
        (await h.availability.getAvailability({ branchId: A, at: new Date(NOW) })).reason,
      ).not.toBe('EXCEPTIONAL_CLOSURE');
    });

    it('terminado: inmutable (409); inexistente o de otra sucursal => 404', async () => {
      const { h, past } = seeded();
      expect(code(await failure(h.closures.update(MANAGER, A, past.id, { reason: 'x' })))).toEqual([
        409,
        'CLOSURE_NOT_EDITABLE',
      ]);
      await expect(h.closures.update(MANAGER, A, MISSING, { reason: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(h.closures.update(MANAGER, B, past.id, { reason: 'x' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('400 sin campos; 404 sin alcance', async () => {
      const { h, future } = seeded();
      await expect(h.closures.update(MANAGER, A, future.id, {})).rejects.toMatchObject({
        status: 400,
      });
      await expect(
        h.closures.update(scopedStaff(['branches.manage_hours'], [B]), A, future.id, {
          reason: 'x',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove (D8)', () => {
    it('futuro: borra y audita branch_closure.cancelled con los valores previos', async () => {
      const h = scheduleHarness(NOW);
      const c = h.repo.addClosure(A, '2026-11-20T10:00:00Z', '2026-11-20T12:00:00Z', 'f');
      await h.closures.remove(MANAGER, A, c.id);
      expect(h.repo.closures).toHaveLength(0);
      expect(h.repo.audit).toEqual([
        expect.objectContaining({
          action: 'branch_closure.cancelled',
          entityId: c.id,
          oldValues: {
            startsAt: '2026-11-20T10:00:00.000Z',
            endsAt: '2026-11-20T12:00:00.000Z',
            reason: 'f',
          },
        }),
      ]);
      await expect(h.closures.remove(MANAGER, A, c.id)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('en curso o terminado => 409 CLOSURE_NOT_DELETABLE; el inicio exacto cuenta como en curso', async () => {
      const h = scheduleHarness(NOW);
      const active = h.repo.addClosure(A, NOW, '2026-11-16T20:00:00Z');
      const past = h.repo.addClosure(A, '2026-11-10T10:00:00Z', '2026-11-11T10:00:00Z');
      for (const c of [active, past]) {
        expect(code(await failure(h.closures.remove(MANAGER, A, c.id)))).toEqual([
          409,
          'CLOSURE_NOT_DELETABLE',
        ]);
      }
      expect(h.repo.closures).toHaveLength(2);
      expect(h.repo.audit).toHaveLength(0);
    });

    it('alcance y pertenencia: otra sucursal o ajeno => 404', async () => {
      const h = scheduleHarness(NOW);
      const c = h.repo.addClosure(A, '2026-11-20T10:00:00Z', '2026-11-20T12:00:00Z');
      await expect(
        h.closures.remove(scopedStaff(['branches.manage_hours'], [B]), A, c.id),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(h.closures.remove(MANAGER, B, c.id)).rejects.toBeInstanceOf(NotFoundException);
      expect(h.repo.closures).toHaveLength(1);
    });
  });
});
