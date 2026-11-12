'use client';

import { MessageCircle, Phone } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Skeleton } from '@/components/ui/Skeleton';
import type { Order } from '@/lib/data-access/models';
import { cn } from '@/lib/cn';
import { useBranches, useStoreConfig } from '@/features/store/hooks';
import { buildIncidentWhatsappMessage, whatsappUrl } from '../whatsapp';

/**
 * "Hacer un reclamo" por WhatsApp (como el prototipo): enlace `wa.me` con el mensaje prellenado con los
 * datos del pedido (número, fecha, entrega, productos, total, nombre). Es un enlace externo que abre el
 * cliente: la app no envía nada ni llama a ninguna API de WhatsApp. Sin número válido ofrece llamar.
 * El verde es el de la marca WhatsApp (recurso de marca fijo, no cambia con el tema).
 */
export function WhatsappReportButton({
  order,
  label,
  variant = 'solid',
  className,
}: {
  order: Order | null;
  label?: string;
  variant?: 'solid' | 'outline';
  className?: string;
}) {
  const t = useTranslations('incidents');
  const tm = useTranslations('mode');
  const tt = useTranslations('tracking');
  const locale = useLocale();
  const config = useStoreConfig();
  const branches = useBranches();

  if (!config.data) return <Skeleton className={cn('h-[52px] rounded-full', className)} />;

  const branchName = branches.data?.find((b) => b.id === order?.branchId)?.name ?? '';
  const message = order
    ? buildIncidentWhatsappMessage(order, {
        template: (values) => t('waMsg', values),
        delivery: tm('delivery'),
        pickup: tm('pickup'),
        branchName,
        locale,
      })
    : t('waMsgGeneric');
  const href = whatsappUrl(config.data.whatsappOrdersNumber, message);

  if (!href) {
    return (
      <a href={config.data.phoneHref} className={cn('btn no-underline', className)}>
        <Phone className="h-4 w-4" aria-hidden="true" /> {t('waUnavailable')}{' '}
        {config.data.phoneDisplay}
      </a>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'btn no-underline',
        variant === 'solid' &&
          '!border-transparent !bg-[#25D366] !text-[#0B3B2C] hover:!brightness-95',
        className,
      )}
    >
      <MessageCircle className="h-[18px] w-[18px]" aria-hidden="true" /> {label ?? t('waButton')}
      <span className="sr-only"> ({tt('opensNewTab')})</span>
    </a>
  );
}
