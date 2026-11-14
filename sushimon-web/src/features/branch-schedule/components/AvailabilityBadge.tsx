'use client';

import { Pill } from '@/components/ui/Pill';
import type { BranchAvailability } from '@/lib/data-access/models';
import { STATUS_TONE, statusKind } from '../availability-view';
import { useAvailabilityText } from '../use-availability-text';

/** Insignia de estado de la sucursal (abierta / cerrada / cierre extraordinario / sin horario) según el servidor. */
export function AvailabilityBadge({ availability }: { availability: BranchAvailability }) {
  const text = useAvailabilityText();
  return (
    <Pill tone={STATUS_TONE[statusKind(availability)]} dot>
      {text.label(availability)}
    </Pill>
  );
}
