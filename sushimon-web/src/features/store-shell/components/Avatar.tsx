import { cn } from '@/lib/cn';

/** Iniciales (máx. 2) del nombre para el avatar de la cuenta. */
export function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** Primer nombre ("Ana López" → "Ana"). */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** Avatar circular con iniciales (la sesión de demostración no tiene foto). Decorativo. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex flex-none items-center justify-center rounded-full bg-secondary font-extrabold text-onsecondary',
        className ?? 'h-9 w-9 text-[13px]',
      )}
    >
      {initialsOf(name)}
    </span>
  );
}
