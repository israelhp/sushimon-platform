import { normalizeNote, MAX_NOTE_LENGTH, MAX_QUANTITY } from '@/lib/cart-rules';
import type {
  OrderReorderIssue,
  OrderReorderLine,
  OrderReorderSummary,
} from '@/lib/data-access/models';
import {
  extraPriceToCents,
  validateSelection,
  type ModifierSelection,
  type RuleGroup,
} from '@/lib/modifier-rules';
import { centsToPrice } from '@/lib/product-rules';

/**
 * F23 (spec 024 §8.3–§8.4) — Diagnóstico de «Volver a pedir» SIMULADO: función PURA y determinista que imita a la API (misma tabla de
 * casos) sobre una vista del catálogo VIGENTE. No toca el store ni el reloj: el handler le pasa lo que lee. Los importes se manejan en
 * centavos enteros (nunca coma flotante). NUNCA sustituye una opción retirada por otra ni copia precios, promociones, tarifa,
 * modalidad, dirección o pago del pedido original.
 */

/** Línea del pedido original (snapshot) con lo mínimo para diagnosticar. */
export interface ReorderSourceLine {
  lineNo: number;
  /** `null` = el snapshot no conserva el id del producto (`PRODUCT_REMOVED`). */
  productId: string | null;
  productName: string;
  quantity: number;
  unitCents: number;
  extrasPerUnitCents: number;
  modifiers: { modifierId: string | null; name: string; extraCents: number }[];
  notes: string | null;
}

export type ProductState = 'OK' | 'UNKNOWN' | 'HIDDEN' | 'SOLD_OUT';

export interface CatalogProductView {
  state: ProductState;
  slug: string;
  name: string;
  imageUrl: string | null;
  /** Precio efectivo de la sucursal (F13) SIN extras, en centavos. */
  unitCents: number;
}

export interface DiagGroup extends RuleGroup {
  name: string;
}

/** Vista del catálogo vigente de UNA sucursal (la arma el handler; los tests la construyen a mano). */
export interface CatalogView {
  branchActive: boolean;
  product: (productId: string) => CatalogProductView | null;
  groups: (productId: string) => readonly DiagGroup[];
}

const money = (cents: number) => centsToPrice(cents);

const NOTE_CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** ¿La nota cumple el formato vigente (≤ 140 y sin caracteres de control)? Si no, se omite con `NOTE_DROPPED`. */
const noteIsValid = (note: string) =>
  Array.from(note).length <= MAX_NOTE_LENGTH && !NOTE_CONTROL.test(note);

const issue = (
  code: OrderReorderIssue['code'],
  severity: OrderReorderIssue['severity'],
  extra: Partial<OrderReorderIssue> = {},
): OrderReorderIssue => ({ code, severity, ...extra });

const byGroupThenOption = <T extends { groupId: string; optionId: string }>(a: T, b: T) =>
  a.groupId < b.groupId
    ? -1
    : a.groupId > b.groupId
      ? 1
      : a.optionId < b.optionId
        ? -1
        : a.optionId > b.optionId
          ? 1
          : 0;

