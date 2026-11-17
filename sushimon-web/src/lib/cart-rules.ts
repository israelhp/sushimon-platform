import type { components } from '@sushimon/contracts';
import { validateSelection, type ModifierSelection } from '@/lib/modifier-rules';
import type { PublicModifierGroup } from '@/lib/data-access/models';
import { safeMediaUrl } from '@/lib/product-rules';

/**
 * F18 (spec 019, ADR-0024) — Reglas PURAS del carrito local: modelo de línea, clave canónica y `lineId`, topes, aritmética en
 * CENTAVOS ENTEROS, lectura estricta de `monsushi-cart-v2`, revalidación por línea, plan de cambio de sucursal y la entrada de
 * cotización de F19 (`toQuoteInput`). Sin React ni red: las usan el store (`features/cart`) y las pruebas.
 *
 * Separación de datos: la CONFIANZA (`productId`, `quantity`, `selections`, `branchId` del carrito) es lo único que sale hacia el
 * servidor; la PRESENTACIÓN (`display`: nombre, imagen, precio provisional, nombres de opciones) solo sirve para pintar y NUNCA es
 * autoridad. Todo importe es una estimación: el servidor recalcula (F19). Las promociones jamás se restan aquí.
 */

// ── Claves, topes y TTL (valores PROVISIONALES: P30/P31, sin confirmar con negocio) ───────────────────────────────

export const CART_STORAGE_KEY = 'monsushi-cart-v2';
/** Carrito anterior (UI First): no se migra (sin sucursal, extras ni slug); se descarta con aviso único (P38). */
export const LEGACY_CART_STORAGE_KEY = 'monsushi-cart-v1';
/** Vigencia desde la ÚLTIMA EDICIÓN del usuario (la revalidación no la renueva). */
export const CART_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Tolerancia al leer un `updatedAt` adelantado respecto al reloj local. */
export const CART_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const MAX_QUANTITY = 99;
export const MAX_NOTE_LENGTH = 140;
export const CART_MAX_LINES = 30;
export const CART_MAX_UNITS = 200;
export const CART_MAX_SELECTIONS = 30;
/** Tamaño máximo del JSON guardado; más = documento corrupto. */
export const CART_MAX_BYTES = 64 * 1024;
/** Tope de un importe (centavos) al leer: 999 999.00. */
export const CART_MAX_CENTS = 99_999_900;
/** `CartQuoteSelectionInput.quantity` admite 1 (F12: cada opción se elige 0 o 1 vez; P36). */
export const CART_OPTION_MAX_QUANTITY = 1;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SLUG_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const TEXT_MAX = 200;
const IMAGE_URL_MAX = 500;
/** Importe canónico de la API (`"85.00"`): se convierte por CADENA, nunca con coma flotante. */
const AMOUNT_PATTERN = /^(\d{1,6})\.(\d{2})$/;

// ── Tipos ────────────────────────────────────────────────────────────────────────────────────────────────

export interface CartSelection {
  groupId: string;
  optionId: string;
  quantity: number;
}

export interface CartOptionDisplay {
  groupId: string;
  optionId: string;
  groupName: string;
  optionName: string;
  extraCents: number;
}

export interface CartLineDisplay {
  name: string;
  imageUrl: string | null;
  /** Precio EFECTIVO provisional de la sucursal, SIN extras (centavos enteros). */
  unitCents: number;
  currency: 'GTQ';
  /** Instante (ms) en que se vio ese precio. */
  seenAt: number;
  options: CartOptionDisplay[];
  /** Precio por unidad (con extras) anterior a la última actualización automática, pendiente de «Entendido». */
  priceChange?: { fromCents: number } | null;
}

export interface CartLine {
  lineId: string;
  productId: string;
  slug: string;
  quantity: number;
  /** Observaciones (≤ 140, no cambian el precio): viajan al pedido (F20), NO a la cotización (P35). */
  note: string;
  selections: CartSelection[];
  display: CartLineDisplay;
}

export interface CartState {
  v: 2;
  /** Sucursal del carrito (una sola). `null` solo si no hay líneas. */
  branchId: string | null;
  /** Última edición del usuario (ms). Base del TTL. */
  updatedAt: number;
  lines: CartLine[];
}

export const EMPTY_CART: CartState = Object.freeze({
  v: 2,
  branchId: null,
  updatedAt: 0,
  lines: Object.freeze([]) as unknown as CartLine[],
}) as CartState;

export type CartRejection =
  | 'INVALID_INPUT'
  | 'INVALID_QUANTITY'
  | 'LIMIT_QUANTITY'
  | 'LIMIT_LINES'
  | 'LIMIT_UNITS'
  | 'LIMIT_SELECTIONS'
  | 'BRANCH_MISMATCH'
  | 'NOT_FOUND';

export type CartResult =
  | { ok: true; state: CartState; lineId: string | null; merged: boolean }
  | { ok: false; reason: CartRejection };

/** Lo que entrega la UI al agregar: datos de confianza + presentación. */
export interface AddToCartInput {
  productId: string;
  slug: string;
  branchId: string;
  quantity: number;
  note?: string;
  selections: readonly CartSelection[];
  display: Omit<CartLineDisplay, 'currency' | 'seenAt' | 'priceChange'> & { seenAt?: number };
}

// ── Texto, clave canónica y lineId ───────────────────────────────────────────────────────────────────────

/** Nota tal como se guarda: NFC, sin controles, espacios colapsados, recortada y ≤ 140 puntos de código. */
export function normalizeNote(note: string): string {
  const clean = note
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(clean).slice(0, MAX_NOTE_LENGTH).join('').trim();
}

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Selecciones ordenadas por `groupId` y luego `optionId` (comparación binaria): independiente del orden en que se eligieron. */
export function sortSelections<T extends { groupId: string; optionId: string }>(
  selections: readonly T[],
): T[] {
  return [...selections].sort(
    (a, b) => compare(a.groupId, b.groupId) || compare(a.optionId, b.optionId),
  );
}

