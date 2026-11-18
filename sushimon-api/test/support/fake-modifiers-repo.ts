import { fold } from '../../src/products/product-policy.js';
import type { ModifierTx } from '../../src/modifiers/modifiers.repository.js';
import type {
  GroupPageFilter,
  GroupPatch,
  GroupRow,
  GroupSummaryRow,
  NewGroupData,
  NewOptionData,
  OfferRow,
  OptionPatch,
  OptionRow,
} from '../../src/modifiers/modifiers.types.js';
import { likeToRegExp, uniqueViolation } from './fake-products-repo.js';

export const mid = (n: number) => `00000000-0000-4000-8000-${String(n + 5000).padStart(12, '0')}`;

const T0 = new Date('2026-01-01T00:00:00Z');

export const groupRow = (id: string, over: Partial<GroupRow> = {}): GroupRow => ({
  id,
  name: `Grupo ${id.slice(-4)}`,
  minSelect: 0,
  maxSelect: 1,
  active: true,
  createdAt: T0,
  updatedAt: T0,
  ...over,
});

export const optionRow = (
  id: string,
  groupId: string,
  over: Partial<OptionRow> = {},
): OptionRow => ({
  id,
  groupId,
  name: `Opcion ${id.slice(-4)}`,
  extraPrice: '0.00',
  active: true,
  sortOrder: 0,
  createdAt: T0,
  updatedAt: T0,
  ...over,
});

/**
 * Doble en memoria de `ModifiersRepository` (misma superficie). Emula COMMIT/ROLLBACK por instantánea, los índices
 * únicos de nombre y los triggers de tope (30/10). Cuenta las llamadas para verificar "sin N+1".
 */
export class FakeModifiersRepo {
  groups = new Map<string, GroupRow>();
  options = new Map<string, OptionRow>();
  /** Productos existentes. */
  products = new Set<string>();
  /** `productId -> groupIds` en orden de asociación. */
  links = new Map<string, string[]>();
  calls: string[] = [];
  audit: Record<string, unknown>[] = [];
  failNextWriteWith: unknown = null;
  failTransactionWith: unknown = null;
  private counter = 7000;

  count = (name: string) => this.calls.filter((c) => c === name).length;

  seedGroup(row: GroupRow, options: OptionRow[] = []): void {
    this.groups.set(row.id, { ...row });
    for (const o of options) this.options.set(o.id, { ...o });
  }

  seedProduct(id: string, groupIds: string[] = []): void {
    this.products.add(id);
    this.links.set(id, [...groupIds]);
  }

  patchGroup(id: string, over: Partial<GroupRow>): void {
    this.groups.set(id, { ...(this.groups.get(id) as GroupRow), ...over });
  }

  patchOption(id: string, over: Partial<OptionRow>): void {
    this.options.set(id, { ...(this.options.get(id) as OptionRow), ...over });
  }

  optionsOf = (groupId: string): OptionRow[] =>
    [...this.options.values()]
      .filter((o) => o.groupId === groupId)
      .sort((a, b) => a.sortOrder - b.sortOrder);

  async transaction<T>(fn: (tx: ModifierTx) => Promise<T>): Promise<T> {
    this.calls.push('transaction');
    if (this.failTransactionWith) throw this.failTransactionWith as Error;
    const g = new Map([...this.groups].map(([k, v]) => [k, { ...v }]));
    const o = new Map([...this.options].map(([k, v]) => [k, { ...v }]));
    const l = new Map([...this.links].map(([k, v]) => [k, [...v]]));
    const auditLength = this.audit.length;
    const tx = {
      auditEvent: {
        create: ({ data }: { data: Record<string, unknown> }) => {
          this.audit.push(data);
          return Promise.resolve({});
        },
      },
    } as unknown as ModifierTx;
    try {
      return await fn(tx);
    } catch (error) {
      this.audit.length = auditLength;
      this.groups = g;
      this.options = o;
      this.links = l;
      throw error;
    }
  }

  lockGroup(_tx: ModifierTx, id: string): Promise<boolean> {
    this.calls.push('lockGroup');
    return Promise.resolve(this.groups.has(id));
  }

  lockProduct(_tx: ModifierTx, id: string): Promise<boolean> {
    this.calls.push('lockProduct');
    return Promise.resolve(this.products.has(id));
  }

