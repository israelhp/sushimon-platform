'use client';

import { useTranslations } from 'next-intl';
import { classifyRiderError, type RiderErrorKind } from './rider-model';

/** Mensaje en español de un error del contrato de motoristas (por `kind`, derivado del `code`; nunca del `message`). */
export function useRiderErrorText(): (error: unknown) => string {
  const t = useTranslations('backoffice.riders.errors');
  return (error) => t(classifyRiderError(error).kind satisfies RiderErrorKind);
}
