'use client';

import { useTranslations } from 'next-intl';
import { Suspense, useState } from 'react';
import { Banner } from '@/components/ui/Banner';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tabs } from '@/components/ui/Tabs';
import { useDataClient } from '@/lib/data-access/provider';
import { OwnDeliveriesView } from './OwnDeliveriesView';
import { SimulationView } from './SimulationView';

type Section = 'own' | 'pedidosya';

/**
 * Pantalla Entregas (F28, spec 029 §13): «Reparto propio» es REAL (contrato `admin-deliveries`) y está visualmente separado de la
 * «Simulación — no es un envío real» de PedidosYa (`MOCK_ONLY`/`BLOCKED_EXTERNAL`: nunca confirma entregas reales). Con datos reales
 * (`http`) no hay simulación: PedidosYa sigue bloqueado hasta tener documentación y credenciales.
 */
export function DeliveriesScreen() {
  const t = useTranslations('backoffice.deliveries');
  const client = useDataClient();
  const [section, setSection] = useState<Section>('own');
  const simulated = client.kind === 'mock';

  return (
    <div className="page" style={{ animation: 'none' }}>
      <div className="page-h page-h-fit">
        <div className="grow">
          <h1>{t('title')}</h1>
          <div className="page-sub">{t('fleet.subtitle')}</div>
        </div>
      </div>

      {simulated ? (
        <Tabs<Section>
          zone="bo"
          label={t('fleet.tabs.label')}
          value={section}
          onChange={setSection}
          items={[
            { value: 'own', label: t('fleet.tabs.own'), controls: 'deliveries-panel-own' },
            {
              value: 'pedidosya',
              label: t('fleet.tabs.pedidosya'),
              controls: 'deliveries-panel-pedidosya',
            },
          ]}
        />
      ) : null}

      {section === 'own' || !simulated ? (
        <div id="deliveries-panel-own" role={simulated ? 'tabpanel' : undefined}>
          <Suspense fallback={<Skeleton zone="bo" style={{ height: 240, borderRadius: 16 }} />}>
            <OwnDeliveriesView />
          </Suspense>
        </div>
      ) : (
        <div id="deliveries-panel-pedidosya" role="tabpanel">
          <SimulationView />
        </div>
      )}

      {!simulated ? (
        <Banner zone="bo" tone="info" role="note">
          {t('fleet.pedidosyaBlocked')}
        </Banner>
      ) : null}
    </div>
  );
}
