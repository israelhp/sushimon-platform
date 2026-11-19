import {
  amountToCents,
  type AddToCartInput,
  type CartLine,
  type CartRejection,
} from '@/lib/cart-rules';
import { isApiError } from '@/lib/data-access/errors';
import type {
  OrderLifecycleStatus,
  OrderReorderIssue,
  OrderReorderLine,
  OrderReorderPreview,
} from '@/lib/data-access/models';
import type { CartActions } from '../../cart/cart-context';

/**
 * F23 (spec 024 §8–§9.4) — Modelo de vista PURO de «Volver a pedir». El servidor ya diagnosticó cada línea contra el catálogo
 * vigente (`OrderReorderPreview`): aquí SOLO se decide cómo se combina con el carrito F18 existente y se arma lo que se añade.
 * Jamás se sustituye una opción retirada, no se recalculan precios (los de `display` son informativos; F19 cotiza al pagar) y
 * nunca se crea un pedido.
 */

/** Estados finales: un pedido en otro estado sigue en curso y pide confirmación antes de «pedir otro igual». */
const FINAL_STATUSES: readonly OrderLifecycleStatus[] = [
  'delivered',
  'picked_up',
  'rejected',
  'cancelled',
];
export const isFinalStatus = (status: OrderLifecycleStatus): boolean =>
  FINAL_STATUSES.includes(status);

export type CartSituation = 'empty' | 'same-branch' | 'other-branch';
export type MergeMode = 'add' | 'replace';

export interface MergePlan {
  situation: CartSituation;
  /** Opciones ofrecidas. Con otra sucursal SOLO `replace` (jamás se mezclan sucursales ni se vacía solo). */
  modes: readonly MergeMode[];
  defaultMode: MergeMode;
  /** Líneas del carrito que se quitarían al reemplazar (0 con el carrito vacío). */
  replaceCount: number;
}

export function planMerge(
  cart: { branchId: string | null; lines: readonly CartLine[] },
  targetBranchId: string,
): MergePlan {
  const replaceCount = cart.lines.length;
  if (replaceCount === 0) {
    return { situation: 'empty', modes: ['add'], defaultMode: 'add', replaceCount };
  }
  if (cart.branchId === targetBranchId) {
    return {
      situation: 'same-branch',
      modes: ['add', 'replace'],
      defaultMode: 'add',
      replaceCount,
    };
  }
  return { situation: 'other-branch', modes: ['replace'], defaultMode: 'replace', replaceCount };
}

/** Reemplazar un carrito con líneas SIEMPRE exige confirmación explícita con el conteo (nunca sobrescribe en silencio). */
export const needsReplaceConfirmation = (plan: MergePlan, mode: MergeMode): boolean =>
  mode === 'replace' && plan.replaceCount > 0;

export interface GroupedLines {
  available: OrderReorderLine[];
  needsConfiguration: OrderReorderLine[];
  unavailable: OrderReorderLine[];
}

/** Líneas por estado conservando el orden del pedido original (`lineNo`). Un estado futuro desconocido se trata como no disponible. */
export function groupLines(preview: Pick<OrderReorderPreview, 'lines'>): GroupedLines {
  const out: GroupedLines = { available: [], needsConfiguration: [], unavailable: [] };
  for (const line of preview.lines) {
    if (line.status === 'AVAILABLE') out.available.push(line);
    else if (line.status === 'NEEDS_CONFIGURATION') out.needsConfiguration.push(line);
    else out.unavailable.push(line);
  }
  return out;
}

/** Solo las `AVAILABLE` con candidata se añaden. Las que piden configurar NO entran al carrito hasta que el cliente confirma en la ficha. */
export const addableLines = (preview: Pick<OrderReorderPreview, 'lines'>): OrderReorderLine[] =>
  preview.lines.filter((l) => l.status === 'AVAILABLE' && l.candidate !== null);

/** Antes → ahora de una línea con `PRICE_CHANGED` (informativo; el servidor recotiza al pagar). */
export function priceChangeOf(
  line: Pick<OrderReorderLine, 'issues'>,
): { previous: string; current: string } | null {
  const issue = line.issues.find((i) => i.code === 'PRICE_CHANGED');
  return issue?.previousUnitPrice && issue.currentUnitPrice
    ? { previous: issue.previousUnitPrice, current: issue.currentUnitPrice }
    : null;
}