  findGroupById(id: string): Promise<GroupRow | null> {
    this.calls.push('findGroupById');
    const g = this.groups.get(id);
    return Promise.resolve(g ? { ...g } : null);
  }

  findGroupsByIds(ids: readonly string[]): Promise<GroupRow[]> {
    this.calls.push('findGroupsByIds');
    return Promise.resolve(
      ids
        .map((id) => this.groups.get(id))
        .filter((g): g is GroupRow => g !== undefined)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((g) => ({ ...g })),
    );
  }

  findOptionById(id: string): Promise<OptionRow | null> {
    this.calls.push('findOptionById');
    const o = this.options.get(id);
    return Promise.resolve(o ? { ...o } : null);
  }

  findOptionsByGroupIds(groupIds: readonly string[]): Promise<OptionRow[]> {
    this.calls.push('findOptionsByGroupIds');
    if (groupIds.length === 0) return Promise.resolve([]);
    return Promise.resolve(
      [...this.options.values()]
        .filter((o) => groupIds.includes(o.groupId))
        .sort((a, b) =>
          a.groupId === b.groupId ? a.sortOrder - b.sortOrder : a.groupId < b.groupId ? -1 : 1,
        )
        .map((o) => ({ ...o })),
    );
  }

  private summary(g: GroupRow): GroupSummaryRow {
    const opts = this.optionsOf(g.id);
    return {
      ...g,
      optionCount: opts.length,
      activeOptionCount: opts.filter((o) => o.active).length,
      productCount: [...this.links.values()].filter((ids) => ids.includes(g.id)).length,
    };
  }

  findGroupPage(filter: GroupPageFilter): Promise<{ rows: GroupSummaryRow[]; total: number }> {
    this.calls.push('findGroupPage');
    const regex = filter.pattern ? likeToRegExp(filter.pattern) : null;
    const all = [...this.groups.values()]
      .filter((g) => filter.active === undefined || g.active === filter.active)
      .filter((g) => !regex || regex.test(fold(g.name)))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
    const start = (filter.page - 1) * filter.pageSize;
    return Promise.resolve({
      rows: all.slice(start, start + filter.pageSize).map((g) => this.summary(g)),
      total: all.length,
    });
  }

  findGroupSummary(id: string): Promise<GroupSummaryRow | null> {
    this.calls.push('findGroupSummary');
    const g = this.groups.get(id);
    return Promise.resolve(g ? this.summary(g) : null);
  }

  findProductGroupSummaries(productId: string): Promise<GroupSummaryRow[] | null> {
    this.calls.push('findProductGroupSummaries');
    if (!this.products.has(productId)) return Promise.resolve(null);
    return Promise.resolve(
      (this.links.get(productId) ?? [])
        .map((id) => this.groups.get(id))
        .filter((g): g is GroupRow => g !== undefined)
        .map((g) => this.summary(g)),
    );
  }

  findOffer(productId: string): Promise<OfferRow[] | null> {
    this.calls.push('findOffer');
    if (!this.products.has(productId)) return Promise.resolve(null);
    const rows: OfferRow[] = [];
    const none = {
      modifierId: null,
      modifierName: null,
      extraPrice: null,
      modifierActive: null,
    };
    const ids = this.links.get(productId) ?? [];
    if (ids.length === 0)
      return Promise.resolve([
        {
          groupId: null,
          groupName: null,
          minSelect: null,
          maxSelect: null,
          groupActive: null,
          ...none,
        },
      ]);
    for (const id of ids) {
      const g = this.groups.get(id);
      if (!g) continue;
      const base = {
        groupId: g.id,
        groupName: g.name,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        groupActive: g.active,
      };
      const opts = this.optionsOf(id);
      if (opts.length === 0) rows.push({ ...base, ...none });
      for (const o of opts)
        rows.push({
          ...base,
          modifierId: o.id,
          modifierName: o.name,
          extraPrice: o.extraPrice,
          modifierActive: o.active,
        });
    }
    return Promise.resolve(rows);
  }

  /** Lote (F19): UNA llamada registrada como `findOffersMany`; reutiliza la oferta por producto sin contarla. */
  async findOffersMany(productIds: readonly string[]): Promise<Map<string, OfferRow[]>> {
    const out = new Map<string, OfferRow[]>();
    for (const id of productIds) {
      const rows = await this.findOffer(id);
      this.calls.pop(); // la consulta por producto no cuenta: el lote es UNA consulta
      if (rows) out.set(id, rows);
    }
    this.calls.push('findOffersMany');
    return out;
  }

