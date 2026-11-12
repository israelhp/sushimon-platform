'use client';

import { Check } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { IconCheck } from '@/components/icons/bo/icons';
import { Portal } from './Portal';
import type { Zone } from './zone';

/** Duración por zona, como los prototipos: tienda 2,4 s; backoffice 2,8 s. */
export const TOAST_DURATION: Record<Zone, number> = { store: 2400, bo: 2800 };

interface ToastState {
  message: string;
  /** Cambia en cada aviso para reiniciar la animación aunque el texto se repita. */
  key: number;
}

interface ToastContextValue {
  /** Muestra un aviso breve (reemplaza al anterior, como el prototipo). */
  notify: (message: string) => void;
  /** Oculta el aviso actual. */
  dismiss: () => void;
  /** Mensaje visible (o null). */
  message: string | null;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export interface ToastProviderProps {
  children: ReactNode;
  zone?: Zone;
  /** Duración en ms (por defecto la de la zona). */
  duration?: number;
}

/**
 * Proveedor de avisos breves de una zona. La región `role="status"` + `aria-live="polite"` siempre está montada
 * para que los lectores de pantalla anuncien cada mensaje.
 * Tienda: cápsula `bg-deep` con check verde (`anim-drop`). Backoffice: `.toast`.
 */
export function ToastProvider({ children, zone = 'store', duration }: ToastProviderProps) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ms = duration ?? TOAST_DURATION[zone];

  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);

  const notify = useCallback(
    (message: string) => {
      clearTimeout(timer.current);
      setToast((prev) => ({ message, key: (prev?.key ?? 0) + 1 }));
      timer.current = setTimeout(() => setToast(null), ms);
    },
    [ms],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  const value = useMemo<ToastContextValue>(
    () => ({ notify, dismiss, message: toast?.message ?? null }),
    [notify, dismiss, toast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Portal zone={zone}>
        <div role="status" aria-live="polite" aria-atomic="true">
          {toast ? (
            zone === 'bo' ? (
              <div key={toast.key} className="toast">
                <IconCheck />
                {toast.message}
              </div>
            ) : (
              <div
                key={toast.key}
                className="anim-drop fixed bottom-[calc(140px+env(safe-area-inset-bottom))] left-1/2 z-[100] flex w-max max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-2.5 rounded-full bg-deep px-4 py-2.5 text-sm font-bold text-ondeep shadow-pop sm:px-5 sm:py-3 sm:text-base lg:bottom-auto lg:top-[86px]"
              >
                <span className="inline-flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-success text-ondeep">
                  <Check className="h-4 w-4" aria-hidden="true" />
                </span>
                {toast.message}
              </div>
            )
          ) : null}
        </div>
      </Portal>
    </ToastContext.Provider>
  );
}

/** Acceso a los avisos de la zona actual: `const { notify } = useToast(); notify(t('cart.added'))`. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast debe usarse dentro de ToastProvider');
  return ctx;
}
