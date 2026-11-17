'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef } from 'react';
import { useToast } from '@/components/ui/Toast';
import { useCartNotice } from '../cart-context';

/** Una ráfaga de cambios de otra pestaña se anuncia UNA vez, cuando se calma. */
export const EXTERNAL_ANNOUNCE_MS = 500;

/**
 * Anuncia (aria-live vía aviso) lo que el cliente no hizo en esta pestaña: cambios de OTRA pestaña (agrupados) y avisos de lectura
 * (carrito anterior, dañado, vencido, sin almacenamiento). Es el ÚNICO canal de anuncio de esos avisos: el banner del cajón es
 * solo un recordatorio visual, sin `role`.
 */
export function CartAnnouncer() {
  const t = useTranslations();
  const { externalUpdates, notice } = useCartNotice();
  const { notify } = useToast();
  const seen = useRef(externalUpdates);
  const seenNotice = useRef<string | null>(null);

  useEffect(() => {
    if (externalUpdates === seen.current) return;
    const timer = setTimeout(() => {
      seen.current = externalUpdates;
      notify(t('cart.notice.external'));
    }, EXTERNAL_ANNOUNCE_MS);
    return () => clearTimeout(timer);
  }, [externalUpdates, notify, t]);

  useEffect(() => {
    if (notice && seenNotice.current !== notice)
      notify(t(`cart.notice.${notice}`), { tone: 'warn' });
    seenNotice.current = notice;
  }, [notice, notify, t]);
  return null;
}
