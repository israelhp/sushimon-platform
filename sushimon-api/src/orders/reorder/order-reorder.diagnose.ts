import { BadRequestException } from '@nestjs/common';
import { centsToDecimal, decimalToCents } from '../../common/money/money.js';
import { evaluateSelections } from '../../modifiers/modifier-policy.js';
import type { OfferGroup } from '../../modifiers/modifiers.types.js';
import { sanitizeText } from '../order-contact.policy.js';
import type { OrderSourceLine } from '../order-source.repository.js';
import type {
  OrderReorderCandidateDto,
  OrderReorderIssueDto,
  OrderReorderLineDto,
  OrderReorderSummaryDto,
  ReorderIssueCode,
  ReorderIssueSeverity,
  ReorderLineStatus,
} from './dto/order-reorder.dto.js';

/** Tope vigente de unidades por línea del carrito (F18/F19) y largo máximo de la nota por línea. */
export const REORDER_MAX_QUANTITY = 99;
export const REORDER_NOTE_MAX = 140;

/** Estado de una oferta de sucursal (resultado de `BranchOffersService.inspect`, F13). */
export interface ReorderOffer {
  state: 'OK' | 'UNKNOWN' | 'HIDDEN' | 'SOLD_OUT';
  /** Precio efectivo de la sucursal; `null` si el producto no existe. */
  price: string | null;
}

export interface ReorderCatalog {
  /** `false` => todas las líneas `UNAVAILABLE` con `BRANCH_UNAVAILABLE` (no se evalúa el resto). */
  branchActive: boolean;
  offers: ReadonlyMap<string, ReorderOffer>;
  /** Grupos y opciones ACTUALES de cada producto (incluidos inactivos). */
  groups: ReadonlyMap<string, readonly OfferGroup[]>;
  presentation: ReadonlyMap<string, { slug: string; name: string; imageUrl: string | null }>;
}

const SEVERITY: Readonly<Record<ReorderIssueCode, ReorderIssueSeverity>> = {
  BRANCH_UNAVAILABLE: 'blocking',
  PRODUCT_REMOVED: 'blocking',
  PRODUCT_INACTIVE: 'blocking',
  PRODUCT_OUT_OF_STOCK: 'blocking',
  OPTION_REMOVED: 'warning',
  OPTION_INACTIVE: 'warning',
  GROUP_RULE_CHANGED: 'warning',
  REQUIRED_SELECTION_MISSING: 'warning',
  PRICE_CHANGED: 'info',
  QUANTITY_ADJUSTED: 'info',
  NOTE_DROPPED: 'info',
};

type IssueExtras = Partial<Omit<OrderReorderIssueDto, 'code' | 'severity'>>;

const issue = (code: ReorderIssueCode, extras: IssueExtras = {}): OrderReorderIssueDto => ({
  code,
  severity: SEVERITY[code],
  groupId: null,
  groupName: null,
  optionId: null,
  optionName: null,
  previousUnitPrice: null,
  currentUnitPrice: null,
  from: null,
  to: null,
  ...extras,
});

interface Retained {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  currentCents: number;
  historicCents: number;
}

const byIds = (
  a: { groupId: string; optionId: string },
  b: { groupId: string; optionId: string },
) =>
  a.groupId < b.groupId
    ? -1
    : a.groupId > b.groupId
      ? 1
      : a.optionId < b.optionId
        ? -1
        : a.optionId > b.optionId
          ? 1
          : 0;

/** Nota por línea: recortada y válida (≤ 140, sin caracteres de control) o `null`; `dropped` si había nota y no se pudo conservar. */
function carryNote(raw: string | null): { note: string | null; dropped: boolean } {
  if (raw === null) return { note: null, dropped: false };
  try {
    return { note: sanitizeText(raw, 'notes', 1, REORDER_NOTE_MAX), dropped: false };
  } catch (error) {
    if (error instanceof BadRequestException) return { note: null, dropped: true };
    throw error;
  }
}

