'use client';

import { User } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { useDemoSession } from '@/features/session/demo-session';
import { STORE_ROUTES } from '../nav';
import { Avatar } from './Avatar';

/** Botón de cuenta del encabezado: enlaza a `/cuenta`; con sesión de demostración muestra las iniciales. */
export function AccountButton({ className }: { className?: string }) {
  const t = useTranslations('auth');
  const { customer } = useDemoSession();
  return (
    <Link
      href={STORE_ROUTES.account}
      aria-label={customer ? `${t('account')}, ${customer.name}` : t('signIn')}
      title={customer ? t('account') : t('signIn')}
      className={cn(
        'flex-none items-center justify-center rounded-full no-underline',
        customer
          ? ''
          : 'h-8 w-8 border border-line bg-surface text-fg hover:bg-subtle min-[400px]:h-9 min-[400px]:w-9',
        className,
      )}
    >
      {customer ? (
        <Avatar
          name={customer.name}
          className="h-8 w-8 text-[12px] min-[400px]:h-9 min-[400px]:w-9 min-[400px]:text-[13px]"
        />
      ) : (
        <User className="h-[18px] w-[18px]" aria-hidden="true" />
      )}
    </Link>
  );
}