const selectionKey = (selections: readonly CartSelection[]): string =>
  sortSelections(selections)
    .map((s) => `${s.groupId}:${s.optionId}:${s.quantity}`)
    .join(',');

/**
 * Clave canónica de una línea: producto | sucursal | nota (minúsculas para COMPARAR, JSON para que ningún carácter la parta) |
 * selecciones ordenadas. Los ids están restringidos a `[A-Za-z0-9_-]`, así que `|` y `,` no se confunden con los datos.
 */
export function canonicalKey(
  productId: string,
  branchId: string,
  note: string,
  selections: readonly CartSelection[],
): string {
  return [
    productId,
    branchId,
    JSON.stringify(normalizeNote(note).toLowerCase()),
    selectionKey(selections),
  ].join('|');
}

/** Hash no criptográfico de 53 bits (cyrb53). La colisión es despreciable con ≤ 30 líneas; no es un secreto. */
function hash53(text: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** `lineId` determinista (`l1_` + dos hashes de 53 bits con semillas distintas ≈ 106 bits). Se RECALCULA siempre al leer. */
export function computeLineId(
  productId: string,
  branchId: string,
  note: string,
  selections: readonly CartSelection[],
): string {
  const key = canonicalKey(productId, branchId, note, selections);
  const part = (seed: number) => hash53(key, seed).toString(16).padStart(14, '0');
  return `l1_${part(0)}${part(0x9e3779b1)}`;
}

// ── Dinero en centavos enteros ───────────────────────────────────────────────────────────────────────────

/** `"85.00"` → 8500. Por cadena: nunca `Number("85.00") * 100` (0.1 + 0.2). `null` si no es un importe canónico o excede el tope. */
export function amountToCents(amount: string): number | null {
  const m = AMOUNT_PATTERN.exec(amount);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number(m[2]);
  return cents <= CART_MAX_CENTS ? cents : null;
}

const isCents = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= CART_MAX_CENTS;

/** Extras por unidad: Σ extraCents × cantidad de la selección (centavos enteros). */
export function lineExtrasCents(line: Pick<CartLine, 'selections' | 'display'>): number {
  return line.selections.reduce((sum, s) => {
    const option = line.display.options.find(
      (o) => o.groupId === s.groupId && o.optionId === s.optionId,
    );
    return sum + (option?.extraCents ?? 0) * s.quantity;
  }, 0);
}

/** Precio por unidad con extras (centavos). */
export const lineUnitCents = (line: Pick<CartLine, 'selections' | 'display'>): number =>
  line.display.unitCents + lineExtrasCents(line);

export const lineSubtotalCents = (
  line: Pick<CartLine, 'selections' | 'display' | 'quantity'>,
): number => lineUnitCents(line) * line.quantity;

/** Subtotal ESTIMADO (provisional): suma de subtotales de línea. No incluye envío, propinas, impuestos ni descuentos. */
export const cartSubtotalCents = (lines: readonly CartLine[]): number =>
  lines.reduce((sum, l) => sum + lineSubtotalCents(l), 0);

/** Unidades totales (lo que muestra el contador). */
export const cartUnits = (lines: readonly CartLine[]): number =>
  lines.reduce((n, l) => n + l.quantity, 0);

export const quantityOfProduct = (lines: readonly CartLine[], productId: string): number =>
  lines.reduce((n, l) => (l.productId === productId ? n + l.quantity : n), 0);

// ── Validación estructural ───────────────────────────────────────────────────────────────────────────────

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is string => typeof v === 'string' && ID_PATTERN.test(v);
/** Caracteres de control, de dirección bidi y «invisibles» (ancho cero, separadores, BOM): nunca llegan a la interfaz. */
const UNSAFE_TEXT =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff\ufff9-\ufffb]/g;

/**
 * Saneado de un texto de PRESENTACIÓN (nombres de producto, grupo u opción: vienen del servidor o de un JSON editable): sin
 * controles ni caracteres bidi/invisibles, espacios colapsados y recortado a 200 puntos de código (se TRUNCA, no se rechaza).
 */
export function cleanText(text: string, max = TEXT_MAX): string {
  const clean = text.normalize('NFC').replace(UNSAFE_TEXT, ' ').replace(/\s+/g, ' ').trim();
  return Array.from(clean).slice(0, max).join('').trim();
}

const isText = (v: unknown): v is string => typeof v === 'string' && cleanText(v).length > 0;

/** Cantidad válida de una línea: entero 1–99 (no NaN, decimal, 0, negativo ni 100). */
export const isValidQuantity = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_QUANTITY;

function parseSelections(value: unknown): CartSelection[] | null {
  if (!Array.isArray(value) || value.length > CART_MAX_SELECTIONS) return null;
  const seen = new Set<string>();
  const out: CartSelection[] = [];
  for (const raw of value) {
    if (!isPlainObject(raw) || !isId(raw.groupId) || !isId(raw.optionId)) return null;
    const quantity = raw.quantity;
    if (
      typeof quantity !== 'number' ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > CART_OPTION_MAX_QUANTITY
    ) {
      return null;
    }
    const key = `${raw.groupId}:${raw.optionId}`;
    if (seen.has(key)) return null;
    seen.add(key);
    out.push({ groupId: raw.groupId, optionId: raw.optionId, quantity });
  }
  return sortSelections(out);
}

