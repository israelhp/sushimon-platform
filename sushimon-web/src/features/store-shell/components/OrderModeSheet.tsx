'use client';

import { TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useId, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import type { PublicBranch } from '@/lib/data-access/models';
import {
  DEFAULT_DELIVERY_DRAFT,
  checkZone,
  hasErrors,
  requiresZone,
  validateDraft,
  zoneChoices,
  type DeliveryDraft,
  type DraftErrors,
} from '@/features/order-mode/draft';
import { BranchNotAcceptingNotice } from '@/features/branch-schedule/components/BranchNotAcceptingNotice';
import { useBranchesAvailability } from '@/features/branch-schedule/hooks';
import { useAvailabilityText } from '@/features/branch-schedule/use-availability-text';
import { usePublicBranches } from '@/features/branches/hooks';
import { useBranchChangeInvalidation } from '@/features/order-mode/branch-selection';
import { useOrderMode } from '@/features/order-mode/order-mode-context';
import { CoverageNotice } from '@/features/delivery-coverage/components/CoverageNotice';
import { useAddressCoverage, useLocationOptions } from '@/features/delivery-coverage/hooks';
import type { CoverageOutcome } from '@/features/delivery-coverage/summary';
import { useStoreConfig } from '@/features/store/hooks';
import { STORE_ROUTES } from '../nav';
import { useOrderSheet, type OrderSheetNotice } from '../store-shell-context';
import { ErrorNotice } from './ErrorNotice';

/**
 * Hoja «Pedir ahora» (ADR-0036: la tienda es solo a domicilio e inmediata). Pide departamento, municipio, zona y
 * dirección, asigna la sucursal por cobertura y muestra la estimación de envío. Si no hay cobertura o la sucursal está
 * cerrada solo informa (sin ofrecer recoger ni programar). Al confirmar guarda el modo (preferencia del dispositivo) y
 * lleva al menú; el servidor vuelve a validar todo al crear el pedido.
 */
export function OrderModeSheet() {
  const { isOpen, notice, close } = useOrderSheet();
  if (!isOpen) return null;
  return <OrderModeSheetDialog notice={notice} onClose={close} />;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={id} className="err">
      {message}
    </p>
  ) : null;
}

function initialDelivery(
  address: ReturnType<typeof useOrderMode>['mode']['address'],
): DeliveryDraft {
  return address
    ? {
        department: address.department,
        municipality: address.municipality,
        zone: address.zone,
        line: address.line,
      }
    : DEFAULT_DELIVERY_DRAFT;
}

