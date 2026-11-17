'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useState, type KeyboardEvent } from 'react';
import { Pill } from '@/components/ui/Pill';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import {
  useSetBranchProductPricing,
  useSetProductAvailability,
} from '@/features/branch-products/hooks';
import { queryKeys } from '@/features/query-keys';
import { overrideToInput } from '@/lib/branch-pricing-rules';
import type { AdminBranchProductState } from '@/lib/data-access/models';
import { formatDateTime, formatMoney } from '@/lib/format';
import { priceToNumber } from '@/lib/product-rules';
import { branchProductServerError, validateOverrideDraft } from '../branch-products-view';
import { invalidateStoreAggregates } from '@/features/store/invalidate';

interface Props {
  state: AdminBranchProductState;
  /** Nombre que identifica la fila para lectores de pantalla («Sucursal 2» o el producto). */
  label: string;
  /** `catalog.update` en ESTA sucursal (cosmético: la API decide). */
  canPrice: boolean;
  /** `catalog.manage_availability` en ESTA sucursal (cosmético: la API decide). */
  canAvailability: boolean;
}

const money = (price: string) => formatMoney(priceToNumber(price));

/**
 * Controles de UNA fila (producto × sucursal), compartidos por la sección «Sucursales» de un producto y por la matriz de una
 * sucursal: precio base, precio especial editable (`"85.00"`; vacío o «Quitar precio especial» = usa el base), interruptor de
 * disponibilidad (agotado/disponible, sin cantidades), precio efectivo y última modificación. Sin permiso el control queda de
 * solo lectura/deshabilitado; los errores se muestran por `code`. Tras guardar se recargan matrices, overlay público y ficha.
 * Remontar con `key` cuando cambie el estado del servidor para reiniciar el borrador.
 */
export function BranchProductControls({ state, label, canPrice, canAvailability }: Props) {
  const t = useTranslations('backoffice.branchProducts');
  const toast = useToast();
  const qc = useQueryClient();
  const price = useSetBranchProductPricing();
  const availability = useSetProductAvailability();
  const inputId = useId();
  const errorId = useId();
  const [text, setText] = useState(overrideToInput(state.priceOverride));
  const [error, setError] = useState('');
  const pending = price.isPending || availability.isPending;

  const onError = (e: unknown) => {
    const parsed = branchProductServerError(e);
    setError(parsed.message);
    if (parsed.reload) {
      void qc.invalidateQueries({ queryKey: queryKeys.branchProducts.all });
      void invalidateStoreAggregates(qc);
    }
  };

  const savePrice = (priceOverride: string | null) => {
    setError('');
    price.mutate(
      { branchId: state.branchId, productId: state.productId, priceOverride },
      {
        onSuccess: () =>
          toast.notify(
            t(priceOverride === null ? 'toastCleared' : 'toastPriceSaved', { name: label }),
          ),
        onError,
      },
    );
  };

  const submit = () => {
    if (!canPrice || pending) return;
    const draft = validateOverrideDraft(text, state);
    if (!draft.ok) {
      setError(draft.message);
      return;
    }
    if (!draft.changed) return;
    savePrice(draft.priceOverride);
  };

  const toggle = (available: boolean) => {
    setError('');
    availability.mutate(
      { productId: state.productId, branchId: state.branchId, available },
      {
        onSuccess: () =>
          toast.notify(t(available ? 'toastAvailable' : 'toastSoldOut', { name: label })),
        onError,
      },
    );
  };

  return (
    <div className="bp-controls" style={{ display: 'grid', gap: 10 }}>
      <dl
        className="row gap8"
        style={{ flexWrap: 'wrap', margin: 0, gap: '4px 18px', alignItems: 'baseline' }}
      >
        <div>
          <dt className="xs muted">{t('basePrice')}</dt>
          <dd style={{ margin: 0, fontWeight: 700 }}>{money(state.basePrice)}</dd>
        </div>
        <div>
          <dt className="xs muted">{t('effectivePrice')}</dt>
          <dd style={{ margin: 0, fontWeight: 800 }} data-testid="effective-price">
            {money(state.effectivePrice)}
          </dd>
        </div>
        <div>
          <dt className="xs muted">{t('updatedAt')}</dt>
          <dd style={{ margin: 0 }} className="sm">
            {state.updatedAt ? formatDateTime(state.updatedAt, 'es') : t('neverUpdated')}
          </dd>
        </div>
        <div>
          <dt className="sr-only">{t('offered')}</dt>
          <dd style={{ margin: 0 }}>
            <Pill zone="bo" tone={state.offered ? 'success' : 'muted'}>
              {t(state.offered ? 'offeredYes' : 'offeredNo')}
            </Pill>
          </dd>
        </div>
      </dl>

      {/* Sin <form>: la sección vive dentro del formulario del editor de producto (no se anidan formularios). */}
      <div
        role="group"
        aria-label={t('groupLabel', { name: label })}
        className="row gap8"
        style={{ flexWrap: 'wrap' }}
      >
        <label htmlFor={inputId} className="xs muted" style={{ fontWeight: 700 }}>
          {t('override')}
        </label>
        <input
          id={inputId}
          className="inp"
          style={{ width: 120 }}
          inputMode="decimal"
          autoComplete="off"
          maxLength={9}
          placeholder={t('overridePlaceholder')}
          aria-label={t('overrideLabel', { name: label })}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          value={text}
          readOnly={!canPrice}
          disabled={!canPrice || pending}
          onChange={(e) => {
            setText(e.target.value);
            setError('');
          }}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          type="button"
          onClick={submit}
          className="btn sm"
          disabled={!canPrice || pending}
          aria-label={t('saveLabel', { name: label })}
        >
          {t('save')}
        </button>
        <button
          type="button"
          className="btn sm"
          disabled={!canPrice || pending || state.priceOverride === null}
          aria-label={t('clearLabel', { name: label })}
          onClick={() => {
            setText('');
            savePrice(null);
          }}
        >
          {t('clear')}
        </button>
        <span className="row gap8" style={{ marginLeft: 'auto' }}>
          <Switch
            zone="bo"
            checked={state.available}
            label={t('switchLabel', { name: label })}
            title={canAvailability ? t('switchTitle') : t('noAvailabilityPermission')}
            disabled={!canAvailability || pending}
            onCheckedChange={toggle}
          />
          <span className="xs" style={{ fontWeight: 700 }}>
            {t(state.available ? 'stateAvailable' : 'stateSoldOut')}
          </span>
        </span>
      </div>
      {!canPrice ? (
        <p className="xs muted" style={{ margin: 0 }}>
          {t('noPricePermission')}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="sm"
          style={{ margin: 0, color: 'var(--bo-red-text)', fontWeight: 700 }}
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