function parseOptions(
  value: unknown,
  selections: readonly CartSelection[],
): CartOptionDisplay[] | null {
  if (!Array.isArray(value) || value.length !== selections.length) return null;
  const byKey = new Map<string, CartOptionDisplay>();
  for (const raw of value) {
    if (
      !isPlainObject(raw) ||
      !isId(raw.groupId) ||
      !isId(raw.optionId) ||
      !isText(raw.groupName) ||
      !isText(raw.optionName) ||
      !isCents(raw.extraCents)
    ) {
      return null;
    }
    byKey.set(`${raw.groupId}:${raw.optionId}`, {
      groupId: raw.groupId,
      optionId: raw.optionId,
      groupName: cleanText(raw.groupName),
      optionName: cleanText(raw.optionName),
      extraCents: raw.extraCents,
    });
  }
  // Cada selección tiene exactamente su opción de presentación (y viceversa).
  const ordered: CartOptionDisplay[] = [];
  for (const s of selections) {
    const option = byKey.get(`${s.groupId}:${s.optionId}`);
    if (!option) return null;
    ordered.push(option);
  }
  return byKey.size === ordered.length ? ordered : null;
}

function parseDisplay(
  value: unknown,
  selections: readonly CartSelection[],
): CartLineDisplay | null {
  if (!isPlainObject(value) || !isText(value.name) || value.currency !== 'GTQ') return null;
  if (!isCents(value.unitCents)) return null;
  const seenAt = value.seenAt;
  if (typeof seenAt !== 'number' || !Number.isSafeInteger(seenAt) || seenAt < 0) return null;
  const image = value.imageUrl;
  if (image !== null && (typeof image !== 'string' || image.length > IMAGE_URL_MAX)) return null;
  const imageUrl = image === null ? null : safeMediaUrl(image);
  const options = parseOptions(value.options, selections);
  if (!options) return null;
  let priceChange: { fromCents: number } | null = null;
  if (value.priceChange !== undefined && value.priceChange !== null) {
    if (!isPlainObject(value.priceChange) || !isCents(value.priceChange.fromCents)) return null;
    priceChange = { fromCents: value.priceChange.fromCents };
  }
  return {
    name: cleanText(value.name),
    imageUrl,
    unitCents: value.unitCents,
    currency: 'GTQ',
    seenAt,
    options,
    priceChange,
  };
}

/** Línea del documento guardado → línea válida o `null`. El `lineId` guardado NUNCA se confía: se recalcula. */
function parseLine(raw: unknown, branchId: string): CartLine | null {
  if (!isPlainObject(raw) || !isId(raw.productId)) return null;
  if (typeof raw.slug !== 'string' || !SLUG_PATTERN.test(raw.slug)) return null;
  if (!isValidQuantity(raw.quantity)) return null;
  if (typeof raw.note !== 'string' || raw.note.length > MAX_NOTE_LENGTH * 2) return null;
  const selections = parseSelections(raw.selections);
  if (!selections) return null;
  const display = parseDisplay(raw.display, selections);
  if (!display) return null;
  const note = normalizeNote(raw.note);
  return {
    lineId: computeLineId(raw.productId, branchId, note, selections),
    productId: raw.productId,
    slug: raw.slug,
    quantity: raw.quantity,
    note,
    selections,
    display,
  };
}

export type CartNoticeKind = 'legacy' | 'corrupt' | 'expired' | 'dropped' | 'storage';

export interface CartParseResult {
  state: CartState;
  /** Qué avisar al cliente (una vez), o `null` si la lectura fue normal. */
  notice: CartNoticeKind | null;
  /** Líneas aisladas descartadas dentro de un documento válido. */
  dropped: number;
  /** El documento guardado debe borrarse (corrupto o vencido). */
  discard: boolean;
}

const byteLength = (text: string): number =>
  typeof TextEncoder === 'undefined' ? text.length * 2 : new TextEncoder().encode(text).length;

const safeResult = (notice: CartNoticeKind | null, discard: boolean): CartParseResult => ({
  state: EMPTY_CART,
  notice,
  dropped: 0,
  discard,
});

/**
 * Lectura ESTRICTA de `monsushi-cart-v2`. JSON inválido, `v` distinta de 2, tipos inexactos, topes excedidos, más de 64 KB o
 * un documento con líneas pero sin sucursal = estado seguro VACÍO + aviso «dañado» + borrar la clave. TTL vencido = vacío + aviso.
 * Una línea inválida aislada dentro de un documento válido se descarta y se cuenta. El `lineId` se recalcula y las líneas que
 * resulten idénticas se unifican. No exige UUID: los ids del mock no lo son.
 */
export function parseCartV2(raw: string | null, now: number): CartParseResult {
  if (raw === null || raw === '') return safeResult(null, false);
  if (byteLength(raw) > CART_MAX_BYTES) return safeResult('corrupt', true);
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return safeResult('corrupt', true);
  }
  if (!isPlainObject(value) || value.v !== 2) return safeResult('corrupt', true);
  const { branchId, updatedAt, lines } = value;
  if (typeof updatedAt !== 'number' || !Number.isSafeInteger(updatedAt) || updatedAt < 0) {
    return safeResult('corrupt', true);
  }
  if (branchId !== null && !isId(branchId)) return safeResult('corrupt', true);
  if (!Array.isArray(lines) || lines.length > CART_MAX_LINES) return safeResult('corrupt', true);
  if (lines.length > 0 && branchId === null) return safeResult('corrupt', true);
  // Un `updatedAt` en el futuro (reloj atrasado o documento manipulado) haría el TTL infinito: se trata como corrupto.
  if (updatedAt > now + CART_FUTURE_SKEW_MS) return safeResult('corrupt', true);
  if (now - updatedAt > CART_TTL_MS) return safeResult('expired', true);

  const merged = new Map<string, CartLine>();
  let dropped = 0;
  for (const rawLine of lines) {
    const line = branchId === null ? null : parseLine(rawLine, branchId);
    if (!line) {
      dropped++;
      continue;
    }
    const existing = merged.get(line.lineId);
    if (existing) {
      const quantity = existing.quantity + line.quantity;
      if (quantity > MAX_QUANTITY) dropped++;
      else merged.set(line.lineId, { ...existing, quantity });
    } else {
      merged.set(line.lineId, line);
    }
  }
  // Unidades por (producto + selecciones) ≤ 99: la cotización las fusiona (ver `toQuoteInput`).
  const accepted: CartLine[] = [];
  const quoteTotals = new Map<string, number>();
  for (const line of merged.values()) {
    const key = quoteKey(line);
    const total = (quoteTotals.get(key) ?? 0) + line.quantity;
    if (total > MAX_QUANTITY) {
      dropped++;
      continue;
    }
    quoteTotals.set(key, total);
    accepted.push(line);
  }
  if (cartUnits(accepted) > CART_MAX_UNITS) return safeResult('corrupt', true);
  if (accepted.length === 0) {
    return {
      state: EMPTY_CART,
      notice: dropped > 0 ? 'dropped' : null,
      dropped,
      discard: dropped > 0,
    };
  }
  return {
    state: { v: 2, branchId: branchId as string, updatedAt, lines: accepted },
    notice: dropped > 0 ? 'dropped' : null,
    dropped,
    discard: false,
  };
}

