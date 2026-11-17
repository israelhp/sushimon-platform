'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPersistedStore } from '@/lib/persisted-store';
import {
  CART_STORAGE_KEY,
  EMPTY_CART,
  LEGACY_CART_STORAGE_KEY,
  acknowledgePriceChange,
  addToCart,
  applyBranchSwitch,
  applyPatches,
  cartSubtotalCents,
  cartUnits,
  changeLineQuantity,
  clearCart,
  isCartExpired,
  legacyCartHadLines,
  parseCartV2,
  quantityOfProduct,
  removeLine,
  removeLines,
  replaceLine,
  restoreLine,
  serializeCart,
  setLineQuantity,
  type AddToCartInput,
  type BranchSwitchPlan,
  type CartLine,
  type CartNoticeKind,
  type CartParseResult,
  type CartResult,
  type CartState,
  type LinePatch,
} from '@/lib/cart-rules';
import { useClientReady } from '../store/client-ready';

/**
 * F18 — Carrito local del navegador (`monsushi-cart-v2`), ANÓNIMO: sin vínculo a la cuenta ni sincronización con el backend.
 * Solo preferencia del cliente: no autoriza nada y no guarda tokens, datos de pago ni PII (la nota es texto libre ≤ 140).
 * Las cifras son provisionales; el servidor recalcula (F19). Una sola fuente de verdad para encabezado, barra móvil, cajón,
 * resumen del menú, ficha y checkout.
 *
 * Rendimiento: el contexto SOLO lleva las ACCIONES (objeto estable: no re-renderiza a nadie). El estado se lee con selectores
 * `useSyncExternalStore` de snapshot primitivo (`useCartCount`, `useCartQuantity`…): el encabezado solo se re-renderiza si cambia
 * el contador y cada tarjeta solo si cambia SU cantidad.
 */

// ── Avisos (una vez, no bloqueantes) ─────────────────────────────────────────────────────────────────────

interface NoticeState {
  notice: CartNoticeKind | null;
  /** Cambios de OTRA pestaña que alteran líneas, cantidades o sucursal (los ajustes idempotentes de revalidación no cuentan). */
  externalUpdates: number;
}
let noticeState: NoticeState = { notice: null, externalUpdates: 0 };
const noticeListeners = new Set<() => void>();
const SERVER_NOTICE: NoticeState = { notice: null, externalUpdates: 0 };

function setNoticeState(next: Partial<NoticeState>) {
  noticeState = { ...noticeState, ...next };
  noticeListeners.forEach((l) => l());
}
/** Las lecturas ocurren durante el render (`getSnapshot`): el aviso se publica después, nunca dentro del render. */
const publish = (next: () => Partial<NoticeState>) => queueMicrotask(() => setNoticeState(next()));
let writeErrorReported = false;

/** Lo que el CLIENTE percibe del carrito (no la presentación): sirve para anunciar solo cambios reales de otra pestaña. */
const signature = (state: CartState): string =>
  `${state.branchId ?? ''}|${state.lines.map((l) => `${l.lineId}:${l.quantity}`).join(',')}`;

/** Última lectura (se evita parsear dos veces: `parse` y `onLoad` comparten el resultado). */
let lastParse: { raw: string | null; result: CartParseResult } | null = null;
function parseOnce(raw: string | null): CartParseResult {
  if (lastParse && lastParse.raw === raw) return lastParse.result;
  const result = parseCartV2(raw, Date.now());
  lastParse = { raw, result };
  return result;
}

const cartStore = createPersistedStore<CartState>({
  key: CART_STORAGE_KEY,
  initial: EMPTY_CART,
  parse: (raw) => {
    lastParse = null;
    return parseOnce(raw).state;
  },
  // Un valor externo INVÁLIDO nunca pisa un estado válido en memoria (ni se borra la clave de la otra pestaña).
  parseExternal: (raw, current) => {
    lastParse = null;
    const result = parseOnce(raw);
    return result.discard ? current : result.state;
  },
  serialize: serializeCart,
  crossTab: true,
  onLoad: ({ raw, value, previous, source }) => {
    const result = parseOnce(raw);
    if (source === 'storage') {
      if (!result.discard && signature(value) !== signature(previous)) {
        publish(() => ({ externalUpdates: noticeState.externalUpdates + 1 }));
      }
      return;
    }
    try {
      if (result.discard) window.localStorage.removeItem(CART_STORAGE_KEY);
      // Líneas aisladas descartadas: se reescribe el documento limpio para no repetir el aviso en cada carga.
      else if (result.dropped > 0) {
        window.localStorage.setItem(CART_STORAGE_KEY, serializeCart(result.state));
      }
      const legacy = window.localStorage.getItem(LEGACY_CART_STORAGE_KEY);
      if (legacy !== null) {
        window.localStorage.removeItem(LEGACY_CART_STORAGE_KEY);
        if (legacyCartHadLines(legacy) && !result.notice) {
          publish(() => ({ notice: 'legacy' }));
          return;
        }
      }
    } catch {
      // almacenamiento bloqueado: se sigue con lo leído
    }
    if (result.notice) publish(() => ({ notice: result.notice }));
  },
  onWrite: (ok) => {
    if (ok) {
      // Una escritura lograda reinicia el aviso: si vuelve a fallar, se vuelve a avisar.
      writeErrorReported = false;
      return;
    }
    if (writeErrorReported) return;
    writeErrorReported = true;
    publish(() => ({ notice: 'storage' }));
  },
});