/** Diagnósticos mostrados por línea: el cambio de precio va en su propio renglón («Antes → ahora»). */
export const displayIssues = (line: Pick<OrderReorderLine, 'issues'>): OrderReorderIssue[] =>
  line.issues.filter((i) => i.code !== 'PRICE_CHANGED');

/** Línea del carrito F18 desde la candidata del servidor (ids, selecciones ordenadas y presentación vigente). `null` si algo no es válido. */
export function toAddInput(line: OrderReorderLine, branchId: string): AddToCartInput | null {
  const candidate = line.candidate;
  if (!candidate) return null;
  const unitCents = amountToCents(candidate.display.unitPrice);
  if (unitCents === null) return null;
  const options: AddToCartInput['display']['options'] = [];
  for (const o of candidate.display.options) {
    const extraCents = amountToCents(o.extraPrice);
    if (extraCents === null) return null;
    options.push({
      groupId: o.groupId,
      optionId: o.optionId,
      groupName: o.groupName,
      optionName: o.optionName,
      extraCents,
    });
  }
  return {
    productId: candidate.line.productId,
    slug: candidate.slug,
    branchId,
    quantity: candidate.line.quantity,
    note: candidate.note ?? '',
    selections: candidate.line.selections.map((s) => ({
      groupId: s.groupId,
      optionId: s.optionId,
      quantity: s.quantity ?? 1,
    })),
    display: {
      name: candidate.display.name,
      imageUrl: candidate.display.imageUrl,
      unitCents,
      options,
    },
  };
}

export type ApplyResult =
  | { ok: true; lines: number; units: number }
  | { ok: false; reason: CartRejection | 'NOTHING_TO_ADD' };

/**
 * Añade al carrito F18 SOLO lo válido, todas o ninguna (`cart.add` es atómico: un tope excedido lo rechaza con los mensajes de F18,
 * sin recortar y sin tocar el carrito). Con `replace` el carrito anterior se sustituye en la MISMA operación (si falla, queda intacto).
 */
export function applyReorder(
  cart: Pick<CartActions, 'add'>,
  preview: OrderReorderPreview,
  mode: MergeMode,
): ApplyResult {
  const lines = addableLines(preview);
  const inputs = lines.flatMap((l) => {
    const input = toAddInput(l, preview.branch.requestedBranchId);
    return input ? [input] : [];
  });
  if (inputs.length === 0 || inputs.length !== lines.length) {
    return { ok: false, reason: inputs.length === 0 ? 'NOTHING_TO_ADD' : 'INVALID_INPUT' };
  }
  const result = cart.add(inputs, { replace: mode === 'replace' });
  if (!result.ok) return { ok: false, reason: result.reason };
  return { ok: true, lines: inputs.length, units: inputs.reduce((n, i) => n + i.quantity, 0) };
}

export type PreviewErrorKind = 'denied' | 'rateLimited' | 'busy' | 'offline' | 'unknown';

/**
 * Un fallo del preview es SIEMPRE un fallo de la consulta (el carrito no se modifica): 401/403/404 → sin acceso; 429 → espera;
 * 5xx → ocupado; sin conexión. Nunca se convierte en un estado de negocio de las líneas.
 */
export function previewErrorKind(error: unknown): {
  kind: PreviewErrorKind;
  retryAfterSec: number;
} {
  if (!isApiError(error)) return { kind: 'unknown', retryAfterSec: 0 };
  const retryAfterSec = error.retryAfterSec ?? 0;
  if (error.status === 0) return { kind: 'offline', retryAfterSec: 0 };
  if ([401, 403, 404].includes(error.status)) return { kind: 'denied', retryAfterSec: 0 };
  if (error.status === 429) return { kind: 'rateLimited', retryAfterSec };
  if (error.status >= 500) return { kind: 'busy', retryAfterSec };
  return { kind: 'unknown', retryAfterSec: 0 };
}