export function diagnoseLine(line: ReorderSourceLine, catalog: CatalogView): OrderReorderLine {
  const original: OrderReorderLine['original'] = {
    productName: line.productName,
    quantity: line.quantity,
    unitPrice: money(line.unitCents),
    extrasPerUnit: money(line.extrasPerUnitCents),
    modifiers: line.modifiers.map((m) => ({ name: m.name, extraPrice: money(m.extraCents) })),
    notes: line.notes,
  };
  const unavailable = (
    issues: OrderReorderIssue[],
    current: OrderReorderLine['current'] = null,
  ): OrderReorderLine => ({
    lineNo: line.lineNo,
    status: 'UNAVAILABLE',
    original,
    current,
    issues,
    candidate: null,
  });

  // 1. Sucursal inactiva: todas las líneas, sin evaluar el catálogo.
  if (!catalog.branchActive) return unavailable([issue('BRANCH_UNAVAILABLE', 'blocking')]);

  // 2. Producto.
  const product = line.productId ? catalog.product(line.productId) : null;
  if (!product || product.state === 'UNKNOWN') {
    return unavailable([issue('PRODUCT_REMOVED', 'blocking')]);
  }
  if (product.state === 'HIDDEN') return unavailable([issue('PRODUCT_INACTIVE', 'blocking')]);
  if (product.state === 'SOLD_OUT') {
    return unavailable([issue('PRODUCT_OUT_OF_STOCK', 'blocking')], {
      unitPrice: money(product.unitCents),
      extrasPerUnit: money(0),
    });
  }
  const productId = line.productId as string;

  // 3. Extras: cada `modifierId` se busca en los grupos VIGENTES del producto.
  const groups = catalog.groups(productId);
  const index = new Map<string, { group: DiagGroup; option: DiagGroup['options'][number] }>();
  for (const group of groups)
    for (const option of group.options) index.set(option.id, { group, option });

  const issues: OrderReorderIssue[] = [];
  const retained: {
    groupId: string;
    optionId: string;
    groupName: string;
    optionName: string;
    currentCents: number;
    historicalCents: number;
  }[] = [];
  const seen = new Set<string>();
  for (const modifier of line.modifiers) {
    const hit = modifier.modifierId ? index.get(modifier.modifierId) : undefined;
    if (!hit) {
      issues.push(issue('OPTION_REMOVED', 'warning', { optionName: modifier.name }));
      continue;
    }
    if (hit.option.active === false || hit.group.active === false) {
      issues.push(
        issue('OPTION_INACTIVE', 'warning', {
          groupId: hit.group.id,
          groupName: hit.group.name,
          optionId: hit.option.id,
          optionName: hit.option.name,
        }),
      );
      continue;
    }
    if (seen.has(hit.option.id)) continue; // un duplicado histórico no se repite
    seen.add(hit.option.id);
    retained.push({
      groupId: hit.group.id,
      optionId: hit.option.id,
      groupName: hit.group.name,
      optionName: hit.option.name,
      currentCents: extraPriceToCents(hit.option.extraPrice) ?? 0,
      historicalCents: modifier.extraCents,
    });
  }
  retained.sort(byGroupThenOption);

  // 4. Reglas vigentes de los grupos sobre lo retenido.
  const selections: ModifierSelection[] = [];
  for (const r of retained) {
    const last = selections[selections.length - 1];
    if (last && last.groupId === r.groupId) last.modifierIds.push(r.optionId);
    else selections.push({ groupId: r.groupId, modifierIds: [r.optionId] });
  }
  const result = validateSelection(groups, selections);
  const nameOf = (id: string) => groups.find((g) => g.id === id)?.name ?? null;
  for (const violation of result.violations) {
    const bySelection = /^selections\[(\d+)\]/.exec(violation.path);
    const groupId = bySelection
      ? (selections[Number(bySelection[1])]?.groupId ?? null)
      : violation.path.startsWith('groups/')
        ? violation.path.slice('groups/'.length)
        : null;
    const where = groupId ? { groupId, groupName: nameOf(groupId) } : {};
    if (violation.code === 'MODIFIER_TOO_MANY') {
      issues.push(issue('GROUP_RULE_CHANGED', 'warning', where));
    } else if (violation.code === 'MODIFIER_REQUIRED') {
      issues.push(issue('REQUIRED_SELECTION_MISSING', 'warning', where));
    } else {
      issues.push(issue('OPTION_INACTIVE', 'warning', where));
    }
  }
  const needsConfiguration = issues.some((i) => i.severity === 'warning');

  // 5. Cantidad y nota.
  const quantity = Math.min(line.quantity, MAX_QUANTITY);
  if (quantity !== line.quantity) {
    issues.push(issue('QUANTITY_ADJUSTED', 'info', { from: line.quantity, to: quantity }));
  }
  let note: string | null = null;
  if (line.notes) {
    if (noteIsValid(line.notes)) note = normalizeNote(line.notes) || null;
    else issues.push(issue('NOTE_DROPPED', 'info'));
  }

  // 6. Precio: vigente (precio base + extras retenidos hoy) contra histórico (precio + los MISMOS extras a su precio de entonces).
  const currentExtras = retained.reduce((n, r) => n + r.currentCents, 0);
  const historicalExtras = retained.reduce((n, r) => n + r.historicalCents, 0);
  const currentUnit = product.unitCents + currentExtras;
  const previousUnit = line.unitCents + historicalExtras;
  if (currentUnit !== previousUnit) {
    issues.push(
      issue('PRICE_CHANGED', 'info', {
        previousUnitPrice: money(previousUnit),
        currentUnitPrice: money(currentUnit),
      }),
    );
  }

  return {
    lineNo: line.lineNo,
    status: needsConfiguration ? 'NEEDS_CONFIGURATION' : 'AVAILABLE',
    original,
    current: { unitPrice: money(product.unitCents), extrasPerUnit: money(currentExtras) },
    issues,
    candidate: {
      line: {
        productId,
        quantity,
        selections: retained.map((r) => ({
          groupId: r.groupId,
          optionId: r.optionId,
          quantity: 1,
        })),
      },
      slug: product.slug,
      note,
      display: {
        name: product.name,
        imageUrl: product.imageUrl,
        unitPrice: money(product.unitCents),
        options: retained.map((r) => ({
          groupId: r.groupId,
          optionId: r.optionId,
          groupName: r.groupName,
          optionName: r.optionName,
          extraPrice: money(r.currentCents),
        })),
      },
    },
  };
}

export function summarize(lines: readonly OrderReorderLine[]): OrderReorderSummary {
  const available = lines.filter((l) => l.status === 'AVAILABLE');
  const cents = (value: string) => Math.round(Number(value) * 100);
  const estimated = available.reduce((n, l) => {
    const current = l.current;
    const quantity = l.candidate?.line.quantity ?? 0;
    return n + (current ? cents(current.unitPrice) + cents(current.extrasPerUnit) : 0) * quantity;
  }, 0);
  return {
    lines: lines.length,
    available: available.length,
    needsConfiguration: lines.filter((l) => l.status === 'NEEDS_CONFIGURATION').length,
    unavailable: lines.filter((l) => l.status === 'UNAVAILABLE').length,
    priceChanged: lines.filter((l) => l.issues.some((i) => i.code === 'PRICE_CHANGED')).length,
    units: available.reduce((n, l) => n + (l.candidate?.line.quantity ?? 0), 0),
    estimatedSubtotal: money(estimated),
    canAddAny: available.length > 0,
  };
}

export function diagnoseReorder(lines: readonly ReorderSourceLine[], catalog: CatalogView) {
  const diagnosed = lines.map((l) => diagnoseLine(l, catalog));
  return { lines: diagnosed, summary: summarize(diagnosed) };
}
