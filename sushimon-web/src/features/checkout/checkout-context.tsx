'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type Dispatch,
  type ReactNode,
} from 'react';
import { useIsSimulation } from '@/features/orders/hooks';
import { readRemembered } from './remember';
import {
  CHECKOUT_STORAGE_KEY,
  checkoutReducer,
  initialDraft,
  parseDraft,
  serializeDraft,
  type CheckoutAction,
  type CheckoutDraft,
} from './checkout-model';

interface CheckoutContextValue {
  draft: CheckoutDraft;
  dispatch: Dispatch<CheckoutAction>;
  /** false hasta leer el borrador de sessionStorage (evita desajustes de hidratación). */
  ready: boolean;
  /** Descarta el borrador (al confirmar el pedido). */
  discard: () => void;
}

const CheckoutContext = createContext<CheckoutContextValue | null>(null);

function readStorage(): string | null {
  try {
    return window.sessionStorage.getItem(CHECKOUT_STORAGE_KEY);
  } catch {
    return null;
  }
}

interface ProviderState {
  draft: CheckoutDraft;
  ready: boolean;
}

/** `hydrate` marca el borrador como leído del almacenamiento; el resto delega en `checkoutReducer`. */
function withReady(state: ProviderState, action: CheckoutAction): ProviderState {
  return action.type === 'hydrate'
    ? { draft: action.draft, ready: true }
    : { ...state, draft: checkoutReducer(state.draft, action) };
}

/**
 * Estado del checkout en un reductor. Sobrevive a cambios de idioma/tema (el componente sigue montado) y,
 * como respaldo, a una recarga de la pestaña: se guarda el borrador NO sensible (contacto, dirección, paso,
 * método) en sessionStorage. Los datos de tarjeta nunca pasan por aquí.
 */
export function CheckoutProvider({ children }: { children: ReactNode }) {
  const demo = useIsSimulation();
  const [{ draft, ready }, dispatch] = useReducer(withReady, demo, (isDemo): ProviderState => ({
    draft: initialDraft(isDemo),
    ready: false,
  }));
  const discarded = useRef(false);

  useEffect(() => {
    const base = initialDraft(demo);
    const stored = parseDraft(readStorage(), base);
    // Con consentimiento del cliente: sus datos recordados en este dispositivo (nunca tarjeta).
    const remembered = stored ? null : readRemembered();
    // Leer el almacenamiento solo es posible en el navegador, tras hidratar.
    dispatch({
      type: 'hydrate',
      draft: stored ?? (remembered ? { ...base, ...remembered } : base),
    });
  }, [demo]);

  useEffect(() => {
    if (!ready || discarded.current) return;
    try {
      window.sessionStorage.setItem(CHECKOUT_STORAGE_KEY, serializeDraft(draft));
    } catch {
      /* almacenamiento no disponible: el estado sigue en memoria */
    }
  }, [draft, ready]);

  const value = useMemo<CheckoutContextValue>(
    () => ({
      draft,
      dispatch,
      ready,
      discard: () => {
        discarded.current = true;
        try {
          window.sessionStorage.removeItem(CHECKOUT_STORAGE_KEY);
        } catch {
          /* nada que limpiar */
        }
        dispatch({ type: 'reset', demo });
      },
    }),
    [draft, ready, demo],
  );
  return <CheckoutContext.Provider value={value}>{children}</CheckoutContext.Provider>;
}

export function useCheckoutDraft(): CheckoutContextValue {
  const ctx = useContext(CheckoutContext);
  if (!ctx) throw new Error('useCheckoutDraft debe usarse dentro de <CheckoutProvider>');
  return ctx;
}
