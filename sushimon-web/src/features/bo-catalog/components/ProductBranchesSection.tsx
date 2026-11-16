'use client';

import { useTranslations } from 'next-intl';
import { Banner } from '@/components/ui/Banner';
import { Pill } from '@/components/ui/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { useAdminProductBranches } from '@/features/branch-products/hooks';
import { branchProductServerError } from '../branch-products-view';
import { BranchProductControls } from './BranchProductControls';

/**
 * Sección «Sucursales» de un producto (F13): una fila por sucursal DENTRO del alcance del empleado (la API filtra con
 * `scopeFor`) con precio base, precio especial editable, disponibilidad, precio efectivo y última modificación. Se usa en el editor
 * (solo editar) y en la hoja «Sucursales» de cada tarjeta, que no exige `catalog.update` (un encargado marca agotados).
 */
export function ProductBranchesSection({ productId }: { productId: string }) {
  const t = useTranslations('backoffice.branchProducts');
  const tu = useTranslations('ui');
  const { can } = useShell();
  const query = useAdminProductBranches(productId);

  return (
    <section aria-labelledby={`bp-title-${productId}`} className="span-2">
      <h3
        id={`bp-title-${productId}`}
        className="sm"
        style={{ fontWeight: 800, margin: '0 0 4px' }}
      >
        {t('sectionTitle')}
      </h3>
      <p className="xs muted" style={{ margin: '0 0 10px' }}>
        {t('sectionHelp')}
      </p>
      {query.isPending ? (
        <div aria-busy="true" aria-label={tu('loading')}>
          <Skeleton zone="bo" style={{ height: 96, borderRadius: 12 }} />
        </div>
      ) : query.isError ? (
        <Banner zone="bo" tone="danger" role="alert">
          {branchProductServerError(query.error).message}{' '}
          <button type="button" className="link-btn" onClick={() => void query.refetch()}>
            {tu('retry')}
          </button>
        </Banner>
      ) : query.data.items.length === 0 ? (
        <p className="sm muted" role="status">
          {t('sectionEmpty')}
        </p>
      ) : (
        <>
          {!query.data.publiclyVisible ? (
            <Banner zone="bo" tone="info" role="status">
              {t('notVisible')}
            </Banner>
          ) : null}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
            {query.data.items.map((row) => (
              <li
                key={`${row.branchId}-${row.priceOverride ?? ''}-${row.available}-${row.updatedAt ?? ''}`}
                className="card"
                style={{ padding: 12 }}
              >
                <div className="row gap8" style={{ marginBottom: 8, alignItems: 'center' }}>
                  <strong>{row.branchName}</strong>
                  {!row.branchActive ? (
                    <Pill zone="bo" tone="muted">
                      {t('branchInactive')}
                    </Pill>
                  ) : null}
                </div>
                <BranchProductControls
                  state={row}
                  label={row.branchName}
                  canPrice={can('catalog.update', row.branchId)}
                  canAvailability={can('catalog.manage_availability', row.branchId)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
