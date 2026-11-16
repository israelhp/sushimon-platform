import { hasControlChars, normalizeCategoryName } from '@/lib/category-tree';
import { centsToPrice } from '@/lib/product-rules';

/**
 * F12 — Reglas puras de modificadores (spec 013, ADR-0018). Las comparten el adaptador mock (emula al servidor), el backoffice
 * (avisa antes de enviar) y el selector de la ficha pública (validación en vivo). La AUTORIDAD es siempre la API: el cliente
 * nunca aporta nombres ni precios al cotizar (F19) y el servidor recalcula. Los importes son CADENAS decimales (`"5.00"`) y se
 * suman en CÉNTIMOS enteros: nunca con coma flotante.
 */
export const MODIFIER_NAME_MAX = 80;
/** `maxSelect` admitido por el servidor (1–20). */
export const MODIFIER_MAX_SELECT_LIMIT = 20;
export const MODIFIER_OPTIONS_MAX = 30;
/** Máximo de elementos aceptados en `options[]` al crear un grupo (31–100 => 422; más => 400). */
export const MODIFIER_OPTIONS_INPUT_MAX = 100;
export const PRODUCT_MODIFIER_GROUPS_MAX = 10;
/** Máximo de elementos aceptados en `groupIds` (11–50 => 422; más => 400). */
export const PRODUCT_MODIFIER_GROUPS_INPUT_MAX = 50;
export const MODIFIER_SEARCH_MAX = 80;
export const MODIFIER_PAGE_SIZE_MAX = 100;
export const MODIFIER_PAGE_MAX = 200;
/** Precio extra máximo en céntimos (9 999.99). */
export const MODIFIER_PRICE_MAX_CENTS = 999_999;
/** `ModifierExtraPrice` del contrato (`0.00` permitido). */
export const MODIFIER_PRICE_PATTERN = /^[0-9]{1,4}\.[0-9]{2}$/;

/** Nombre como lo guarda el servidor (NFC, recorte y colapso de espacios). */
export const normalizeModifierName = normalizeCategoryName;
export const hasModifierNameControlChars = hasControlChars;

/** Clave de comparación de nombres únicos: sin distinguir mayúsculas (como `lower(name)` del servidor). */
export const modifierNameKey = (name: string): string => normalizeModifierName(name).toLowerCase();

// ── Precio ──────────────────────────────────────────────────────────────────────────────────

/** Céntimos de un `ModifierExtraPrice` válido (`"5.00"` → 500; `"0.00"` → 0) o `null` si no cumple forma y rango. */
export function extraPriceToCents(price: string): number | null {
  if (!MODIFIER_PRICE_PATTERN.test(price)) return null;
  const [whole, fraction] = price.split('.') as [string, string];
  const cents = Number(whole) * 100 + Number(fraction);
  return cents <= MODIFIER_PRICE_MAX_CENTS ? cents : null;
}

/** Céntimos → `"5.00"` (misma forma que el contrato). */
export const centsToExtraPrice = centsToPrice;

/**
 * Texto del campo de precio extra → `ModifierExtraPrice`. Admite coma o punto y de 0 a 2 decimales (`5`, `5.5`, `4,50`); vacío
 * equivale a `0.00`. `null` si no es un importe de 0 a 9 999.99.
 */
export function parseExtraPriceInput(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return '0.00';
  const m = /^(\d{1,4})(?:[.,](\d{1,2}))?$/.exec(trimmed);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  return cents <= MODIFIER_PRICE_MAX_CENTS ? centsToExtraPrice(cents) : null;
}

/** Suma exacta (céntimos enteros) de precios extra; las cadenas inválidas se ignoran (el servidor las rechazaría). */
export function sumExtraCents(prices: readonly string[]): number {
  return prices.reduce((sum, p) => sum + (extraPriceToCents(p) ?? 0), 0);
}

// ── Límites ─────────────────────────────────────────────────────────────────────────────────

/** `required` es DERIVADO (`minSelect >= 1`); nunca se almacena. */
export const isRequiredGroup = (minSelect: number): boolean => minSelect >= 1;

/** Límites coherentes: enteros, `0 <= min <= max` y `1 <= max <= 20`. */
export function areLimitsValid(minSelect: number, maxSelect: number): boolean {
  return (
    Number.isInteger(minSelect) &&
    Number.isInteger(maxSelect) &&
    minSelect >= 0 &&
    maxSelect >= 1 &&
    maxSelect <= MODIFIER_MAX_SELECT_LIMIT &&
    minSelect <= maxSelect
  );
}

/**
 * Invariante de satisfacibilidad (D3): un grupo ACTIVO debe tener al menos `minSelect` opciones activas. Un grupo inactivo
 * no tiene restricción.
 */
export const isSatisfiable = (g: {
  active: boolean;
  minSelect: number;
  activeOptionCount: number;
}): boolean => !g.active || g.activeOptionCount >= g.minSelect;

/** Regla de elección en lenguaje de interfaz: `exactly` (min = max), `upTo` (min = 0) o `between`. */
export type SelectionRule =
  | { kind: 'exactly'; count: number }
  | { kind: 'upTo'; max: number }
  | { kind: 'between'; min: number; max: number };

export function selectionRule(minSelect: number, maxSelect: number): SelectionRule {
  if (minSelect === maxSelect) return { kind: 'exactly', count: maxSelect };
  if (minSelect === 0) return { kind: 'upTo', max: maxSelect };
  return { kind: 'between', min: minSelect, max: maxSelect };
}