  findProductLinks(_tx: ModifierTx, productId: string) {
    this.calls.push('findProductLinks');
    return Promise.resolve(
      (this.links.get(productId) ?? []).map((groupId, sortOrder) => ({ groupId, sortOrder })),
    );
  }

  private maybeFail(): void {
    if (this.failNextWriteWith) {
      const error = this.failNextWriteWith;
      this.failNextWriteWith = null;
      throw error as Error;
    }
  }

  private nextId(): string {
    this.counter += 1;
    return `00000000-0000-4000-8000-${String(this.counter).padStart(12, '0')}`;
  }

  insertGroup(_tx: ModifierTx, data: NewGroupData): Promise<GroupRow> {
    this.calls.push('insertGroup');
    this.maybeFail();
    for (const g of this.groups.values())
      if (g.name.toLowerCase() === data.name.toLowerCase())
        throw uniqueViolation('modifier_groups_name_lower_key');
    const row: GroupRow = { id: this.nextId(), ...data, createdAt: T0, updatedAt: T0 };
    this.groups.set(row.id, row);
    return Promise.resolve({ ...row });
  }

  updateGroup(_tx: ModifierTx, id: string, data: GroupPatch): Promise<GroupRow> {
    this.calls.push('updateGroup');
    this.maybeFail();
    for (const g of this.groups.values())
      if (
        g.id !== id &&
        data.name !== undefined &&
        g.name.toLowerCase() === data.name.toLowerCase()
      )
        throw uniqueViolation('modifier_groups_name_lower_key');
    const next = { ...(this.groups.get(id) as GroupRow), ...data };
    this.groups.set(id, next);
    return Promise.resolve({ ...next });
  }

  insertOptions(_tx: ModifierTx, items: readonly NewOptionData[]): Promise<OptionRow[]> {
    this.calls.push('insertOptions');
    this.maybeFail();
    const out: OptionRow[] = [];
    for (const item of items) {
      const siblings = this.optionsOf(item.groupId);
      if (siblings.length >= 30)
        throw Object.assign(new Error('modifier_group_max_options'), { code: '23514' });
      if (siblings.some((s) => s.name.toLowerCase() === item.name.toLowerCase()))
        throw uniqueViolation('modifiers_group_name_lower_key');
      const row: OptionRow = { id: this.nextId(), ...item, createdAt: T0, updatedAt: T0 };
      this.options.set(row.id, row);
      out.push({ ...row });
    }
    return Promise.resolve(out);
  }

  updateOption(_tx: ModifierTx, id: string, data: OptionPatch): Promise<OptionRow> {
    this.calls.push('updateOption');
    this.maybeFail();
    const current = this.options.get(id) as OptionRow;
    if (
      data.name !== undefined &&
      this.optionsOf(current.groupId).some(
        (s) => s.id !== id && s.name.toLowerCase() === (data.name as string).toLowerCase(),
      )
    )
      throw uniqueViolation('modifiers_group_name_lower_key');
    const next = { ...current, ...data };
    this.options.set(id, next);
    return Promise.resolve({ ...next });
  }

  setOptionOrder(_tx: ModifierTx, groupId: string, orderedIds: readonly string[]): Promise<void> {
    this.calls.push('setOptionOrder');
    this.maybeFail();
    orderedIds.forEach((id, i) => {
      const o = this.options.get(id);
      if (o && o.groupId === groupId) this.options.set(id, { ...o, sortOrder: i });
    });
    return Promise.resolve();
  }

  replaceProductLinks(
    _tx: ModifierTx,
    productId: string,
    groupIds: readonly string[],
  ): Promise<void> {
    this.calls.push('replaceProductLinks');
    this.maybeFail();
    this.links.set(productId, [...groupIds]);
    return Promise.resolve();
  }
}

/** Harness estándar: 3 grupos y 2 productos. */
export const G = { salsas: mid(1), extras: mid(2), vacio: mid(3) } as const;
export const P = { roll: mid(100), sin: mid(101) } as const;
export const OPT = (n: number) => mid(200 + n);
