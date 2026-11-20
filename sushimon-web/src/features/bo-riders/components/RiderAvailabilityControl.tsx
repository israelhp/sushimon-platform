'use client';

import { useTranslations } from 'next-intl';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import type { AdminRiderSummary } from '@/lib/data-access/models';
import { useSetRiderAvailability } from '../hooks';
import { riderStateTextKey } from '../rider-model';
import { useRiderErrorText } from '../use-rider-text';

/**
 * Disponibilidad manual del motorista: interruptor con actualización optimista y reversión en error. `BUSY` no se puede
 * elegir (lo deriva el servidor de las entregas, F28). Un inactivo no puede marcarse disponible (el servidor responde 409
 * `RIDER_INACTIVE`; aquí se bloquea y se explica). Sin permiso: solo texto.
 */
export function RiderAvailabilityControl({
  rider,
  canEdit,
}: {
  rider: AdminRiderSummary;
  canEdit: boolean;
}) {
  const t = useTranslations('backoffice.riders');
  const toast = useToast();
  const errorText = useRiderErrorText();
  const mutation = useSetRiderAvailability();
  const on = rider.availability === 'AVAILABLE';
  const text = t(riderStateTextKey(rider));

  if (!canEdit)
    return (
      <span className="sm" style={{ fontWeight: 700 }}>
        {text}
      </span>
    );
  const blocked = !rider.active && !on;
  const toggle = (next: boolean) => {
    if (mutation.isPending) return;
    mutation.mutate(
      { id: rider.id, availability: next ? 'AVAILABLE' : 'UNAVAILABLE' },
      {
        onSuccess: () =>
          toast.notify(t(next ? 'toastAvailable' : 'toastUnavailable', { name: rider.fullName })),
        onError: (error) => toast.notify(errorText(error)),
      },
    );
  };
  return (
    <label className="sw-row" title={blocked ? t('availabilityInactive') : undefined}>
      <Switch
        zone="bo"
        checked={on}
        disabled={blocked || mutation.isPending}
        label={t('availabilityLabel', { name: rider.fullName })}
        onCheckedChange={toggle}
      />
      <span>{text}</span>
    </label>
  );
}