// ── Acciones (no dependen del render: operan sobre el store) ─────────────────────────────────────────────

function commit(run: (state: CartState, now: number) => CartResult): CartResult {
  const result = run(cartStore.get(), Date.now());
  if (result.ok) cartStore.set(result.state);
  return result;
}

const lastLineOf = (lines: readonly CartLine[], productId: string): CartLine | undefined =>
  [...lines].reverse().find((l) => l.productId === productId);

/** Lo que devuelve `remove` para poder deshacer. */
export interface RemovedLine {
  line: CartLine;
  branchId: string;
  /** Posición que ocupaba (el «Deshacer» la restaura). */
  index: number;
}

const reject = (reason: 'NOT_FOUND'): CartResult => ({ ok: false, reason });

export interface CartActions {
  dismissNotice: () => void;
  /** Agrega (o unifica) líneas; todas o ninguna. Un tope o una sucursal distinta se RECHAZAN con su motivo. */
  add: (
    inputs: AddToCartInput | readonly AddToCartInput[],
    options?: { replace?: boolean },
  ) => CartResult;
  /** Edita UNA línea en una sola operación (misma posición y sucursal del carrito; nunca fija otra sucursal). */
  replaceLine: (lineId: string, input: AddToCartInput) => CartResult;
  setQuantity: (lineId: string, quantity: number) => CartResult;
  increment: (lineId: string) => CartResult;
  decrement: (lineId: string) => CartResult;
  /** Suma/quita una unidad de la última línea de ese producto (botones ± de las tarjetas del menú). */
  incrementProduct: (productId: string) => CartResult;
  decrementProduct: (productId: string) => CartResult;
  /** Quita la última línea de ese producto (con «Deshacer» en la UI). */
  removeProduct: (productId: string) => RemovedLine | null;
  remove: (lineId: string) => RemovedLine | null;
  restore: (removed: RemovedLine) => CartResult;
  removeMany: (lineIds: readonly string[]) => void;
  /** Vacía el carrito por acción del usuario (la UI pide confirmación). */
  clear: () => void;
  /** Escribe en la presentación lo vigente de la sucursal (no toca `selections`, cantidades ni `updatedAt`). */
  applyRevalidation: (patches: readonly LinePatch[]) => void;
  acknowledgePrice: (lineId: string) => void;
  /** Confirma el cambio de sucursal con el plan que el cliente vio (conserva solo las válidas). */
  switchBranch: (plan: BranchSwitchPlan) => void;
  /** Lee el store bajo demanda (no suscribe al componente que la llama). */
  quantityOf: (productId: string) => number;
  /** Reevalúa el TTL (al volver al foco/visibilidad): si venció, vacía con aviso. */
  checkExpiry: () => void;
}

// F20: `clearAfterOrder` NO existe todavía. Cuando haya pedidos reales se añadirá con un identificador de pedido
// CONFIRMADO por el servidor (tipo propio); el checkout simulado solo usa `clear()`.

const actions: CartActions = {
  dismissNotice: () => setNoticeState({ notice: null }),
  add: (inputs, options) =>
    commit((state, now) =>
      addToCart(state, Array.isArray(inputs) ? inputs : [inputs as AddToCartInput], now, options),
    ),
  replaceLine: (lineId, input) => commit((s, now) => replaceLine(s, lineId, input, now)),
  setQuantity: (lineId, quantity) => commit((s, now) => setLineQuantity(s, lineId, quantity, now)),
  increment: (lineId) => commit((s, now) => changeLineQuantity(s, lineId, 1, now)),
  decrement: (lineId) => commit((s, now) => changeLineQuantity(s, lineId, -1, now)),
  incrementProduct: (productId) => {
    const line = lastLineOf(cartStore.get().lines, productId);
    return line ? actions.increment(line.lineId) : reject('NOT_FOUND');
  },
  decrementProduct: (productId) => {
    const line = lastLineOf(cartStore.get().lines, productId);
    return line ? actions.decrement(line.lineId) : reject('NOT_FOUND');
  },
  removeProduct: (productId) => {
    const line = lastLineOf(cartStore.get().lines, productId);
    return line ? actions.remove(line.lineId) : null;
  },
  remove: (lineId) => {
    const state = cartStore.get();
    const line = state.lines.find((l) => l.lineId === lineId);
    if (!line || !state.branchId) return null;
    commit((s, now) => removeLine(s, lineId, now));
    return { line, branchId: state.branchId, index: state.lines.indexOf(line) };
  },
  restore: (removed) =>
    commit((s, now) => restoreLine(s, removed.line, removed.branchId, now, removed.index)),
  removeMany: (lineIds) => {
    const ids = new Set(lineIds);
    cartStore.set((s) => removeLines(s, ids, Date.now()));
  },
  clear: () => cartStore.set(clearCart(Date.now())),
  applyRevalidation: (patches) => {
    const state = cartStore.get();
    const next = applyPatches(state, patches, Date.now());
    if (next !== state) cartStore.set(next);
  },
  acknowledgePrice: (lineId) => {
    const state = cartStore.get();
    const next = acknowledgePriceChange(state, lineId);
    if (next !== state) cartStore.set(next);
  },
  switchBranch: (plan) => cartStore.set((s) => applyBranchSwitch(s, plan, Date.now())),
  quantityOf: (productId) => quantityOfProduct(cartStore.get().lines, productId),
  checkExpiry: () => {
    if (!isCartExpired(cartStore.get(), Date.now())) return;
    cartStore.set(clearCart(Date.now()));
    publish(() => ({ notice: 'expired' }));
  },
};

