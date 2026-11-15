import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { OwnCandidate } from './coverage-policy.js';
import { DEFAULT_DELIVERY_SETTINGS, type DeliverySettingsValues } from './coverage.types.js';

export type CoverageTx = Prisma.TransactionClient;

/** Zona propia ya convertida: `baseFee` es string decimal con 2 decimales (nunca `number`). */
export interface ZoneRecord {
  id: string;
  branchId: string;
  municipalityId: string;
  municipalityName: string;
  departmentId: string;
  departmentName: string;
  zoneLabel: string | null;
  zoneKey: string;
  baseFee: string;
  active: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SettingsRecord extends DeliverySettingsValues {
  updatedAt: Date;
}

export type ZoneSort = 'municipality' | 'baseFee' | 'createdAt';

export interface ZoneListFilter {
  /** Sucursal concreta (ya autorizada) o `null` = por alcance. */
  branchId: string | null;
  /** `null` = todas las sucursales; lista = solo esas (alcance de `branches.read`). Ignorado si hay `branchId`. */
  scope: string[] | null;
  departmentId?: string;
  municipalityId?: string;
  active?: boolean;
  /** Clave normalizada (D6): se busca con `contains` sobre `zone_key`. */
  keyContains?: string;
  sort: ZoneSort;
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export interface NewZoneData {
  branchId: string;
  municipalityId: string;
  zoneLabel: string | null;
  zoneKey: string;
  baseFee: string;
  active: boolean;
}

export interface ZonePatchData {
  zoneLabel?: string | null;
  zoneKey?: string;
  baseFee?: string;
  active?: boolean;
}

/** Lo que el orquestador necesita en UNA consulta: estado de la sucursal, existencia del municipio y flags. */
export interface CoverageContext {
  /** `null` = la sucursal no existe. */
  branchActive: boolean | null;
  municipalityExists: boolean;
  settings: DeliverySettingsValues;
}

const ZONE_SELECT = {
  id: true,
  branchId: true,
  municipalityId: true,
  zoneLabel: true,
  zoneKey: true,
  baseFee: true,
  active: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  municipality: {
    select: { name: true, departmentId: true, department: { select: { name: true } } },
  },
} satisfies Prisma.DeliveryZoneSelect;

type ZoneRow = Prisma.DeliveryZoneGetPayload<{ select: typeof ZONE_SELECT }>;

const toZone = (r: ZoneRow): ZoneRecord => ({
  id: r.id,
  branchId: r.branchId,
  municipalityId: r.municipalityId,
  municipalityName: r.municipality.name,
  departmentId: r.municipality.departmentId,
  departmentName: r.municipality.department.name,
  zoneLabel: r.zoneLabel,
  zoneKey: r.zoneKey,
  // Decimal exacto de Prisma: `toFixed(2)` no pasa por `number`.
  baseFee: r.baseFee.toFixed(2),
  active: r.active,
  version: r.version,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const WRITE_MAX_WAIT_MS = 2_000;
const WRITE_TIMEOUT_MS = 8_000;

/**
 * Único acceso a datos de zonas propias, settings logísticos y cobertura. Selects mínimos; la consulta del check
 * es por clave (índice del UNIQUE) y nunca carga la tabla. `base_fee` se escribe como `Prisma.Decimal` desde
 * texto y se lee con `Decimal.toFixed(2)` o `::text`: jamás `number`.
 */
@Injectable()
export class DeliveryCoverageRepository {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: CoverageTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(fn, { maxWait: WRITE_MAX_WAIT_MS, timeout: WRITE_TIMEOUT_MS });
  }

  async findZone(id: string, tx?: CoverageTx): Promise<ZoneRecord | null> {
    const row = await (tx ?? this.prisma).deliveryZone.findUnique({
      where: { id },
      select: ZONE_SELECT,
    });
    return row ? toZone(row) : null;
  }

  async findZoneByKey(
    branchId: string,
    municipalityId: string,
    zoneKey: string,
    tx?: CoverageTx,
  ): Promise<{ id: string } | null> {
    return (tx ?? this.prisma).deliveryZone.findUnique({
      where: {
        branchId_municipalityId_zoneKey: { branchId, municipalityId, zoneKey },
      },
      select: { id: true },
    });
  }

  async municipalityExists(id: string, tx?: CoverageTx): Promise<boolean> {
    const row = await (tx ?? this.prisma).municipality.findUnique({
      where: { id },
      select: { id: true },
    });
    return row !== null;
  }

  async listZones(f: ZoneListFilter): Promise<{ items: ZoneRecord[]; total: number }> {
    const and: Prisma.DeliveryZoneWhereInput[] = [];
    if (f.branchId !== null) and.push({ branchId: f.branchId });
    else if (f.scope !== null) and.push({ branchId: { in: f.scope } });
    if (f.municipalityId) and.push({ municipalityId: f.municipalityId });
    if (f.departmentId) and.push({ municipality: { departmentId: f.departmentId } });
    if (f.active !== undefined) and.push({ active: f.active });
    if (f.keyContains) {
      // Búsqueda LITERAL: `contains` de Prisma se traduce a LIKE sin escapar `%`, `_` ni `\`, así que `q=%` devolvería
      // todo. `position()` compara subcadenas sin comodines. Se acota por sucursal/alcance igual que el listado.
      const ids = await this.zoneIdsContaining(f.keyContains, f.branchId, f.scope);
      and.push({ id: { in: ids } });
    }
    const where: Prisma.DeliveryZoneWhereInput = { AND: and };
    const dir = f.order;
    const orderBy: Prisma.DeliveryZoneOrderByWithRelationInput[] =
      f.sort === 'baseFee'
        ? [{ baseFee: dir }, { id: 'asc' }]
        : f.sort === 'createdAt'
          ? [{ createdAt: dir }, { id: 'asc' }]
          : // departamento, municipio, zona general ('' ordena primero) y luego clave; desempate por id.
            [
              { municipality: { department: { name: dir } } },
              { municipality: { name: dir } },
              { zoneKey: dir },
              { id: 'asc' },
            ];
    const [rows, total] = await Promise.all([
      this.prisma.deliveryZone.findMany({
        where,
        select: ZONE_SELECT,
        orderBy,
        skip: (f.page - 1) * f.pageSize,
        take: f.pageSize,
      }),
      this.prisma.deliveryZone.count({ where }),
    ]);
    return { items: rows.map(toZone), total };
  }

  private async zoneIdsContaining(
    key: string,
    branchId: string | null,
    scope: string[] | null,
  ): Promise<string[]> {
    const branches = branchId !== null ? [branchId] : scope;
    const rows =
      branches === null
        ? await this.prisma.$queryRaw<{ id: string }[]>`
            SELECT id FROM app.delivery_zones WHERE position(${key} in zone_key) > 0`
        : await this.prisma.$queryRaw<{ id: string }[]>`
            SELECT id FROM app.delivery_zones
            WHERE branch_id = ANY(${branches}::uuid[]) AND position(${key} in zone_key) > 0`;
    return rows.map((r) => r.id);
  }

  async insertZone(tx: CoverageTx, data: NewZoneData): Promise<ZoneRecord> {
    const now = new Date();
    const row = await tx.deliveryZone.create({
      data: {
        branchId: data.branchId,
        municipalityId: data.municipalityId,
        zoneLabel: data.zoneLabel,
        zoneKey: data.zoneKey,
        baseFee: new Prisma.Decimal(data.baseFee),
        active: data.active,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
      select: ZONE_SELECT,
    });
    return toZone(row);
  }

  /**
   * UPDATE explícito: sube `version` y fija `updated_at` (sin triggers). Con `expectedVersion` es optimista
   * (`WHERE id AND version = $v`): `null` = no coincidió (conflicto). Sin `expectedVersion` (estado) el último gana.
   */
  async updateZone(
    tx: CoverageTx,
    id: string,
    expectedVersion: number | null,
    patch: ZonePatchData,
  ): Promise<ZoneRecord | null> {
    const res = await tx.deliveryZone.updateMany({
      where: { id, ...(expectedVersion === null ? {} : { version: expectedVersion }) },
      data: {
        ...(patch.zoneLabel !== undefined ? { zoneLabel: patch.zoneLabel } : {}),
        ...(patch.zoneKey !== undefined ? { zoneKey: patch.zoneKey } : {}),
        ...(patch.baseFee !== undefined ? { baseFee: new Prisma.Decimal(patch.baseFee) } : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    });
    if (res.count === 0) return null;
    return this.findZone(id, tx);
  }

  async findSettings(branchId: string, tx?: CoverageTx): Promise<SettingsRecord | null> {
    return (tx ?? this.prisma).branchDeliverySettings.findUnique({
      where: { branchId },
      select: { ownDeliveryZonesEnabled: true, pedidosyaEnabled: true, updatedAt: true },
    });
  }

  /**
   * Lazy upsert atómico (`INSERT … ON CONFLICT (branch_id) DO UPDATE`): los campos omitidos (`null`) conservan el
   * valor vigente o, si la fila no existía, el default. Seguro ante PATCH concurrentes sobre la misma sucursal.
   */
  async upsertSettings(
    tx: CoverageTx,
    branchId: string,
    patch: Partial<DeliverySettingsValues>,
  ): Promise<SettingsRecord> {
    const own = patch.ownDeliveryZonesEnabled ?? null;
    const ped = patch.pedidosyaEnabled ?? null;
    const d = DEFAULT_DELIVERY_SETTINGS;
    const rows = await tx.$queryRaw<SettingsRecord[]>`
      INSERT INTO app.branch_delivery_settings AS s
        (branch_id, own_delivery_zones_enabled, pedidosya_enabled, created_at, updated_at)
      VALUES (${branchId}::uuid,
              COALESCE(${own}::boolean, ${d.ownDeliveryZonesEnabled}::boolean),
              COALESCE(${ped}::boolean, ${d.pedidosyaEnabled}::boolean), now(), now())
      ON CONFLICT (branch_id) DO UPDATE SET
        own_delivery_zones_enabled = COALESCE(${own}::boolean, s.own_delivery_zones_enabled),
        pedidosya_enabled = COALESCE(${ped}::boolean, s.pedidosya_enabled),
        updated_at = now()
      RETURNING own_delivery_zones_enabled AS "ownDeliveryZonesEnabled",
                pedidosya_enabled AS "pedidosyaEnabled", updated_at AS "updatedAt"`;
    const row = rows[0];
    if (!row) throw new Error('upsert de delivery settings sin fila');
    return row;
  }

  /** UNA consulta: estado de la sucursal, existencia del municipio y flags (fila ausente = defaults). */
  async loadCoverageContext(
    branchId: string,
    municipalityId: string,
    tx?: CoverageTx,
  ): Promise<CoverageContext> {
    const rows = await (tx ?? this.prisma).$queryRaw<
      {
        branch_active: boolean | null;
        municipality_exists: boolean;
        own_enabled: boolean | null;
        pedidosya_enabled: boolean | null;
      }[]
    >`
      SELECT
        (SELECT b.active FROM app.branches b WHERE b.id = ${branchId}::uuid) AS branch_active,
        EXISTS (SELECT 1 FROM app.municipalities m WHERE m.id = ${municipalityId}::uuid) AS municipality_exists,
        (SELECT s.own_delivery_zones_enabled FROM app.branch_delivery_settings s
          WHERE s.branch_id = ${branchId}::uuid) AS own_enabled,
        (SELECT s.pedidosya_enabled FROM app.branch_delivery_settings s
          WHERE s.branch_id = ${branchId}::uuid) AS pedidosya_enabled`;
    const r = rows[0];
    return {
      branchActive: r?.branch_active ?? null,
      municipalityExists: r?.municipality_exists ?? false,
      settings: {
        ownDeliveryZonesEnabled:
          r?.own_enabled ?? DEFAULT_DELIVERY_SETTINGS.ownDeliveryZonesEnabled,
        pedidosyaEnabled: r?.pedidosya_enabled ?? DEFAULT_DELIVERY_SETTINGS.pedidosyaEnabled,
      },
    };
  }

  /** Zonas ACTIVAS candidatas por clave exacta (a lo sumo una por clave por la unicidad D7). Una consulta acotada. */
  async findOwnCandidates(
    branchId: string,
    municipalityId: string,
    keys: readonly string[],
    tx?: CoverageTx,
  ): Promise<OwnCandidate[]> {
    const rows = await (tx ?? this.prisma).$queryRaw<
      { id: string; zone_key: string; base_fee: string }[]
    >`
      SELECT z.id, z.zone_key, z.base_fee::text AS base_fee
      FROM app.delivery_zones z
      WHERE z.branch_id = ${branchId}::uuid AND z.municipality_id = ${municipalityId}::uuid
        AND z.active AND z.zone_key = ANY(${[...keys]}::text[])`;
    return rows.map((r) => ({ id: r.id, zoneKey: r.zone_key, baseFee: r.base_fee }));
  }
}