/** ¿La vigencia (TTL) del carrito con líneas ya venció? Se reevalúa al volver al foco/visibilidad. */
export const isCartExpired = (state: CartState, now: number): boolean =>
  state.lines.length > 0 && now - state.updatedAt > CART_TTL_MS;

/** Texto a guardar. Solo estado del carrito: sin tokens, sin datos de pago ni PII (la nota es texto libre ≤ 140). */
export const serializeCart = (state: CartState): string => JSON.stringify(state);

/** ¿El carrito antiguo (v1) tenía productos? (solo para el aviso único; no se migra). */
export function legacyCartHadLines(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.length > 0;
  } catch {
    return false;
  }
}

// ── Mutaciones (puras: devuelven un estado nuevo o el motivo del rechazo) ────────────────────────────────

const quoteKey = (line: Pick<CartLine, 'productId' | 'selections'>): string =>
  `${line.productId}|${selectionKey(line.selections)}`;

function normalizeInput(
  input: AddToCartInput,
  now: number,
): Omit<CartLine, 'lineId'> | CartRejection {
  if (!isId(input.productId) || !isId(input.branchId) || !SLUG_PATTERN.test(input.slug)) {
    return 'INVALID_INPUT';
  }
  if (!isValidQuantity(input.quantity)) return 'INVALID_QUANTITY';
  if (input.selections.length > CART_MAX_SELECTIONS) return 'LIMIT_SELECTIONS';
  const selections = parseSelections(input.selections);
  if (!selections) return 'INVALID_INPUT';
  const options = parseOptions(input.display.options, selections);
  if (!options) return 'INVALID_INPUT';
  const imageUrl =
    input.display.imageUrl === null || input.display.imageUrl.length > IMAGE_URL_MAX
      ? null
      : safeMediaUrl(input.display.imageUrl);
  // Un nombre largo o con caracteres raros se limpia/trunca (no se rechaza el agregado); sin texto útil se usa el slug.
  const name = cleanText(input.display.name) || cleanText(input.slug);
  if (!name || !isCents(input.display.unitCents)) return 'INVALID_INPUT';
  return {
    productId: input.productId,
    slug: input.slug,
    quantity: input.quantity,
    note: normalizeNote(input.note ?? ''),
    selections,
    display: {
      name,
      imageUrl,
      unitCents: input.display.unitCents,
      currency: 'GTQ',
      seenAt: input.display.seenAt ?? now,
      options,
      priceChange: null,
    },
  };
}

/** Normaliza el estado tras una edición: sin líneas = sin sucursal; `updatedAt` = ahora. */
const touched = (lines: CartLine[], branchId: string | null, now: number): CartState => ({
  v: 2,
  branchId: lines.length > 0 ? branchId : null,
  updatedAt: now,
  lines,
});

/**
 * Agrega una o varias líneas (todas o ninguna). Configuración idéntica (producto, sucursal, nota, selecciones) = se UNIFICA sumando
 * cantidad; distinta = línea nueva. Un tope excedido se RECHAZA (nunca se recorta en silencio). Con `replace` parte de un carrito
 * vacío (p. ej. «repetir pedido» en modo reemplazar). Otra sucursal que la del carrito no vacío = `BRANCH_MISMATCH`: la política
 * (`planBranchSwitch`) decide, nunca se mezclan sucursales ni se vacía solo.
 */
export function addToCart(
  state: CartState,
  inputs: readonly AddToCartInput[],
  now: number,
  options: { replace?: boolean } = {},
): CartResult {
  if (inputs.length === 0) return { ok: false, reason: 'INVALID_INPUT' };
  let lines = options.replace ? [] : [...state.lines];
  let branchId = options.replace ? null : state.branchId;
  let lastId: string | null = null;
  let merged = false;
  for (const input of inputs) {
    const normalized = normalizeInput(input, now);
    if (typeof normalized === 'string') return { ok: false, reason: normalized };
    if (lines.length > 0 && branchId !== input.branchId) {
      return { ok: false, reason: 'BRANCH_MISMATCH' };
    }
    branchId = input.branchId;
    const lineId = computeLineId(
      normalized.productId,
      input.branchId,
      normalized.note,
      normalized.selections,
    );
    const index = lines.findIndex((l) => l.lineId === lineId);
    if (index >= 0) {
      const current = lines[index] as CartLine;
      if (current.quantity + normalized.quantity > MAX_QUANTITY) {
        return { ok: false, reason: 'LIMIT_QUANTITY' };
      }
      lines[index] = {
        ...current,
        quantity: current.quantity + normalized.quantity,
        display: normalized.display,
      };
      merged = true;
    } else {
      if (lines.length >= CART_MAX_LINES) return { ok: false, reason: 'LIMIT_LINES' };
      lines = [...lines, { lineId, ...normalized }];
    }
    lastId = lineId;
    const group = lines.filter((l) => quoteKey(l) === quoteKey(normalized));
    if (cartUnits(group) > MAX_QUANTITY) return { ok: false, reason: 'LIMIT_QUANTITY' };
    if (cartUnits(lines) > CART_MAX_UNITS) return { ok: false, reason: 'LIMIT_UNITS' };
  }
  return { ok: true, state: touched(lines, branchId, now), lineId: lastId, merged };
}