const original = (line: OrderSourceLine): OrderReorderLineDto['original'] => ({
  productName: line.productName,
  quantity: line.quantity,
  unitPrice: line.unitPrice,
  extrasPerUnit: line.extrasPerUnit,
  modifiers: line.modifiers.map((m) => ({ name: m.modifierName, extraPrice: m.unitExtraPrice })),
  notes: line.notes,
});

interface Evaluated {
  line: OrderReorderLineDto;
  /** Subtotal estimado en centavos (solo se usa si la línea es `AVAILABLE`). */
  estimatedCents: number;
  units: number;
}

function blocked(
  line: OrderSourceLine,
  code: ReorderIssueCode,
  current: OrderReorderLineDto['current'],
): Evaluated {
  return {
    line: {
      lineNo: line.lineNo,
      status: 'UNAVAILABLE',
      original: original(line),
      current,
      issues: [issue(code)],
      candidate: null,
    },
    estimatedCents: 0,
    units: 0,
  };
}

/**
 * Diagnóstico de UNA línea contra el catálogo vigente (spec 024 §8.3-8.4). Función PURA y determinista: sin I/O, sin reloj, sin
 * aleatoriedad. Nunca sustituye una opción retirada por otra; nunca copia precios históricos como verdad (solo
 * `PRICE_CHANGED` los informa). Importes en centavos enteros.
 */