const ActionsContext = createContext<CartActions | null>(null);

const subscribeNotices = (listener: () => void) => {
  noticeListeners.add(listener);
  return () => {
    noticeListeners.delete(listener);
  };
};

/** Solo para pruebas: reinicia los avisos entre casos. */
export function resetCartNoticesForTests(): void {
  noticeState = { notice: null, externalUpdates: 0 };
  writeErrorReported = false;
}

/** Proveedor de ACCIONES (valor estable: nunca re-renderiza a los consumidores). También reevalúa el TTL al volver al foco. */
export function CartProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const check = () => {
      if (document.visibilityState === 'visible') actions.checkExpiry();
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  return <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>;
}

/** Acciones del carrito (estable). No suscribe al estado. */
export function useCartActions(): CartActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('useCartActions debe usarse dentro de <CartProvider>');
  return ctx;
}

// ── Selectores (snapshots primitivos o referencias estables del store) ───────────────────────────────────

const serverLines: readonly CartLine[] = EMPTY_CART.lines;

/** Unidades totales (encabezado y barra móvil). */
export function useCartCount(): number {
  return useSyncExternalStore(
    cartStore.subscribe,
    () => cartUnits(cartStore.get().lines),
    () => 0,
  );
}

/** Unidades de UN producto (tarjetas del menú): solo re-renderiza si cambia ese número. */
export function useCartQuantity(productId: string): number {
  return useSyncExternalStore(
    cartStore.subscribe,
    () => quantityOfProduct(cartStore.get().lines, productId),
    () => 0,
  );
}

/** Forma del producto en el carrito: cuántas líneas tiene y si alguna lleva extras (snapshot primitivo). */
export function useCartProductShape(productId: string): {
  lineCount: number;
  hasSelections: boolean;
} {
  const key = useSyncExternalStore(
    cartStore.subscribe,
    () => {
      const mine = cartStore.get().lines.filter((l) => l.productId === productId);
      return `${mine.length}:${mine.some((l) => l.selections.length > 0) ? 1 : 0}`;
    },
    () => '0:0',
  );
  const [lineCount, sel] = key.split(':');
  return { lineCount: Number(lineCount), hasSelections: sel === '1' };
}

export function useCartLines(): readonly CartLine[] {
  return useSyncExternalStore(
    cartStore.subscribe,
    () => cartStore.get().lines,
    () => serverLines,
  );
}

export function useCartBranchId(): string | null {
  return useSyncExternalStore(
    cartStore.subscribe,
    () => cartStore.get().branchId,
    () => null,
  );
}

/** Subtotal ESTIMADO en centavos con los precios provisionales guardados. */
export function useCartSubtotalCents(): number {
  return useSyncExternalStore(
    cartStore.subscribe,
    () => cartSubtotalCents(cartStore.get().lines),
    () => 0,
  );
}

export function useCartNotice(): NoticeState {
  return useSyncExternalStore(
    subscribeNotices,
    () => noticeState,
    () => SERVER_NOTICE,
  );
}

export interface CartApi extends CartActions {
  /** `false` hasta que el navegador toma el control (el servidor y la hidratación ven un carrito vacío). */
  ready: boolean;
  lines: readonly CartLine[];
  /** Sucursal del carrito (`null` si está vacío). */
  branchId: string | null;
  /** Unidades totales (no líneas): lo que muestran el encabezado y la barra móvil. */
  count: number;
  subtotalCents: number;
  /** Aviso pendiente (carrito anterior descartado, dañado, vencido…) o `null`. */
  notice: CartNoticeKind | null;
  externalUpdates: number;
}

/**
 * Vista COMPLETA del carrito (se re-renderiza con cada cambio): úsala solo en el cajón, el resumen, el checkout y la ficha.
 * Encabezado, barra móvil y tarjetas usan los selectores de arriba.
 */
export function useCart(): CartApi {
  const acts = useCartActions();
  const lines = useCartLines();
  const branchId = useCartBranchId();
  const count = useCartCount();
  const subtotalCents = useCartSubtotalCents();
  const { notice, externalUpdates } = useCartNotice();
  const ready = useClientReady();
  return useMemo(
    () => ({ ...acts, ready, lines, branchId, count, subtotalCents, notice, externalUpdates }),
    [acts, ready, lines, branchId, count, subtotalCents, notice, externalUpdates],
  );
}