/** Fija la cantidad de una línea. 0 la elimina; NaN, decimal, negativa o > 99 se rechaza (el carrito no cambia). */
export function setLineQuantity(
  state: CartState,
  lineId: string,
  quantity: number,
  now: number,
): CartResult {
  const line = state.lines.find((l) => l.lineId === lineId);
  if (!line) return { ok: false, reason: 'NOT_FOUND' };
  if (quantity === 0) return removeLine(state, lineId, now);
  if (!isValidQuantity(quantity)) return { ok: false, reason: 'INVALID_QUANTITY' };
  const lines = state.lines.map((l) => (l.lineId === lineId ? { ...l, quantity } : l));
  const group = lines.filter((l) => quoteKey(l) === quoteKey(line));
  if (cartUnits(group) > MAX_QUANTITY) return { ok: false, reason: 'LIMIT_QUANTITY' };
  if (cartUnits(lines) > CART_MAX_UNITS) return { ok: false, reason: 'LIMIT_UNITS' };
  return { ok: true, state: touched(lines, state.branchId, now), lineId, merged: false };
}

/** Suma `delta` (±1) a la cantidad; si llega a 0, elimina la línea. */
export function changeLineQuantity(
  state: CartState,
  lineId: string,
  delta: number,
  now: number,
): CartResult {
  const line = state.lines.find((l) => l.lineId === lineId);
  if (!line) return { ok: false, reason: 'NOT_FOUND' };
  if (!Number.isInteger(delta)) return { ok: false, reason: 'INVALID_QUANTITY' };
  if (line.quantity + delta > MAX_QUANTITY) return { ok: false, reason: 'LIMIT_QUANTITY' };
  return setLineQuantity(state, lineId, Math.max(0, line.quantity + delta), now);
}

export function removeLine(state: CartState, lineId: string, now: number): CartResult {
  if (!state.lines.some((l) => l.lineId === lineId)) return { ok: false, reason: 'NOT_FOUND' };
  return {
    ok: true,
    state: touched(
      state.lines.filter((l) => l.lineId !== lineId),
      state.branchId,
      now,
    ),
    lineId: null,
    merged: false,
  };
}

/** Quita varias líneas a la vez (p. ej. las inválidas al cambiar de sucursal). */
export function removeLines(
  state: CartState,
  lineIds: ReadonlySet<string>,
  now: number,
): CartState {
  return touched(
    state.lines.filter((l) => !lineIds.has(l.lineId)),
    state.branchId,
    now,
  );
}

/** Deshace un «quitar»: vuelve a insertar la línea en su posición original (misma sucursal) o la rechaza. */
export function restoreLine(
  state: CartState,
  line: CartLine,
  branchId: string,
  now: number,
  index?: number,
): CartResult {
  const result = addToCart(
    state,
    [
      {
        productId: line.productId,
        slug: line.slug,
        branchId,
        quantity: line.quantity,
        note: line.note,
        selections: line.selections,
        display: line.display,
      },
    ],
    now,
  );
  if (!result.ok || result.merged || index === undefined) return result;
  const lines = result.state.lines.slice(0, -1);
  lines.splice(
    Math.min(index, lines.length),
    0,
    result.state.lines[result.state.lines.length - 1] as CartLine,
  );
  return { ...result, state: { ...result.state, lines } };
}

/**
 * Edición de una línea en UNA sola operación: reemplaza la línea `lineId` por la nueva configuración, en la MISMA posición y
 * conservando la sucursal del carrito. Nunca fija otra sucursal (aunque sea la única línea): una sucursal distinta se rechaza con
 * `BRANCH_MISMATCH` y la decide el guard del cambio de sucursal. Si la nueva configuración coincide con otra línea existente se
 * unifica (`merged: true`) y la UI debe avisarlo. Si se rechaza, el carrito no cambia.
 */
export function replaceLine(
  state: CartState,
  lineId: string,
  input: AddToCartInput,
  now: number,
): CartResult {
  const index = state.lines.findIndex((l) => l.lineId === lineId);
  if (index < 0) return { ok: false, reason: 'NOT_FOUND' };
  if (input.branchId !== state.branchId) return { ok: false, reason: 'BRANCH_MISMATCH' };
  const result = addToCart(
    { ...state, lines: state.lines.filter((l) => l.lineId !== lineId) },
    [input],
    now,
  );
  if (!result.ok || result.merged) return result;
  const lines = result.state.lines.slice(0, -1);
  lines.splice(index, 0, result.state.lines[result.state.lines.length - 1] as CartLine);
  return { ...result, state: { ...result.state, lines } };
}

export const clearCart = (now: number): CartState => ({
  v: 2,
  branchId: null,
  updatedAt: now,
  lines: [],
});

// ── Revalidación por línea (precio, disponibilidad y extras vigentes de la sucursal) ─────────────────────────

