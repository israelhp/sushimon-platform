'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * Aviso de error de carga con botón "Reintentar" (anunciado a lectores de pantalla con role="alert").
 * `cooldownSec` (p. ej. 429 con `Retry-After`) deja «Reintentar» inactivo (`aria-disabled`, sin perder el foco) esa cantidad de segundos.
 */
export function ErrorNotice({
  onRetry,
  message,
  className,
  cooldownSec = 0,
}: {
  onRetry: () => void;
  message?: string;
  className?: string;
  cooldownSec?: number;
}) {
  const t = useTranslations('ui');
  const [left, setLeft] = useState(cooldownSec);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  const waiting = left > 0;
  return (
    <div role="alert" className={cn('notice notice-warn items-center', className)}>
      <TriangleAlert className="h-[18px] w-[18px] flex-none" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
        <span>{message ?? t('errorTitle')}</span>
        <button
          type="button"
          onClick={() => {
            if (!waiting) onRetry();
          }}
          aria-disabled={waiting || undefined}
          className={cn('link-btn !min-h-0 text-sm', waiting && 'cursor-not-allowed opacity-70')}
        >
          {waiting ? t('retryIn', { a: left }) : t('retry')}
        </button>
      </div>
    </div>
  );
}
