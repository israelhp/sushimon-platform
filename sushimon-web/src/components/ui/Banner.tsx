import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { IconAlert, IconCheck, IconInfo } from '@/components/icons/bo/icons';
import { cn } from '@/lib/cn';
import type { Zone } from './zone';

export type BannerTone = 'info' | 'warning' | 'danger' | 'success' | 'neutral' | 'alert';

const BO_CLASS: Record<BannerTone, string> = {
  info: 'b-blue',
  warning: 'b-amber',
  danger: 'b-red',
  success: 'b-green',
  neutral: 'b-grey',
  alert: 'b-pink',
};

const STORE_CLASS: Record<BannerTone, string> = {
  info: 'notice notice-info',
  warning: 'notice',
  danger: 'notice notice-warn',
  alert: 'notice notice-warn',
  success: 'notice border-success/40 bg-success-soft',
  neutral: 'notice border-line bg-subtle',
};

export interface BannerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: BannerTone;
  zone?: Zone;
  /** Ícono propio; `null` para ocultarlo. Por defecto uno según el tono. */
  icon?: ReactNode | null;
  /** Título en negrita (tienda). */
  title?: ReactNode;
}

function defaultIcon(tone: BannerTone, zone: Zone): ReactNode {
  if (zone === 'bo') {
    if (tone === 'success') return <IconCheck size="sm" />;
    if (tone === 'info' || tone === 'neutral') return <IconInfo size="sm" />;
    return <IconAlert size="sm" />;
  }
  const cls = 'mt-0.5 h-[18px] w-[18px] flex-none';
  if (tone === 'success') return <CircleCheck className={cls} aria-hidden="true" />;
  if (tone === 'info' || tone === 'neutral') return <Info className={cls} aria-hidden="true" />;
  if (tone === 'warning') return <TriangleAlert className={cls} aria-hidden="true" />;
  return <CircleAlert className={cls} aria-hidden="true" />;
}

/**
 * Aviso en línea. Tienda: `notice` / `notice-info` / `notice-warn`. Backoffice: `banner b-*`.
 * Para avisos que aparecen dinámicamente, pasar `role="status"` o `role="alert"`.
 */
export function Banner({
  tone = 'info',
  zone = 'store',
  icon,
  title,
  className,
  children,
  ...rest
}: BannerProps) {
  const ic = icon === undefined ? defaultIcon(tone, zone) : icon;
  if (zone === 'bo') {
    return (
      <div className={cn('banner', BO_CLASS[tone], className)} {...rest}>
        {ic}
        <div className="grow">{children}</div>
      </div>
    );
  }
  return (
    <div className={cn(STORE_CLASS[tone], className)} {...rest}>
      {ic}
      <div className="min-w-0 flex-1">
        {title ? <strong className="block font-extrabold">{title}</strong> : null}
        {children}
      </div>
    </div>
  );
}
