import { NotFoundException, type HttpException } from '@nestjs/common';
import { globalStaff, scopedStaff } from '../../test/support/staff-context.js';
import { A, B, MISSING, scheduleHarness } from '../../test/support/schedule-harness.js';
import type { HoursDayInput } from './schedule-policy.js';
import { hoursVersion, rowsToDays } from './schedule-policy.js';

const MANAGER = globalStaff(['branches.read', 'branches.manage_hours']);
const READER = globalStaff(['branches.read']);
const EMPTY_VERSION = hoursVersion(rowsToDays([]));

const week = (over: Record<number, [string, string][]> = {}): { days: HoursDayInput[] } => ({
  days: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
    weekday,
    intervals: (over[weekday] ?? []).map(([opensAt, closesAt]) => ({ opensAt, closesAt })),
  })),
});

async function failure(p: Promise<unknown>): Promise<HttpException> {
  try {
    await p;
  } catch (e) {
    return e as HttpException;
  }
  throw new Error('no falló');
}

describe('BranchHoursService', () => {
  describe('lectura', () => {
    it('admin: 7 días, zona, versión; sucursal sin horario = semana vacía', async () => {
      const h = scheduleHarness();
      const r = await h.hours.getAdmin(READER, A);
      expect(r.timezone).toBe('America/Guatemala');
      expect(r.version).toBe(EMPTY_VERSION);
      expect(r.days.map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(r.days.every((d) => d.intervals.length === 0)).toBe(true);
    });

    it('admin: fuera de alcance, inexistente y sin permiso de lectura => 404 idéntico; inactiva SÍ se lee', async () => {
      const h = scheduleHarness();
      h.repo.addBranch('55555555-5555-4555-8555-555555555555', false);
      const messages = [
        await failure(h.hours.getAdmin(scopedStaff(['branches.read'], [B]), A)),
        await failure(h.hours.getAdmin(READER, MISSING)),
        await failure(h.hours.getAdmin(globalStaff(['dashboard.read']), A)),
      ];
      for (const m of messages) expect(m).toBeInstanceOf(NotFoundException);
      expect(new Set(messages.map((m) => m.message)).size).toBe(1);
      await expect(
        h.hours.getAdmin(READER, '55555555-5555-4555-8555-555555555555'),
      ).resolves.toBeDefined();
    });

    it('público: solo activas; cierres sin motivo, máx. 10, ≤ 30 días, en curso incluidos', async () => {
      const h = scheduleHarness('2026-11-16T18:00:00.000Z');
      h.repo.addBranch(B, false);
      h.repo.addClosure(A, '2026-11-16T10:00:00Z', '2026-11-16T20:00:00Z', 'En curso'); // activo
      h.repo.addClosure(A, '2026-11-01T10:00:00Z', '2026-11-02T20:00:00Z', 'Pasado');
      h.repo.addClosure(A, '2026-12-16T18:00:01Z', '2026-12-17T18:00:00Z', 'Más allá de 30 días');
      for (let i = 0; i < 12; i++) {
        h.repo.addClosure(
          A,
          `2026-11-${20 + i}T10:00:00Z`.replace('-3', '-0'),
          `2026-11-${20 + i}T11:00:00Z`.replace('-3', '-0'),
          'x',
        );
      }
      const r = await h.hours.getPublic(A);
      expect(r.upcomingClosures).toHaveLength(10);
      expect(r.upcomingClosures[0]).toEqual({
        startsAt: '2026-11-16T10:00:00.000Z',
        endsAt: '2026-11-16T20:00:00.000Z',
      });
      expect(JSON.stringify(r)).not.toMatch(/reason|En curso|isActive|active/);
      await expect(h.hours.getPublic(B)).rejects.toBeInstanceOf(NotFoundException);
      await expect(h.hours.getPublic(MISSING)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('replace', () => {
    it('guarda, audita con diff real en la misma transacción y devuelve la nueva versión', async () => {
      const h = scheduleHarness();
      const input = {
        expectedVersion: EMPTY_VERSION,
        ...week({ 5: [['11:00', '24:00']], 6: [['00:00', '02:00']] }),
      };
      const r = await h.hours.replace(MANAGER, A, input);
      expect(r.days[4]?.intervals).toEqual([{ opensAt: '11:00', closesAt: '24:00' }]);
      expect(r.version).toBe(hoursVersion(r.days));
      expect(h.repo.hours.get(A)).toHaveLength(2);
      expect(h.repo.audit).toHaveLength(1);
      expect(h.repo.audit[0]).toMatchObject({
        action: 'branch.hours_updated',
        entityType: 'branch_hours',
        entityId: A,
        branchId: A,
        actorId: MANAGER.staffId,
        oldValues: { weekday_5: '', weekday_6: '', version: EMPTY_VERSION },
        newValues: { weekday_5: '11:00-24:00', weekday_6: '00:00-02:00', version: r.version },
      });
    });

    it('PUT idéntico es idempotente: 200, sin escritura ni auditoría', async () => {
      const h = scheduleHarness();
      const first = await h.hours.replace(MANAGER, A, {
        expectedVersion: EMPTY_VERSION,
        ...week({ 1: [['11:00', '22:00']] }),
      });
      const spy = vi.spyOn(h.repo, 'replaceHours');
      const again = await h.hours.replace(MANAGER, A, {
        expectedVersion: first.version,
        ...week({ 1: [['11:00', '22:00']] }),
      });
      expect(again).toEqual(first);
      expect(spy).not.toHaveBeenCalled();
      expect(h.repo.audit).toHaveLength(1);
    });

    it('versión desactualizada => 409 HOURS_VERSION_CONFLICT y no guarda', async () => {
      const h = scheduleHarness();
      await h.hours.replace(MANAGER, A, {
        expectedVersion: EMPTY_VERSION,
        ...week({ 1: [['11:00', '22:00']] }),
      });
      const e = await failure(
        h.hours.replace(MANAGER, A, {
          expectedVersion: EMPTY_VERSION,
          ...week({ 2: [['11:00', '22:00']] }),
        }),
      );
      expect(e.getStatus()).toBe(409);
      expect(e.getResponse()).toMatchObject({ code: 'HOURS_VERSION_CONFLICT' });
      expect(h.repo.hours.get(A)).toHaveLength(1);
      expect(h.repo.audit).toHaveLength(1);
    });

    it('dos PUT con la misma versión: el primero gana y el segundo recibe 409', async () => {
      const h = scheduleHarness();
      const [x, y] = await Promise.allSettled([
        h.hours.replace(MANAGER, A, {
          expectedVersion: EMPTY_VERSION,
          ...week({ 1: [['10:00', '12:00']] }),
        }),
        h.hours.replace(MANAGER, A, {
          expectedVersion: EMPTY_VERSION,
          ...week({ 1: [['13:00', '15:00']] }),
        }),
      ]);
      expect([x.status, y.status].sort()).toEqual(['fulfilled', 'rejected']);
      expect(h.repo.audit).toHaveLength(1);
    });

    it('422 SCHEDULE_INVALID: no escribe ni audita', async () => {
      const h = scheduleHarness();
      const e = await failure(
        h.hours.replace(MANAGER, A, {
          expectedVersion: EMPTY_VERSION,
          ...week({
            1: [
              ['11:00', '15:00'],
              ['14:00', '16:00'],
            ],
          }),
        }),
      );
      expect(e.getStatus()).toBe(422);
      expect(e.getResponse()).toMatchObject({ code: 'SCHEDULE_INVALID' });
      expect(h.repo.hours.get(A)).toBeUndefined();
      expect(h.repo.audit).toHaveLength(0);
    });

    it('error de BD al escribir: rollback completo (horario previo intacto, sin auditoría) y traducción', async () => {
      const h = scheduleHarness();
      const first = await h.hours.replace(MANAGER, A, {
        expectedVersion: EMPTY_VERSION,
        ...week({ 1: [['11:00', '22:00']] }),
      });
      h.repo.failNextWriteWith = { code: '23P01', message: 'branch_hours_no_overlap' };
      const e = await failure(
        h.hours.replace(MANAGER, A, {
          expectedVersion: first.version,
          ...week({ 3: [['09:00', '10:00']] }),
        }),
      );
      expect(e.getStatus()).toBe(422);
      expect(h.repo.hours.get(A)).toHaveLength(1);
      expect(h.repo.audit).toHaveLength(1);
      expect((await h.hours.getAdmin(READER, A)).version).toBe(first.version);
    });

    it('un error inesperado de BD no se enmascara como 4xx', async () => {
      const h = scheduleHarness();
      h.repo.failNextWriteWith = new Error('conexión caída');
      await expect(
        h.hours.replace(MANAGER, A, {
          expectedVersion: EMPTY_VERSION,
          ...week({ 1: [['11:00', '22:00']] }),
        }),
      ).rejects.toThrow('conexión caída');
    });

    it('alcance: solo `branches.manage_hours` en la sucursal; otra sucursal, solo lectura o inexistente => 404', async () => {
      const h = scheduleHarness();
      const body = { expectedVersion: EMPTY_VERSION, ...week({ 1: [['11:00', '22:00']] }) };
      for (const staff of [
        scopedStaff(['branches.manage_hours'], [B]),
        READER,
        scopedStaff(['branches.read'], [A]),
      ]) {
        await expect(h.hours.replace(staff, A, body)).rejects.toBeInstanceOf(NotFoundException);
      }
      await expect(h.hours.replace(MANAGER, MISSING, body)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(h.repo.audit).toHaveLength(0);
    });

    it('gerente con manage_hours solo en su sucursal puede editarla', async () => {
      const h = scheduleHarness();
      const staff = scopedStaff(['branches.read', 'branches.manage_hours'], [A]);
      await expect(
        h.hours.replace(staff, A, {
          expectedVersion: EMPTY_VERSION,
          ...week({ 1: [['11:00', '22:00']] }),
        }),
      ).resolves.toBeDefined();
    });

    it('se puede preparar el horario de una sucursal inactiva', async () => {
      const h = scheduleHarness();
      h.repo.addBranch(B, false);
      await expect(
        h.hours.replace(MANAGER, B, {
          expectedVersion: EMPTY_VERSION,
          ...week({ 1: [['11:00', '22:00']] }),
        }),
      ).resolves.toBeDefined();
    });

    it('semana vacía es válida y deja SCHEDULE_NOT_CONFIGURED', async () => {
      const h = scheduleHarness();
      const first = await h.hours.replace(MANAGER, A, {
        expectedVersion: EMPTY_VERSION,
        ...week({ 1: [['11:00', '22:00']] }),
      });
      const cleared = await h.hours.replace(MANAGER, A, {
        expectedVersion: first.version,
        ...week(),
      });
      expect(cleared.version).toBe(EMPTY_VERSION);
      const r = await h.availability.getAvailability({
        branchId: A,
        at: new Date('2026-11-16T17:00:00Z'),
      });
      expect(r.reason).toBe('SCHEDULE_NOT_CONFIGURED');
    });
  });
});
