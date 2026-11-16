import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { ErrorViolation } from '../common/errors/coded-exception.js';
import type { StaffContext } from '../identity/identity.types.js';
import { translateModifierDbError, type ModifierDbContext } from './modifier-db-errors.js';
import {
  applyGroup,
  assertLimits,
  assertReachable,
  diffGroup,
  diffOption,
  groupInvalid,
  groupNotFound,
  limitReached,
  MAX_OPTIONS_PER_GROUP,
  modifierNameTaken,
  modifierNotFound,
  nameKey,
  normalizeCreateGroup,
  normalizeExtraPrice,
  normalizeGroupIds,
  normalizeName,
  normalizeUpdateGroup,
  normalizeUpdateOption,
  productNotFound,
  reorderMismatch,
  groupUnsatisfiable,
  sameList,
  toOptionView,
  DEFAULT_EXTRA_PRICE,
  type CreateGroupInput,
  type UpdateGroupInput,
  type UpdateOptionInput,
} from './modifier-policy.js';
import { ModifiersQueryService } from './modifiers-query.service.js';
import { ModifiersRepository, type ModifierTx } from './modifiers.repository.js';
import type {
  AdminModifierGroupView,
  AdminModifierView,
  AdminProductModifiersView,
} from './modifiers.types.js';

export interface CreateOptionInput {
  name: unknown;
  extraPrice?: unknown;
  active?: boolean;
}

/**
 * Comandos de escritura de modificadores. El catálogo es global: las escrituras exigen alcance GLOBAL del permiso
 * (403 antes de leer nada). Cada transacción (READ COMMITTED) bloquea la fila del grupo o del producto ANTES de leer
 * para validar, escribe y audita junta. Los errores de BD se traducen en `translateModifierDbError`.
 */
@Injectable()
export class AdminModifiersService {
  private readonly logger = new Logger(AdminModifiersService.name);