export const LINE_STATUSES = [
  'OK',
  'PRICE_CHANGED',
  'UNAVAILABLE',
  'INACTIVE',
  'NOT_FOUND',
  'MODIFIER_INVALID',
  'OPTION_UNAVAILABLE',
  'BRANCH_MISMATCH',
] as const;
export type LineStatus = (typeof LINE_STATUSES)[number];

/** Estados que BLOQUEAN «Continuar». `PRICE_CHANGED` no bloquea (se avisa y se reconoce). */
export const BLOCKING_STATUSES: ReadonlySet<LineStatus> = new Set([
  'UNAVAILABLE',
  'INACTIVE',
  'NOT_FOUND',
  'MODIFIER_INVALID',
  'OPTION_UNAVAILABLE',
  'BRANCH_MISMATCH',
]);
export const isBlockingStatus = (status: LineStatus): boolean => BLOCKING_STATUSES.has(status);

/** Tarjeta del menú de la sucursal (F17) reducida a lo que el carrito necesita. */
export interface LiveCard {
  productId: string;
  slug: string;
  name: string;
  imageUrl: string | null;
  /** Precio EFECTIVO de la sucursal (centavos); `null` = el servidor envió un importe NO canónico (error de revalidación). */
  priceCents: number | null;
  /** `false` = agotado (`null` = sin sucursal, se desconoce: se trata como disponible). */
  available: boolean;
}

/** Ficha pública (F12/F17): grupos ofrecibles con sus opciones activas. */
export interface LiveDetail {
  groups: readonly PublicModifierGroup[];
}

/** La ficha dio 404 `PRODUCT_NOT_FOUND` (no existe, está inactivo o su categoría no es visible). */
export const DETAIL_NOT_FOUND = 'NOT_FOUND' as const;
export type LiveDetailState = LiveDetail | typeof DETAIL_NOT_FOUND | null;

/** Datos de presentación vigentes que la revalidación escribe en la línea (nunca las selecciones). */
export interface LinePatch {
  lineId: string;
  unitCents: number;
  name: string;
  imageUrl: string | null;
  options: CartOptionDisplay[];
}

export interface LineEvaluation {
  lineId: string;
  status: LineStatus;
  /** Precio por unidad (con extras) vigente, si se pudo determinar. */
  liveUnitCents: number | null;
  /** Precio por unidad (con extras) que el cliente vio antes, si cambió. */
  previousUnitCents: number | null;
  /** Qué actualizar en la línea (solo si hay diferencias y la línea no está bloqueada). */
  patch: LinePatch | null;
  /** Los datos vigentes no se pueden interpretar (importe no canónico): no se afirma nada; la revalidación queda en error. */
  dataError?: boolean;
}

/**
 * Evalúa UNA línea con lo vigente de la sucursal. `card = null` = el producto no está en el menú de la sucursal (`INACTIVE`);
 * `detail = null` = la ficha aún no se cargó (se omiten las reglas de extras). Orden de severidad: sucursal distinta, no
 * encontrado, inactivo, agotado, extras inválidos, opción ya no disponible, precio cambiado. Las selecciones del cliente NUNCA
 * se modifican: solo se informa. Las reglas de mínimo/máximo son las de `validateSelection` (F12).
 */
export function evaluateLine(
  line: CartLine,
  live: { card: LiveCard | null; detail: LiveDetailState; branchMismatch?: boolean },
): LineEvaluation {
  const base = { lineId: line.lineId, liveUnitCents: null, previousUnitCents: null, patch: null };
  if (live.branchMismatch) return { ...base, status: 'BRANCH_MISMATCH' };
  if (live.detail === DETAIL_NOT_FOUND) return { ...base, status: 'NOT_FOUND' };
  const { card, detail } = live;
  if (!card) return { ...base, status: 'INACTIVE' };
  if (!card.available) return { ...base, status: 'UNAVAILABLE' };
  if (card.priceCents === null) return { ...base, status: 'OK', dataError: true };
  const cardName = cleanText(card.name) || line.display.name;
  let dataError = false;

  let optionGone = false;
  let modifierInvalid = false;
  let options = line.display.options;
  if (detail) {
    const groups = new Map(detail.groups.map((g) => [g.id, g]));
    options = [];
    for (const s of line.selections) {
      const group = groups.get(s.groupId);
      const option = group?.options.find((o) => o.id === s.optionId);
      const stored = line.display.options.find(
        (o) => o.groupId === s.groupId && o.optionId === s.optionId,
      ) as CartOptionDisplay;
      if (!group) {
        modifierInvalid = true;
        options.push(stored);
      } else if (!option) {
        optionGone = true;
        options.push(stored);
      } else {
        const priceCents = amountToCents(option.extraPrice);
        // Importe no canónico del servidor: NO se cae en silencio al guardado; la revalidación queda en error.
        if (priceCents === null) dataError = true;
        options.push({
          groupId: s.groupId,
          optionId: s.optionId,
          groupName: cleanText(group.name) || stored.groupName,
          optionName: cleanText(option.name) || stored.optionName,
          extraCents: priceCents ?? stored.extraCents,
        });
      }
    }
    const structured: ModifierSelection[] = [];
    for (const s of line.selections) {
      const entry = structured.find((x) => x.groupId === s.groupId);
      if (entry) entry.modifierIds.push(s.optionId);
      else structured.push({ groupId: s.groupId, modifierIds: [s.optionId] });
    }
    // Si una opción desapareció, el motivo es ESE (los mínimos/máximos que de ahí se deriven no se reportan aparte).
    if (!modifierInvalid && !optionGone && !validateSelection(detail.groups, structured).ok) {
      modifierInvalid = true;
    }
  }
  if (modifierInvalid) return { ...base, status: 'MODIFIER_INVALID' };
  if (optionGone) return { ...base, status: 'OPTION_UNAVAILABLE' };
  if (dataError) return { ...base, status: 'OK', dataError: true };

  const extras = line.selections.reduce(
    (sum, s) =>
      sum +
      (options.find((o) => o.groupId === s.groupId && o.optionId === s.optionId)?.extraCents ?? 0) *
        s.quantity,
    0,
  );
  const liveUnit = card.priceCents + extras;
  const storedUnit = lineUnitCents(line);
  const marker = line.display.priceChange?.fromCents ?? null;
  const changedNow = liveUnit !== storedUnit;
  const differs =
    changedNow ||
    line.display.name !== cardName ||
    line.display.imageUrl !== card.imageUrl ||
    JSON.stringify(options) !== JSON.stringify(line.display.options);
  return {
    lineId: line.lineId,
    status: changedNow || marker !== null ? 'PRICE_CHANGED' : 'OK',
    liveUnitCents: liveUnit,
    previousUnitCents: changedNow ? (marker ?? storedUnit) : marker,
    patch: differs
      ? {
          lineId: line.lineId,
          unitCents: card.priceCents,
          name: cardName,
          imageUrl: card.imageUrl,
          options,
        }
      : null,
  };
}