function OrderModeSheetDialog({
  notice,
  onClose,
}: {
  notice: OrderSheetNotice | null;
  onClose: () => void;
}) {
  const t = useTranslations();
  const router = useRouter();
  const uid = useId();
  const { mode, setMode } = useOrderMode();
  const configQuery = useStoreConfig();
  // Lista PÚBLICA real (F07: solo activas). «Abierta ahora» y horario vienen del servidor (F08) y la cobertura (F09)
  // también; solo `useStoreConfig` (zonas inexistentes: F10) sigue siendo simulado.
  const publicQuery = usePublicBranches();
  const invalidateOnBranchChange = useBranchChangeInvalidation();
  const config = configQuery.data;
  const publicBranches = useMemo(() => publicQuery.data ?? [], [publicQuery.data]);

  const availability = useBranchesAvailability(publicBranches.map((b) => b.id));
  const accepting = (id: string) => availability.byId[id]?.isAcceptingOrders;
  const availabilityText = useAvailabilityText();

  const [delivery, setDelivery] = useState<DeliveryDraft>(() => initialDelivery(mode.address));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [submitError, setSubmitError] = useState('');

  // ── Cobertura y sucursal ──────────────────────────────────────────────────────────────────
  // La comprobación (F09) se dispara SOLO al completar la selección departamento → municipio → zona (son <select>:
  // no hay consulta por pulsación); abrir Home/Menú no consulta nada.
  const needsZone = requiresZone(delivery.department, delivery.municipality);
  const zoneOk = !needsZone || checkZone(delivery.zone, config?.nonexistentZones ?? []) === 'ok';
  const selectionComplete = !!delivery.department && !!delivery.municipality && zoneOk;
  const locations = useLocationOptions(delivery.department, true);
  const coverage = useAddressCoverage(
    { department: delivery.department, municipality: delivery.municipality, zone: delivery.zone },
    publicBranches.map((b) => b.id),
    selectionComplete,
  );
  // Solo una cobertura PROPIA confirmada (con tarifa del servidor) permite continuar (checkout: F19).
  const best = coverage.best;
  const assignedId =
    best?.kind === 'confirmed' && best.provider === 'OWN' && best.fee !== null
      ? best.branchId
      : null;
  const activeBranch: PublicBranch | undefined = assignedId
    ? publicBranches.find((b) => b.id === assignedId)
    : undefined;
  const branchNameOf = (id: string) => publicBranches.find((b) => b.id === id)?.name ?? id;

  // Sucursal cerrada: informativo (ADR-0036 D5), sin ofrecer programar.
  const closedNow = !!activeBranch && accepting(activeBranch.id) === false ? activeBranch : null;
  const allClosed =
    publicBranches.length > 0 && publicBranches.every((b) => accepting(b.id) === false);
  const soonestOpens = useMemo(() => {
    const list = Object.values(availability.byId).flatMap((a) =>
      a?.nextOpensAt ? [{ at: a.nextOpensAt, serverTime: a.serverTime }] : [],
    );
    return list.sort((x, y) => x.at.localeCompare(y.at))[0] ?? null;
  }, [availability.byId]);

  const setDeliveryField = (patch: Partial<DeliveryDraft>) => {
    setDelivery((d) => ({ ...d, ...patch }));
    setErrors((e) => ({
      ...e,
      ...(patch.line !== undefined && { line: undefined }),
      ...(patch.zone !== undefined && { zone: undefined }),
      ...(patch.department !== undefined && { department: undefined }),
      ...(patch.municipality !== undefined && { municipality: undefined }),
    }));
  };

  const submit = () => {
    if (!config) return;
    const found = validateDraft({ delivery }, config.nonexistentZones);
    setErrors(found);
    setSubmitError('');
    if (hasErrors(found)) return;
    if (!assignedId) {
      // Sin comprobación (calculando o con error), sin cobertura o solo pendiente: no se continúa.
      setSubmitError(coverageMessage(best, t));
      return;
    }
    const branchId = activeBranch?.id ?? null;
    setMode({
      type: 'delivery',
      branchId,
      address: {
        department: delivery.department,
        municipality: delivery.municipality,
        zone: needsZone ? String(Number(delivery.zone)) : '',
        line: delivery.line.trim(),
        references: mode.address?.references ?? '',
      },
    });
    invalidateOnBranchChange(mode.branchId, branchId);
    onClose();
    router.push(STORE_ROUTES.menu);
  };

  const fieldId = (name: string) => `${uid}-${name}`;
  const loadFailed = configQuery.isError || publicQuery.isError;
  const loading = !loadFailed && (configQuery.isPending || publicQuery.isPending);
  const err = (key: DraftErrors[keyof DraftErrors]) => (key ? t(key) : undefined);

  return (
    <Modal
      open
      onClose={onClose}
      title={t('mode.orderNow')}
      titleClassName="text-[26px]"
      className="md:w-[520px]!"
      footer={
        <button
          type="button"
          className="btn btn-primary w-full"
          onClick={submit}
          disabled={!config || !publicQuery.data}
        >
          {t('mode.seeMenu')}
        </button>
      }
    >
      <div className="flex flex-col gap-5">
        {notice === 'branchRemoved' ? (
          <p className="notice notice-warn" role="status">
            <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
            {t('mode.branchRemoved')}
          </p>
        ) : null}

        {loadFailed ? (
          <ErrorNotice
            message={publicQuery.isError ? t('mode.branchesError') : undefined}
            onRetry={() => {
              if (configQuery.isError) void configQuery.refetch();
              if (publicQuery.isError) void publicQuery.refetch();
            }}
          />
        ) : null}

        <fieldset className="flex flex-col gap-3">
          <legend className="lbl">{t('mode.where')}</legend>
          {loading || !config ? (
            <div className="grid gap-3" aria-busy="true">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="lbl" htmlFor={fieldId('dept')}>
                    {t('checkout.department')}
                  </label>
                  <select
                    id={fieldId('dept')}
                    className="input"
                    value={delivery.department}
                    aria-invalid={!!errors.department}
                    onChange={(e) =>
                      setDeliveryField({ department: e.target.value, municipality: '', zone: '' })
                    }
                  >
                    <option value="">{t('checkout.select')}</option>
                    {locations.departments.map((d) => (
                      <option key={d.id} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  <FieldError id={fieldId('dept-error')} message={err(errors.department)} />
                </div>
                <div>
                  <label className="lbl" htmlFor={fieldId('muni')}>
                    {t('checkout.municipality')}
                  </label>
                  <select
                    id={fieldId('muni')}
                    className="input"
                    value={delivery.municipality}
                    aria-invalid={!!errors.municipality}
                    onChange={(e) => setDeliveryField({ municipality: e.target.value, zone: '' })}
                  >
                    <option value="">{t('checkout.select')}</option>
                    {locations.municipalities.map((m) => (
                      <option key={m.id} value={m.name}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <FieldError id={fieldId('muni-error')} message={err(errors.municipality)} />
                </div>
              </div>
              {needsZone ? (
                <div>
                  <label className="lbl" htmlFor={fieldId('zone')}>
                    {t('checkout.zone')}
                  </label>
                  <select
                    id={fieldId('zone')}
                    className="input"
                    aria-invalid={!!errors.zone}
                    aria-describedby={errors.zone ? fieldId('zone-error') : undefined}
                    value={delivery.zone}
                    onChange={(e) => setDeliveryField({ zone: e.target.value })}
                  >
                    <option value="">{t('checkout.select')}</option>
                    {zoneChoices(config.nonexistentZones).map((z) => (
                      <option key={z} value={String(z)}>
                        {t('checkout.zone')} {z}
                      </option>
                    ))}
                  </select>
                  <FieldError id={fieldId('zone-error')} message={err(errors.zone)} />
                </div>
              ) : null}
              <div>
                <label className="lbl" htmlFor={fieldId('addr')}>
                  {t('checkout.exactAddress')}
                </label>
                <input
                  id={fieldId('addr')}
                  className="input"
                  autoComplete="off"
                  aria-invalid={!!errors.line}
                  aria-describedby={errors.line ? fieldId('addr-error') : undefined}
                  placeholder={t('mode.addressPh')}
                  value={delivery.line}
                  onChange={(e) => setDeliveryField({ line: e.target.value })}
                />
                <FieldError id={fieldId('addr-error')} message={err(errors.line)} />
              </div>
              {locations.isError ? (
                <ErrorNotice message={t('coverage.locationsError')} onRetry={locations.refetch} />
              ) : null}
              {!selectionComplete && !locations.isError && !locations.municipalitiesEmpty ? (
                <p className="m-0 text-[13px] text-muted">{t('coverage.selectionHint')}</p>
              ) : null}
              <CoverageNotice
                state={coverage.state}
                outcome={best}
                branchName={branchNameOf}
                municipalityUnavailable={locations.municipalitiesEmpty}
                onRetry={coverage.refetch}
              />
              <p className="text-[12px] text-muted">{t('mode.savedNote')}</p>
            </>
          )}
        </fieldset>

        {closedNow ? (
          <BranchNotAcceptingNotice
            name={closedNow.name}
            availability={availability.byId[closedNow.id]}
          />
        ) : allClosed ? (
          <p className="notice notice-warn" role="status">
            <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
            <span>
              {t('mode.allClosed')}
              {soonestOpens
                ? ` ${t('branchSchedule.notice.opensLater', { when: availabilityText.when(soonestOpens.at, soonestOpens.serverTime) })}`
                : ''}
            </span>
          </p>
        ) : null}

        {submitError ? (
          <p className="err" role="alert">
            {submitError}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** Mensaje cuando no se puede continuar a domicilio: pendiente, sin cobertura, solo PedidosYa simulado o sin datos. */
function coverageMessage(best: CoverageOutcome | null, t: ReturnType<typeof useTranslations>) {
  if (!best) return t('validation.quote');
  if (best.kind === 'pending') return t('coverage.pending');
  if (best.kind === 'confirmed') return t('coverage.pyConfirmed');
  return t('delivery.notCovered');
}
