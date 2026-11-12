import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { Zone } from './zone';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  zone?: Zone;
  /** Tienda: `card` (se eleva al pasar el cursor) o `panel` (bloque estático con padding). */
  variant?: 'card' | 'panel';
  as?: 'div' | 'section' | 'article' | 'li';
}

/** Tarjeta: tienda `card`/`panel`; backoffice `card` (usar `CardHeader`/`CardBody` para `card-h`/`card-b`). */
export function Card({
  zone = 'store',
  variant = 'card',
  as: Tag = 'div',
  className,
  ...rest
}: CardProps) {
  return <Tag className={cn(zone === 'bo' ? 'card' : variant, className)} {...rest} />;
}

/** Cabecera de tarjeta del backoffice (`card-h` con `h2` y acciones a la derecha). */
export function CardHeader({
  title,
  actions,
  className,
}: {
  title: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('card-h', className)}>
      <h2>{title}</h2>
      {actions ? (
        <>
          <span className="spacer" />
          {actions}
        </>
      ) : null}
    </div>
  );
}

/** Cuerpo de tarjeta del backoffice (`card-b`). */
export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('card-b', className)} {...rest} />;
}