/** Escribe lo vigente en la presentación (nunca en `selections`/`quantity`/`note`) sin tocar `updatedAt`. Idempotente. */
export function applyPatches(
  state: CartState,
  patches: readonly LinePatch[],
  now: number,
): CartState {
  if (patches.length === 0) return state;
  const byId = new Map(patches.map((p) => [p.lineId, p]));
  let changed = false;
  const lines = state.lines.map((line) => {
    const patch = byId.get(line.lineId);
    if (!patch) return line;
    const next: CartLine = {
      ...line,
      display: {
        ...line.display,
        name: patch.name,
        imageUrl: patch.imageUrl,
        unitCents: patch.unitCents,
        options: patch.options,
        priceChange: line.display.priceChange ?? null,
      },
    };
    const before = lineUnitCents(line);
    const after = lineUnitCents(next);
    if (after !== before) {
      // Conserva el precio anterior MÁS ANTIGUO aún sin reconocer; si vuelve a ese precio, no hay nada que avisar.
      const from = line.display.priceChange?.fromCents ?? before;
      next.display.priceChange = from === after ? null : { fromCents: from };
    }
    if (
      JSON.stringify(next.display) ===
      JSON.stringify({ ...line.display, priceChange: line.display.priceChange ?? null })
    ) {
      return line;
    }
    next.display.seenAt = now;
    changed = true;
    return next;
  });
  return changed ? { ...state, lines } : state;
}

/** «Entendido»: limpia el aviso de cambio de precio de una línea (el precio ya está actualizado). */
export function acknowledgePriceChange(state: CartState, lineId: string): CartState {
  if (!state.lines.some((l) => l.lineId === lineId && l.display.priceChange)) return state;
  return {
    ...state,
    lines: state.lines.map((l) =>
      l.lineId === lineId ? { ...l, display: { ...l.display, priceChange: null } } : l,
    ),
  };
}

// ── «Continuar» ──────────────────────────────────────────────────────────────────────────────────────────

export type RevalidationStatus = 'idle' | 'pending' | 'ready' | 'error';
export type ContinueBlocker =
  'EMPTY' | 'NO_BRANCH' | 'BRANCH_MISMATCH' | 'PENDING' | 'ERROR' | 'INVALID_LINES';

/**
 * ¿Se puede continuar al checkout? Bloquean: carrito vacío, sin sucursal elegida, sucursal del carrito distinta a la del modo de
 * pedido, revalidación pendiente o con error (no se puede afirmar que el pedido sea válido) y cualquier línea no válida.
 * `PRICE_CHANGED` NO bloquea.
 */
export function evaluateContinue(input: {
  lineCount: number;
  statuses: readonly LineStatus[];
  revalidation: RevalidationStatus;
  /** Sucursal del modo de pedido (`null` = ninguna elegida). */
  modeBranchId: string | null;
  cartBranchId: string | null;
}): { canContinue: boolean; blockers: ContinueBlocker[] } {
  const blockers: ContinueBlocker[] = [];
  if (input.lineCount === 0) blockers.push('EMPTY');
  else {
    if (input.modeBranchId === null) blockers.push('NO_BRANCH');
    else if (input.cartBranchId !== input.modeBranchId) blockers.push('BRANCH_MISMATCH');
    if (input.revalidation === 'error') blockers.push('ERROR');
    else if (input.revalidation !== 'ready') blockers.push('PENDING');
    if (input.statuses.some(isBlockingStatus)) blockers.push('INVALID_LINES');
  }
  return { canContinue: blockers.length === 0, blockers };
}

// ── Política de sucursal ─────────────────────────────────────────────────────────────────────────────────

export interface BranchSwitchLive {
  /** Menú de la sucursal NUEVA por `productId` (`null` = aún no cargó). */
  cards: ReadonlyMap<string, LiveCard> | null;
  /** Fichas de la sucursal NUEVA por `slug` (ausente = aún no cargó). */
  details: ReadonlyMap<string, LiveDetail | typeof DETAIL_NOT_FOUND>;
}

export type PlanOutcome = 'KEEP' | 'KEEP_PRICE_CHANGED' | 'REMOVE';

export interface PlanItem {
  lineId: string;
  outcome: PlanOutcome;
  /** Por qué se quita o qué cambió (`OK` si se mantiene igual). */
  status: LineStatus;
  /** Precio por unidad (con extras) en la sucursal anterior y en la nueva (`null` si se quita). */
  beforeUnitCents: number;
  afterUnitCents: number | null;
  patch: LinePatch | null;
}

export interface BranchSwitchPlan {
  targetBranchId: string;
  /** `false` mientras falte el menú o alguna ficha de la sucursal nueva: no se puede afirmar nada. */
  ready: boolean;
  items: PlanItem[];
  keepCount: number;
  removeCount: number;
}