  constructor(
    @Inject(ModifiersRepository) private readonly repo: ModifiersRepository,
    @Inject(ModifiersQueryService) private readonly queries: ModifiersQueryService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuthorizationService) private readonly authorization: AuthorizationService,
  ) {}

  async createGroup(staff: StaffContext, input: CreateGroupInput): Promise<AdminModifierGroupView> {
    this.assertGlobal(staff, 'catalog.create');
    const data = normalizeCreateGroup(input);
    // Las opciones iniciales nacen activas: un grupo activo exige min <= nº de opciones.
    assertReachable(data.active, data.minSelect, data.options.length);

    const view = await this.inTransaction(async (tx) => {
      const group = await this.repo.insertGroup(tx, {
        name: data.name,
        minSelect: data.minSelect,
        maxSelect: data.maxSelect,
        active: data.active,
      });
      await this.audit.record(tx, {
        actorId: staff.staffId,
        entityType: 'modifier_group',
        entityId: group.id,
        action: 'modifier_group.created',
        newValues: {
          name: group.name,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          active: group.active,
          optionCount: data.options.length,
        },
      });
      const options = await this.repo.insertOptions(
        tx,
        data.options.map((o, sortOrder) => ({
          groupId: group.id,
          name: o.name,
          extraPrice: o.extraPrice,
          active: true,
          sortOrder,
        })),
      );
      for (const o of options) {
        await this.audit.record(tx, {
          actorId: staff.staffId,
          entityType: 'modifier',
          entityId: o.id,
          action: 'modifier.created',
          newValues: {
            groupId: group.id,
            name: o.name,
            extraPrice: o.extraPrice,
            active: o.active,
            sortOrder: o.sortOrder,
          },
        });
      }
      return this.queries.getGroup(group.id, tx);
    }, 'group');
    this.logger.log(`Grupo de modificadores creado (id=${view.id}, staff=${staff.staffId})`);
    return view;
  }

  async updateGroup(
    staff: StaffContext,
    id: string,
    input: UpdateGroupInput,
  ): Promise<AdminModifierGroupView> {
    this.assertGlobal(staff, 'catalog.update');
    const changes = normalizeUpdateGroup(input);

    const result = await this.inTransaction(async (tx) => {
      if (!(await this.repo.lockGroup(tx, id))) throw groupNotFound();
      const current = await this.repo.findGroupById(id, tx);
      if (!current) throw groupNotFound();
      const diff = diffGroup(current, changes);
      if (!diff) return { view: await this.queries.getGroup(id, tx), changed: false };

      const next = applyGroup(current, diff.changes);
      assertLimits(next.minSelect, next.maxSelect);
      if (diff.changes.minSelect !== undefined || diff.changes.active === true) {
        const options = await this.repo.findOptionsByGroupIds([id], tx);
        assertReachable(next.active, next.minSelect, options.filter((o) => o.active).length);
      }
      await this.repo.updateGroup(tx, id, { ...diff.changes, updatedAt: new Date() });
      if (diff.hasFieldChanges) {
        await this.audit.record(tx, {
          actorId: staff.staffId,
          entityType: 'modifier_group',
          entityId: id,
          action: 'modifier_group.updated',
          oldValues: diff.oldValues,
          newValues: diff.newValues,
        });
      }
      if (diff.changes.active !== undefined) {
        await this.audit.record(tx, {
          actorId: staff.staffId,
          entityType: 'modifier_group',
          entityId: id,
          action: diff.changes.active ? 'modifier_group.activated' : 'modifier_group.deactivated',
          oldValues: { active: current.active },
          newValues: { active: diff.changes.active },
        });
      }
      return { view: await this.queries.getGroup(id, tx), changed: true };
    }, 'group');
    if (result.changed) {
      this.logger.log(`Grupo de modificadores actualizado (id=${id}, staff=${staff.staffId})`);
    }
    return result.view;
  }

  async createOption(
    staff: StaffContext,
    groupId: string,
    input: CreateOptionInput,
  ): Promise<AdminModifierView> {
    this.assertGlobal(staff, 'catalog.create');
    const name = normalizeName(input.name);
    const extraPrice =
      input.extraPrice === undefined ? DEFAULT_EXTRA_PRICE : normalizeExtraPrice(input.extraPrice);
    const active = input.active ?? true;

    const view = await this.inTransaction(async (tx) => {
      if (!(await this.repo.lockGroup(tx, groupId))) throw groupNotFound();
      const siblings = await this.repo.findOptionsByGroupIds([groupId], tx);
      if (siblings.length >= MAX_OPTIONS_PER_GROUP)
        throw limitReached(`Un grupo admite como máximo ${MAX_OPTIONS_PER_GROUP} opciones`);
      if (siblings.some((o) => nameKey(o.name) === nameKey(name))) throw modifierNameTaken();
      const sortOrder = siblings.reduce((max, o) => Math.max(max, o.sortOrder), -1) + 1;
      const [row] = await this.repo.insertOptions(tx, [
        { groupId, name, extraPrice, active, sortOrder },
      ]);
      if (!row) throw new Error('Opción no creada');
      await this.audit.record(tx, {
        actorId: staff.staffId,
        entityType: 'modifier',
        entityId: row.id,
        action: 'modifier.created',
        newValues: { groupId, name, extraPrice, active, sortOrder },
      });
      return toOptionView(row);
    }, 'option');
    this.logger.log(`Opción de modificador creada (id=${view.id}, staff=${staff.staffId})`);
    return view;
  }

  async updateOption(
    staff: StaffContext,
    id: string,
    input: UpdateOptionInput,
  ): Promise<AdminModifierView> {
    this.assertGlobal(staff, 'catalog.update');
    const changes = normalizeUpdateOption(input);

    const result = await this.inTransaction(async (tx) => {
      const first = await this.repo.findOptionById(id, tx);
      if (!first) throw modifierNotFound();
      // Se bloquea el GRUPO de la opción y se relee: la validación usa el estado ya serializado.
      if (!(await this.repo.lockGroup(tx, first.groupId))) throw modifierNotFound();
      const current = await this.repo.findOptionById(id, tx);
      if (!current) throw modifierNotFound();
      const diff = diffOption(current, changes);
      if (!diff) return { view: toOptionView(current), changed: false };

      if (diff.changes.name !== undefined || diff.changes.active === false) {
        const siblings = await this.repo.findOptionsByGroupIds([current.groupId], tx);
        const newName = diff.changes.name;
        if (
          newName !== undefined &&
          siblings.some((o) => o.id !== id && nameKey(o.name) === nameKey(newName))
        )
          throw modifierNameTaken();
        if (diff.changes.active === false && current.active) {
          const group = await this.repo.findGroupById(current.groupId, tx);
          const remaining = siblings.filter((o) => o.active && o.id !== id).length;
          if (group?.active && remaining < group.minSelect) throw groupUnsatisfiable();
        }
      }
      const row = await this.repo.updateOption(tx, id, { ...diff.changes, updatedAt: new Date() });
      if (diff.hasFieldChanges) {
        await this.audit.record(tx, {
          actorId: staff.staffId,
          entityType: 'modifier',
          entityId: id,
          action: 'modifier.updated',
          oldValues: diff.oldValues,
          newValues: diff.newValues,
        });
      }
      if (diff.changes.active !== undefined) {
        await this.audit.record(tx, {
          actorId: staff.staffId,
          entityType: 'modifier',
          entityId: id,
          action: diff.changes.active ? 'modifier.activated' : 'modifier.deactivated',
          oldValues: { active: current.active },
          newValues: { active: diff.changes.active },
        });
      }
      return { view: toOptionView(row), changed: true };
    }, 'option');
    if (result.changed) {
      this.logger.log(`Opción de modificador actualizada (id=${id}, staff=${staff.staffId})`);
    }
    return result.view;
  }

  /** Orden EXACTO de todas las opciones: `sort_order` 0..n-1; repetir el mismo orden no escribe ni audita. */
  async reorderOptions(
    staff: StaffContext,
    groupId: string,
    orderedIds: readonly string[],
  ): Promise<{ items: AdminModifierView[] }> {
    this.assertGlobal(staff, 'catalog.update');
    const wanted = orderedIds.map((id) => id.toLowerCase());

    return this.inTransaction(async (tx) => {
      if (!(await this.repo.lockGroup(tx, groupId))) throw groupNotFound();
      const options = await this.repo.findOptionsByGroupIds([groupId], tx);
      const current = [...options].sort((a, b) => a.sortOrder - b.sortOrder);
      const known = new Set(current.map((o) => o.id));
      if (
        wanted.length !== current.length ||
        new Set(wanted).size !== wanted.length ||
        !wanted.every((id) => known.has(id))
      )
        throw reorderMismatch();
      if (
        sameList(
          wanted,
          current.map((o) => o.id),
        )
      ) {
        return { items: current.map(toOptionView) };
      }
      await this.repo.setOptionOrder(tx, groupId, wanted);
      await this.audit.record(tx, {
        actorId: staff.staffId,
        entityType: 'modifier_group',
        entityId: groupId,
        action: 'modifier.reordered',
        oldValues: { orderedIds: current.map((o) => o.id) },
        newValues: { orderedIds: wanted },
      });
      const after = await this.repo.findOptionsByGroupIds([groupId], tx);
      this.logger.log(`Opciones reordenadas (group=${groupId}, staff=${staff.staffId})`);
      return { items: after.map(toOptionView) };
    });
  }

  /** Reemplaza la lista COMPLETA y ORDENADA de grupos de un producto (única operación de borrado: la asociación). */
  async replaceProductGroups(
    staff: StaffContext,
    productId: string,
    groupIds: readonly string[],
  ): Promise<AdminProductModifiersView> {
    this.assertGlobal(staff, 'catalog.update');
    const wanted = normalizeGroupIds(groupIds);

    return this.inTransaction(async (tx) => {
      if (!(await this.repo.lockProduct(tx, productId))) throw productNotFound();
      const links = await this.repo.findProductLinks(tx, productId);
      const currentIds = links.map((l) => l.groupId);
      if (sameList(wanted, currentIds)) return this.queries.getProductModifiers(productId, tx);

      const attached = new Set(currentIds);
      const added = wanted.filter((id) => !attached.has(id));
      const found = new Map((await this.repo.findGroupsByIds(added, tx)).map((g) => [g.id, g]));
      const violations: ErrorViolation[] = [];
      wanted.forEach((id, i) => {
        if (attached.has(id)) return; // ya asociado: puede seguir aunque esté inactivo
        const group = found.get(id);
        if (!group) {
          violations.push({
            path: `groupIds[${i}]`,
            code: 'MODIFIER_GROUP_INVALID',
            message: 'El grupo no existe',
          });
        } else if (!group.active) {
          violations.push({
            path: `groupIds[${i}]`,
            code: 'MODIFIER_GROUP_INVALID',
            message: 'El grupo está inactivo',
          });
        }
      });
      if (violations.length > 0)
        throw groupInvalid('Hay grupos inexistentes o inactivos', violations);

      await this.repo.replaceProductLinks(tx, productId, wanted);
      await this.audit.record(tx, {
        actorId: staff.staffId,
        entityType: 'product',
        entityId: productId,
        action: 'product.modifier_groups_replaced',
        oldValues: { groupIds: currentIds },
        newValues: { groupIds: wanted },
      });
      this.logger.log(
        `Grupos del producto reemplazados (product=${productId}, staff=${staff.staffId})`,
      );
      return this.queries.getProductModifiers(productId, tx);
    });
  }

  /** El catálogo es global: un alcance solo por sucursal no basta (403 antes que cualquier 404/422). */
  private assertGlobal(staff: StaffContext, permission: string): void {
    if (!this.authorization.scopeFor(staff, permission).allBranches) {
      throw new ForbiddenException('Acceso denegado');
    }
  }

  private async inTransaction<T>(
    fn: (tx: ModifierTx) => Promise<T>,
    context?: ModifierDbContext,
  ): Promise<T> {
    try {
      return await this.repo.transaction(fn);
    } catch (error) {
      throw translateModifierDbError(error, context);
    }
  }
}
