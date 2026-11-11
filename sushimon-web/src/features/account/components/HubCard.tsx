import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

/** Tarjeta de acceso del hub de la cuenta (icono, título, subtítulo y chevron). */
export function HubCard({
  href,
  icon,
  title,
  sub,
  badge,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  sub: string;
  badge?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-[76px] items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 text-fg no-underline shadow-card transition hover:-translate-y-0.5 hover:shadow-lift sm:p-4"
    >
      <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-primary-soft text-primary">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 font-extrabold">
          {title} {badge}
        </span>
        <span className="block text-[13px] leading-snug text-muted">{sub}</span>
      </span>
      <ChevronRight
        className="h-5 w-5 flex-none text-muted transition group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}

/** Estado vacío de las secciones de la cuenta (círculo con icono, texto y acción opcional). */
export function SectionEmpty({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-line px-5 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-primary">
        {icon}
      </span>
      <p className="m-0 font-extrabold">{title}</p>
      <p className="m-0 max-w-[40ch] text-[14px] text-muted">{text}</p>
      {action}
    </div>
  );
}