/**
 * Plan de cambio de sucursal, por línea: se mantiene, cambió de precio (antes → ahora), o se quita (agotado, no vendido, producto
 * inexistente, extra o grupo inexistente / selección inválida). Función pura y SIN efectos: el carrito no cambia hasta que el
 * cliente confirma (`applyBranchSwitch`). Nunca decide por el cliente ni vacía en silencio.
 */
export function planBranchSwitch(
  state: CartState,
  targetBranchId: string,
  live: BranchSwitchLive,
): BranchSwitchPlan {
  const ready = live.cards !== null && state.lines.every((l) => live.details.has(l.slug));
  const items: PlanItem[] = state.lines.map((line) => {
    const before = lineUnitCents(line);
    if (!ready) {
      return {
        lineId: line.lineId,
        outcome: 'KEEP',
        status: 'OK',
        beforeUnitCents: before,
        afterUnitCents: null,
        patch: null,
      };
    }
    const evaluation = evaluateLine(line, {
      card: live.cards?.get(line.productId) ?? null,
      detail: live.details.get(line.slug) ?? null,
    });
    const removed = isBlockingStatus(evaluation.status);
    const priceChanged = !removed && evaluation.liveUnitCents !== before;
    return {
      lineId: line.lineId,
      outcome: removed ? 'REMOVE' : priceChanged ? 'KEEP_PRICE_CHANGED' : 'KEEP',
      status: removed ? evaluation.status : priceChanged ? 'PRICE_CHANGED' : 'OK',
      beforeUnitCents: before,
      afterUnitCents: removed ? null : evaluation.liveUnitCents,
      patch: removed ? null : evaluation.patch,
    };
  });
  return {
    targetBranchId,
    ready,
    items,
    keepCount: items.filter((i) => i.outcome !== 'REMOVE').length,
    removeCount: items.filter((i) => i.outcome === 'REMOVE').length,
  };
}

/**
 * «Conservar las válidas»: el carrito pasa a la sucursal nueva SOLO con las líneas que el plan mantiene, con los precios vigentes
 * (el cambio queda como aviso `priceChange`) y `lineId` recalculado (la sucursal es parte de la clave). Sin plan listo no hace nada.
 */
export function applyBranchSwitch(
  state: CartState,
  plan: BranchSwitchPlan,
  now: number,
): CartState {
  if (!plan.ready) return state;
  const byId = new Map(plan.items.map((i) => [i.lineId, i]));
  const lines: CartLine[] = [];
  for (const line of state.lines) {
    const item = byId.get(line.lineId);
    if (!item || item.outcome === 'REMOVE') continue;
    const before = lineUnitCents(line);
    const next: CartLine = {
      ...line,
      display: { ...line.display, priceChange: line.display.priceChange ?? null },
    };
    if (item.patch) {
      next.display = {
        ...next.display,
        name: item.patch.name,
        imageUrl: item.patch.imageUrl,
        unitCents: item.patch.unitCents,
        options: item.patch.options,
        seenAt: now,
      };
    }
    const after = lineUnitCents(next);
    if (after !== before) next.display.priceChange = { fromCents: before };
    next.lineId = computeLineId(next.productId, plan.targetBranchId, next.note, next.selections);
    lines.push(next);
  }
  return touched(lines, plan.targetBranchId, now);
}

// ── Contrato de salida para F19 ──────────────────────────────────────────────────────────────────────────

export type CartQuoteInput = components['schemas']['CartQuoteInput'];

/**
 * Entrada de la cotización (F19, `CartQuoteInput` del contrato): SOLO ids y cantidades, SIN precios, nombres, imágenes ni notas.
 * Fusiona líneas de igual configuración (producto + selecciones; la nota no cambia el precio), ordena selecciones por
 * `groupId, optionId` y líneas por `productId` y clave canónica de selecciones (orden determinista). `selections[].quantity` = 1
 * (F12). Devuelve `null` si el carrito está vacío, no tiene sucursal, es de una sucursal distinta de `expectedBranchId` (si se
 * indica) o una configuración suma más de 99. **F19 debe pasar SIEMPRE `expectedBranchId`** (la sucursal del modo de pedido): sin él no
 * se comprueba que el carrito sea de la sucursal elegida. NO exige UUID: con el adaptador mock los ids no lo
 * son; la API de F19 los valida.
 */
export function toQuoteInput(
  state: CartState,
  options: { expectedBranchId?: string | null } = {},
): CartQuoteInput | null {
  if (state.lines.length === 0 || state.branchId === null) return null;
  if (options.expectedBranchId !== undefined && options.expectedBranchId !== state.branchId) {
    return null;
  }
  const grouped = new Map<
    string,
    { productId: string; selections: CartSelection[]; quantity: number; key: string }
  >();
  for (const line of state.lines) {
    const selections = sortSelections(line.selections).map((s) => ({ ...s, quantity: 1 }));
    const key = `${line.productId}|${selectionKey(selections)}`;
    const entry = grouped.get(key);
    if (entry) entry.quantity += line.quantity;
    else grouped.set(key, { productId: line.productId, selections, quantity: line.quantity, key });
  }
  const merged = [...grouped.values()];
  if (merged.some((m) => m.quantity > MAX_QUANTITY)) return null;
  merged.sort((a, b) => compare(a.productId, b.productId) || compare(a.key, b.key));
  return {
    branchId: state.branchId,
    lines: merged.map((m) => ({
      productId: m.productId,
      quantity: m.quantity,
      selections: m.selections.map((s) => ({
        groupId: s.groupId,
        optionId: s.optionId,
        quantity: s.quantity,
      })),
    })),
  };
}
