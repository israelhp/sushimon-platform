'use client';

import { TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';

/** Aviso de error de carga con botón "Reintentar" (anunciado a lectores de pantalla con role="alert"). */
export function ErrorNotice({
  onRetry,
  message,
  className,
}: {
  onRetry: () => void;
  message?: string;
  className?: string;
}) {
  const t = useTranslations('ui');
  return (
    <div role="alert" className={cn('notice notice-warn items-center', className)}>
      <TriangleAlert className="h-[18px] w-[18px] flex-none" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
        <span>{message ?? t('errorTitle')}</span>
        <button type="button" onClick={onRetry} className="link-btn !min-h-0 text-sm">
          {t('retry')}
        </button>
      </div>
    </div>
  );
}
