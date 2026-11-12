import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type KpiTone = 'neutral' | 'amber' | 'coral' | 'blue' | 'green' | 'violet' | 'red';

export interface KpiProps {
  label: ReactNode;
  value: ReactNode;
  foot?: ReactNode;
  /** Color del indicador (`kdot k-*`). */
  tone?: KpiTone;
  /** Variante destacada (ventas del día, `kpi sales`: fondo oscuro y doble ancho). */
  highlight?: boolean;
  /** Si se indica, la tarjeta es un botón (en el prototipo lleva a la vista filtrada). */
  onClick?: () => void;
  className?: string;
}

/** Indicador del backoffice (`.kpi`, `.kpi-top`, `.kpi-label`, `.kdot`, `.kpi-val`, `.kpi-foot`). Usar dentro de `.kpis`. */
export function Kpi({
  label,
  value,
  foot,
  tone = 'neutral',
  highlight,
  onClick,
  className,
}: KpiProps) {
  const body = (
    <>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        <span className={cn('kdot', `k-${tone}`)} aria-hidden="true" />
      </div>
      <div className="kpi-val">{value}</div>
      {foot ? <div className="kpi-foot">{foot}</div> : null}
    </>
  );
  const cls = cn('kpi', highlight && 'sales', className);
  return onClick ? (
    <button type="button" className={cls} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}
