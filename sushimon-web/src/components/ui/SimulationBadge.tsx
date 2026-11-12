import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { Zone } from './zone';

export interface SimulationBadgeProps {
  /**
   * `simulation`: acción simulada de un proveedor pendiente (PedidosYa, Neonet) → «Simulación».
   * `demo`: datos o sesión de demostración → «Demostración».
   */
  kind?: 'simulation' | 'demo';
  zone?: Zone;
  /** Texto propio (p. ej. una clave más específica de la tienda); por defecto el genérico del tipo. */
  children?: ReactNode;
  className?: string;
}

/**
 * Insignia visible obligatoria en flujos simulados (constitución V): `demo-badge` (borde discontinuo ámbar)
 * con los tokens de cada zona. `zone` se acepta por simetría (la clase existe en ambas hojas).
 */
export function SimulationBadge({
  kind = 'simulation',
  children,
  className,
}: SimulationBadgeProps) {
  const t = useTranslations('ui');
  return (
    <span
      className={cn('demo-badge', className)}
      title={kind === 'simulation' ? t('simulationHint') : t('demoHint')}
    >
      {children ?? (kind === 'simulation' ? t('simulation') : t('demo'))}
    </span>
  );
}
