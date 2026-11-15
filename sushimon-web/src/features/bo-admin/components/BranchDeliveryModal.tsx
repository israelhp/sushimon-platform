'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { IconBike } from '@/components/icons/bo';
import { Modal } from '@/components/ui/Modal';
import { Tabs } from '@/components/ui/Tabs';
import { useAdminBranches } from '@/features/branches/hooks';
import { useShell } from '@/features/backoffice-shell/shell-context';
import type { AdminBranch } from '@/lib/data-access/models';
import { DeliverySettingsPanel } from './DeliverySettingsPanel';
import { DeliveryZonesPanel } from './DeliveryZonesPanel';

type Tab = 'providers' | 'zones';

/**
 * Entrega de UNA sucursal (F09): proveedores (interruptores + estado de la integración) y zonas propias. Se abre desde la
 * tarjeta de la sucursal, igual que «Horario y cierres» (F08): la configuración logística es por sucursal y el alcance
 * de permisos también. Los permisos del contexto solo habilitan o deshabilitan controles; el servidor decide.
 */
export function BranchDeliveryModal({
  branch,
  onClose,
}: {
  branch: AdminBranch;
  onClose: () => void;
}) {
  const t = useTranslations('backoffice.branchDelivery');
  const { can } = useShell();
  const [tab, setTab] = useState<Tab>('providers');
  const panelId = useId();
  const canManage = can('branches.manage_delivery_zones', branch.id);

  return (
    <Modal
      open
      zone="bo"
      size="wide"
      title={t('title')}
      description={branch.name}
      icon={<IconBike />}
      onClose={onClose}
    >
      <Tabs
        zone="bo"
        label={t('tabsLabel')}
        value={tab}
        onChange={setTab}
        items={[
          { value: 'providers', label: t('tabProviders'), controls: panelId },
          { value: 'zones', label: t('tabZones'), controls: panelId },
        ]}
      />
      <div id={panelId} role="tabpanel" style={{ marginTop: 14 }}>
        {tab === 'providers' ? (
          <DeliverySettingsPanel branch={branch} canManage={canManage} />
        ) : (
          <DeliveryZonesPanel branch={branch} branches={[branch]} />
        )}
      </div>
    </Modal>
  );
}

/** Zonas de TODAS las sucursales del alcance (columna y filtro por sucursal). */
export function AllDeliveryZonesModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations('backoffice.branchDelivery');
  // Hasta 100 sucursales del alcance para el filtro y el alta (la API limita `pageSize` a 100).
  const branches = useAdminBranches({ sort: 'name', order: 'asc', pageSize: 100 });
  return (
    <Modal
      open
      zone="bo"
      size="wide"
      title={t('allZonesTitle')}
      description={t('allZonesSub')}
      icon={<IconBike />}
      onClose={onClose}
    >
      <DeliveryZonesPanel branches={branches.data?.items ?? []} />
    </Modal>
  );
}
