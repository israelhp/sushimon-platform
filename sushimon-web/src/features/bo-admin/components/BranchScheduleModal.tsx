'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { IconClock } from '@/components/icons/bo';
import { Modal } from '@/components/ui/Modal';
import { Tabs } from '@/components/ui/Tabs';
import { useShell } from '@/features/backoffice-shell/shell-context';
import type { AdminBranch } from '@/lib/data-access/models';
import { ClosuresPanel } from './ClosuresPanel';
import { WeeklyHoursEditor } from './WeeklyHoursEditor';

type Tab = 'hours' | 'closures';

/**
 * Horario semanal y cierres extraordinarios de UNA sucursal (F08). Los permisos del contexto administrativo solo
 * habilitan o deshabilitan controles (`branches.read` para ver, `branches.manage_hours` para editar, por sucursal):
 * el servidor decide y puede responder 403/404.
 */
export function BranchScheduleModal({
  branch,
  onClose,
}: {
  branch: AdminBranch;
  onClose: () => void;
}) {
  const t = useTranslations('backoffice.branchSchedule');
  const { can } = useShell();
  const [tab, setTab] = useState<Tab>('hours');
  const panelId = useId();
  const canManage = can('branches.manage_hours', branch.id);

  return (
    <Modal
      open
      zone="bo"
      size="wide"
      title={t('title')}
      description={branch.name}
      icon={<IconClock />}
      onClose={onClose}
    >
      <Tabs
        zone="bo"
        label={t('tabsLabel')}
        value={tab}
        onChange={setTab}
        items={[
          { value: 'hours', label: t('tabHours'), controls: panelId },
          { value: 'closures', label: t('tabClosures'), controls: panelId },
        ]}
      />
      <div id={panelId} role="tabpanel" style={{ marginTop: 14 }}>
        {tab === 'hours' ? (
          <WeeklyHoursEditor branch={branch} canManage={canManage} />
        ) : (
          <ClosuresPanel branch={branch} canManage={canManage} />
        )}
      </div>
    </Modal>
  );
}
