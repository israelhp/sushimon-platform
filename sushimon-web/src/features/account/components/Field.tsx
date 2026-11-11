import type { ReactNode } from 'react';

export interface FieldControlProps {
  id: string;
  'aria-invalid': boolean;
  'aria-describedby': string | undefined;
  className: string;
}

/**
 * Campo de formulario accesible: etiqueta enlazada, y el mensaje de error asociado al control con
 * `aria-describedby` (+ `aria-invalid`). El control se recibe como función para recibir esas props.
 */
export function Field({
  id,
  label,
  error,
  help,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  error?: string;
  help?: ReactNode;
  className?: string;
  children: (props: FieldControlProps) => ReactNode;
}) {
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  const describedBy = [error ? errorId : null, help ? helpId : null].filter(Boolean).join(' ');
  return (
    <div className={className}>
      <label className="lbl" htmlFor={id}>
        {label}
      </label>
      {children({
        id,
        'aria-invalid': !!error,
        'aria-describedby': describedBy || undefined,
        className: 'input',
      })}
      {help ? (
        <p id={helpId} className="m-0 mt-1.5 text-[13px] text-muted">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="err">
          {error}
        </p>
      ) : null}
    </div>
  );
}
