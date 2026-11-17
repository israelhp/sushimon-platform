'use client';

import { Check, TriangleAlert } from 'lucide-react';
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
/** Un aviso con acción o de advertencia dura más: hay que poder leerlo y alcanzarlo. */
export const TOAST_ACTION_DURATION = 7000;
export const TOAST_WARN_DURATION = 5000;

/** Acción opcional de un aviso (p. ej. «Deshacer»). */
export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface NotifyOptions {
  action?: ToastAction;
  /** `warn` = rechazo o advertencia (icono de alerta, `role="alert"`); por defecto confirmación (check). */
  tone?: 'success' | 'warn';
}

interface ToastState {
  message: string;
  action?: ToastAction;
  tone: 'success' | 'warn';
  /** Cambia en cada aviso para reiniciar la animación aunque el texto se repita. */
  key: number;
}

interface ToastContextValue {
  /** Muestra un aviso breve (reemplaza al anterior, como el prototipo). */
  notify: (message: string, options?: NotifyOptions) => void;
  /** Oculta el aviso actual. */
  dismiss: () => void;
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
 * para que los lectores de pantalla anuncien cada mensaje (los de advertencia llevan además `role="alert"`).
 * El valor del contexto es ESTABLE (`notify`/`dismiss`): mostrar un aviso no re-renderiza a los consumidores.
 * El temporizador se pausa con el puntero o el foco encima del aviso. Tienda: cápsula `bg-deep`. Backoffice: `.toast`.
 */
export function ToastProvider({ children, zone = 'store', duration }: ToastProviderProps) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastMs = useRef(0);
  const ms = duration ?? TOAST_DURATION[zone];

  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setToast(null);
  }, []);

  const arm = useCallback((wait: number) => {
    clearTimeout(timer.current);
    lastMs.current = wait;
    timer.current = setTimeout(() => setToast(null), wait);
  }, []);

  const notify = useCallback(
    (message: string, options: NotifyOptions = {}) => {
      const tone = options.tone ?? 'success';
      setToast((prev) => ({ message, action: options.action, tone, key: (prev?.key ?? 0) + 1 }));
      arm(options.action ? TOAST_ACTION_DURATION : tone === 'warn' ? TOAST_WARN_DURATION : ms);
    },
    [arm, ms],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  const value = useMemo<ToastContextValue>(() => ({ notify, dismiss }), [notify, dismiss]);
  const pause = () => clearTimeout(timer.current);
  const resume = () => arm(lastMs.current);

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
                role={toast.tone === 'warn' ? 'alert' : undefined}
                onMouseEnter={pause}
                onMouseLeave={resume}
                onFocus={pause}
                onBlur={resume}
                className="anim-drop fixed bottom-[calc(140px+env(safe-area-inset-bottom))] left-1/2 z-[100] flex w-max max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-2.5 rounded-full bg-deep px-4 py-2.5 text-sm font-bold text-ondeep shadow-pop sm:px-5 sm:py-3 sm:text-base lg:bottom-auto lg:top-[86px]"
              >
                <span
                  className={
                    toast.tone === 'warn'
                      ? 'inline-flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-accent text-neutral-900'
                      : 'inline-flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-success text-ondeep'
                  }
                >
                  {toast.tone === 'warn' ? (
                    <TriangleAlert className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  )}
                </span>
                {toast.message}
                {toast.action ? (
                  <button
                    type="button"
                    className="-mr-2 inline-flex min-h-[44px] items-center rounded-full px-3 font-extrabold underline"
                    onClick={() => {
                      toast.action?.onAction();
                      dismiss();
                    }}
                  >
                    {toast.action.label}
                  </button>
                ) : null}
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