// ── Validación de una selección ─────────────────────────────────────────────────────────────

/** Selección ESTRUCTURADA de la ficha: por grupo, los ids de las opciones elegidas (F18 la consumirá). */
export interface ModifierSelection {
  groupId: string;
  modifierIds: string[];
}

export type ModifierViolationCode =
  | 'MODIFIER_REQUIRED'
  | 'MODIFIER_TOO_MANY'
  | 'MODIFIER_NOT_IN_GROUP'
  | 'MODIFIER_GROUP_NOT_ON_PRODUCT'
  | 'MODIFIER_INACTIVE'
  | 'MODIFIER_DUPLICATED';

export interface ModifierViolation {
  /** `selections[i]`, `selections[i].modifierIds`, `selections[i].modifierIds[j]`, `selections[i].groupId` o `groups/<id>`. */
  path: string;
  code: ModifierViolationCode;
}

/** Forma mínima de un grupo para validar: sirve a la ficha pública (solo activos) y al detalle administrativo. */
export interface RuleGroup {
  id: string;
  minSelect: number;
  maxSelect: number;
  /** Ausente = activo (la ficha pública solo trae grupos activos). */
  active?: boolean;
  options: readonly { id: string; name: string; extraPrice: string; active?: boolean }[];
}

/** «Ofrecible» (D9): grupo activo con al menos `max(minSelect, 1)` opciones activas. */
export function isOfferable(group: RuleGroup): boolean {
  if (group.active === false) return false;
  const active = group.options.filter((o) => o.active !== false).length;
  return active >= Math.max(group.minSelect, 1);
}

export interface SelectionResult {
  ok: boolean;
  violations: ModifierViolation[];
  /** Extras por unidad en céntimos (solo opciones válidas de grupos ofrecibles). */
  extraCents: number;
  /** Opciones válidas elegidas con su nombre y precio de los GRUPOS (no del cliente). */
  items: { groupId: string; modifierId: string; name: string; extraPrice: string }[];
}

/**
 * Mismas reglas que el validador del servidor (`ModifierSelectionService.validate`, D10): TODAS las violaciones, no solo la
 * primera. `groups` son los grupos del producto (la ficha pública ya trae solo los ofrecibles; los no ofrecibles se ignoran y
 * elegirlos es `MODIFIER_GROUP_NOT_ON_PRODUCT`). La multiplicación por cantidad no se hace aquí (es del carrito/cotización).
 */
export function validateSelection(
  groups: readonly RuleGroup[],
  selections: readonly ModifierSelection[],
): SelectionResult {
  const violations: ModifierViolation[] = [];
  const items: SelectionResult['items'] = [];
  const offered = new Map(groups.filter(isOfferable).map((g) => [g.id, g]));
  const seenGroups = new Set<string>();
  const covered = new Set<string>();

  selections.forEach((selection, i) => {
    const base = `selections[${i}]`;
    if (seenGroups.has(selection.groupId)) {
      violations.push({ path: base, code: 'MODIFIER_DUPLICATED' });
      return;
    }
    seenGroups.add(selection.groupId);
    const group = offered.get(selection.groupId);
    if (!group) {
      const known = groups.find((g) => g.id === selection.groupId);
      violations.push({
        path: `${base}.groupId`,
        code:
          known && known.active === false ? 'MODIFIER_INACTIVE' : 'MODIFIER_GROUP_NOT_ON_PRODUCT',
      });
      return;
    }
    covered.add(group.id);
    const chosen = new Set<string>();
    let valid = 0;
    selection.modifierIds.forEach((id, j) => {
      const path = `${base}.modifierIds[${j}]`;
      if (chosen.has(id)) {
        violations.push({ path, code: 'MODIFIER_DUPLICATED' });
        return;
      }
      chosen.add(id);
      const option = group.options.find((o) => o.id === id);
      if (!option) {
        violations.push({ path, code: 'MODIFIER_NOT_IN_GROUP' });
      } else if (option.active === false) {
        violations.push({ path, code: 'MODIFIER_INACTIVE' });
      } else {
        valid++;
        items.push({
          groupId: group.id,
          modifierId: option.id,
          name: option.name,
          extraPrice: option.extraPrice,
        });
      }
    });
    if (chosen.size > group.maxSelect) {
      violations.push({ path: `${base}.modifierIds`, code: 'MODIFIER_TOO_MANY' });
    } else if (isRequiredGroup(group.minSelect) && valid < group.minSelect) {
      violations.push({ path: base, code: 'MODIFIER_REQUIRED' });
    }
  });

  for (const group of offered.values()) {
    if (isRequiredGroup(group.minSelect) && !covered.has(group.id) && !seenGroups.has(group.id)) {
      violations.push({ path: `groups/${group.id}`, code: 'MODIFIER_REQUIRED' });
    }
  }
  return {
    ok: violations.length === 0,
    violations,
    extraCents: sumExtraCents(items.map((x) => x.extraPrice)),
    items,
  };
}

/** Quita grupos vacíos: la forma canónica de la selección estructurada que consumirá el carrito (F18). */
export const compactSelections = (selections: readonly ModifierSelection[]): ModifierSelection[] =>
  selections
    .filter((s) => s.modifierIds.length > 0)
    .map((s) => ({ groupId: s.groupId, modifierIds: [...s.modifierIds] }));
