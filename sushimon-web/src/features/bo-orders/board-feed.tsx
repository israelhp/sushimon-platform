'use client';

import { useTranslations } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useShell } from '@/features/backoffice-shell/shell-context';
import type { PolledQueryState } from '@/features/polling/use-polled-query';
import { playBeep, primeBeep } from '@/lib/beep';
import type { AdminOrderBoard } from '@/lib/data-access/models';
import { groupBoard, serverNowMs, type BoardGroup } from './admin-orders-model';
import { useAdminOrderBoard, useStaffKey } from './hooks';
import { clearFresh, initialNewOrders, nextNewOrders } from './new-orders';

/**
 * F22 (spec 023 §10.3–10.4) — ÚNICO sondeador del tablero (un solo intervalo por recurso): vive en el shell, que siempre está montado.
 * Las pantallas lo leen con `useBoardFeed()` sin crear otro temporizador. También detecta pedidos nuevos entre sondeos (línea base en
 * el primero), los resalta hasta que la persona interactúa o vuelve a la pestaña, anuncia UNA vez por tanda en un único `aria-live`,
 * antepone el contador al título mientras la pestaña está oculta y, solo si la persona lo activó, hace sonar un aviso.
 */

export interface BoardFeed {
  poll: PolledQueryState<AdminOrderBoard>;
  board: AdminOrderBoard | undefined;
  groups: BoardGroup[] | null;
  /** «Ahora» del servidor (`generatedAt` + lo transcurrido); `null` sin datos. */
  serverNow: number | null;
  /** Reloj del navegador, refrescado cada 30 s (solo para «última actualización hace X»). */
  clientNow: number;
  /** Pedidos pendientes reales (el contador del tablero, no solo las tarjetas mostradas). */
  pendingCount: number;
  fresh: ReadonlySet<string>;
  freshCount: number;
  /** La persona interactuó con la lista o volvió a la pestaña: se quitan los resaltados. */
  dismissFresh: () => void;
}

const BoardFeedContext = createContext<BoardFeed | null>(null);

const TICK_MS = 30_000;

const subscribeVisibility = (cb: () => void) => {
  document.addEventListener('visibilitychange', cb);
  return () => document.removeEventListener('visibilitychange', cb);
};
const isHidden = () => document.visibilityState === 'hidden';

export function BoardFeedProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('backoffice.orders.live');
  const shell = useShell();
  const staffKey = useStaffKey();
  const poll = useAdminOrderBoard(shell.branchId, { poll: true });
  const board = poll.data;
  const key = `${staffKey ?? 'anon'}|${shell.branchId ?? 'all'}`;

  // Nuevos pedidos: estado derivado durante el render (sin efectos) y restablecido al cambiar de persona/sucursal.
  const [news, setNews] = useState(() => initialNewOrders(key));
  const computed = nextNewOrders(news, key, board, poll.updatedAt);
  if (computed !== news) setNews(computed);

  const dismissFresh = useCallback(() => setNews((s) => clearFresh(s)), []);

  // «Ahora» corregido con el servidor, refrescado cada 30 s para las esperas.
  const [clientNow, setClientNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setClientNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);
  const serverNow = board ? serverNowMs(board.generatedAt, poll.updatedAt, clientNow) : null;

  // Volver a la pestaña o enfocarla = ya lo vio.
  const hidden = useSyncExternalStore(subscribeVisibility, isHidden, () => false);
  useEffect(() => {
    const onFocus = () => dismissFresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [dismissFresh]);
  const wasHidden = useRef(false);
  useEffect(() => {
    if (wasHidden.current && !hidden) dismissFresh();
    wasHidden.current = hidden;
  }, [hidden, dismissFresh]);

  // Contador en el título mientras la pestaña está oculta.
  const freshCount = news.fresh.size;
  useEffect(() => {
    if (!hidden || freshCount === 0) return;
    const original = document.title;
    document.title = `(${freshCount}) ${original}`;
    return () => {
      document.title = original;
    };
  }, [hidden, freshCount]);

  // Sonido: opt-in, una vez por TANDA y nunca al cargar (la línea base no cuenta como tanda).
  const soundRef = useRef(shell.soundOn);
  useEffect(() => {
    soundRef.current = shell.soundOn;
  });
  useEffect(() => {
    if (news.batch > 0 && soundRef.current) playBeep();
  }, [news.batch]);
  // Una preferencia ya guardada se «arma» con el primer gesto de la persona (nunca antes).
  useEffect(() => {
    if (!shell.soundOn) return;
    const arm = () => primeBeep();
    window.addEventListener('pointerdown', arm, { once: true });
    window.addEventListener('keydown', arm, { once: true });
    return () => {
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
  }, [shell.soundOn]);

  const feed = useMemo<BoardFeed>(
    () => ({
      poll,
      board,
      groups: board ? groupBoard(board) : null,
      serverNow,
      clientNow,
      pendingCount: board?.summary.pending ?? 0,
      fresh: news.fresh,
      freshCount,
      dismissFresh,
    }),
    [poll, board, serverNow, clientNow, news.fresh, freshCount, dismissFresh],
  );

  const announcement =
    news.batch > 0
      ? t('announce', { count: news.lastBatch.length, codes: news.lastBatch.join(', ') })
      : '';

  return (
    <BoardFeedContext.Provider value={feed}>
      {children}
      {/* Único aviso de lectura (educado) para los cambios del tablero: una tanda = un mensaje. */}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>
    </BoardFeedContext.Provider>
  );
}

export function useBoardFeed(): BoardFeed {
  const ctx = useContext(BoardFeedContext);
  if (!ctx) throw new Error('useBoardFeed debe usarse dentro de <BoardFeedProvider>');
  return ctx;
}