function evaluateLine(line: OrderSourceLine, catalog: ReorderCatalog): Evaluated {
  if (!catalog.branchActive) return blocked(line, 'BRANCH_UNAVAILABLE', null);
  if (line.productId === null) return blocked(line, 'PRODUCT_REMOVED', null);
  const offer = catalog.offers.get(line.productId);
  if (!offer || offer.state === 'UNKNOWN' || offer.price === null) {
    return blocked(line, 'PRODUCT_REMOVED', null);
  }
  if (offer.state === 'HIDDEN') return blocked(line, 'PRODUCT_INACTIVE', null);

  const groups = catalog.groups.get(line.productId) ?? [];
  const index = new Map<string, { group: OfferGroup; option: OfferGroup['options'][number] }>();
  for (const group of groups) {
    for (const option of group.options) {
      if (!index.has(option.id)) index.set(option.id, { group, option });
    }
  }

  const issues: OrderReorderIssueDto[] = [];
  const retained: Retained[] = [];
  const seen = new Set<string>();
  for (const m of line.modifiers) {
    if (m.modifierId === null) {
      issues.push(issue('OPTION_REMOVED', { optionName: m.modifierName }));
      continue;
    }
    if (seen.has(m.modifierId)) continue; // duplicado histórico: una sola vez
    seen.add(m.modifierId);
    const hit = index.get(m.modifierId);
    if (!hit) {
      issues.push(issue('OPTION_REMOVED', { optionId: m.modifierId, optionName: m.modifierName }));
    } else if (!hit.group.active || !hit.option.active) {
      issues.push(
        issue('OPTION_INACTIVE', {
          groupId: hit.group.id,
          groupName: hit.group.name,
          optionId: hit.option.id,
          optionName: hit.option.name,
        }),
      );
    } else {
      retained.push({
        groupId: hit.group.id,
        groupName: hit.group.name,
        optionId: hit.option.id,
        optionName: hit.option.name,
        currentCents: decimalToCents(hit.option.extraPrice),
        historicCents: decimalToCents(m.unitExtraPrice),
      });
    }
  }

  const unitCents = decimalToCents(offer.price);
  const extrasCents = retained.reduce((s, r) => s + r.currentCents, 0);
  const current = {
    unitPrice: centsToDecimal(unitCents),
    extrasPerUnit: centsToDecimal(extrasCents),
  };
  if (offer.state === 'SOLD_OUT') return blocked(line, 'PRODUCT_OUT_OF_STOCK', current);

  // Reglas vigentes de los grupos (F12) sobre lo retenido: máximo excedido y obligatorios sin la selección mínima.
  const byGroup = new Map<string, string[]>();
  for (const r of retained) {
    const list = byGroup.get(r.groupId);
    if (list) list.push(r.optionId);
    else byGroup.set(r.groupId, [r.optionId]);
  }
  const selections = [...byGroup].map(([groupId, modifierIds]) => ({ groupId, modifierIds }));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const flagged = new Set<string>();
  for (const v of evaluateSelections(groups, selections).violations) {
    const bySelection = /^selections\[(\d+)\]/.exec(v.path);
    const byGroupPath = /^groups\/(.+)$/.exec(v.path);
    const groupId = bySelection
      ? selections[Number(bySelection[1])]?.groupId
      : byGroupPath
        ? byGroupPath[1]
        : undefined;
    const code: ReorderIssueCode =
      v.code === 'MODIFIER_REQUIRED' ? 'REQUIRED_SELECTION_MISSING' : 'GROUP_RULE_CHANGED';
    const key = `${code}|${groupId ?? ''}`;
    if (flagged.has(key)) continue;
    flagged.add(key);
    issues.push(
      issue(code, {
        groupId: groupId ?? null,
        groupName: groupId ? (groupById.get(groupId)?.name ?? null) : null,
      }),
    );
  }

  const quantity = Math.min(line.quantity, REORDER_MAX_QUANTITY);
  const presentation = catalog.presentation.get(line.productId);
  if (!presentation) return blocked(line, 'PRODUCT_REMOVED', null); // desapareció entre las lecturas del lote

  const historicTotal =
    decimalToCents(line.unitPrice) + retained.reduce((s, r) => s + r.historicCents, 0);
  const currentTotal = unitCents + extrasCents;
  if (historicTotal !== currentTotal) {
    issues.push(
      issue('PRICE_CHANGED', {
        previousUnitPrice: centsToDecimal(historicTotal),
        currentUnitPrice: centsToDecimal(currentTotal),
      }),
    );
  }
  if (quantity !== line.quantity) {
    issues.push(issue('QUANTITY_ADJUSTED', { from: line.quantity, to: quantity }));
  }
  const { note, dropped } = carryNote(line.notes);
  if (dropped) issues.push(issue('NOTE_DROPPED'));

  const ordered = [...retained].sort(byIds);
  const candidate: OrderReorderCandidateDto = {
    line: {
      productId: line.productId,
      quantity,
      selections: ordered.map((r) => ({ groupId: r.groupId, optionId: r.optionId, quantity: 1 })),
    },
    slug: presentation.slug,
    note,
    display: {
      name: presentation.name,
      imageUrl: presentation.imageUrl,
      unitPrice: current.unitPrice,
      options: ordered.map((r) => ({
        groupId: r.groupId,
        optionId: r.optionId,
        groupName: r.groupName,
        optionName: r.optionName,
        extraPrice: centsToDecimal(r.currentCents),
      })),
    },
  };
  const status: ReorderLineStatus = issues.some((i) => i.severity === 'warning')
    ? 'NEEDS_CONFIGURATION'
    : 'AVAILABLE';
  return {
    line: { lineNo: line.lineNo, status, original: original(line), current, issues, candidate },
    estimatedCents: currentTotal * quantity,
    units: quantity,
  };
}

/** Diagnóstico de todas las líneas (mismo orden que `lineNo`) y resumen. Sin I/O. */
export function diagnoseReorder(
  lines: readonly OrderSourceLine[],
  catalog: ReorderCatalog,
): { lines: OrderReorderLineDto[]; summary: OrderReorderSummaryDto } {
  const evaluated = [...lines]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((l) => evaluateLine(l, catalog));
  const available = evaluated.filter((e) => e.line.status === 'AVAILABLE');
  return {
    lines: evaluated.map((e) => e.line),
    summary: {
      lines: evaluated.length,
      available: available.length,
      needsConfiguration: evaluated.filter((e) => e.line.status === 'NEEDS_CONFIGURATION').length,
      unavailable: evaluated.filter((e) => e.line.status === 'UNAVAILABLE').length,
      priceChanged: evaluated.filter((e) => e.line.issues.some((i) => i.code === 'PRICE_CHANGED'))
        .length,
      units: available.reduce((s, e) => s + e.units, 0),
      estimatedSubtotal: centsToDecimal(available.reduce((s, e) => s + e.estimatedCents, 0)),
      canAddAny: available.length > 0,
    },
  };
}
