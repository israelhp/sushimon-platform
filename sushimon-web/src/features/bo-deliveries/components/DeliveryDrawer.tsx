'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { IconMapPin, IconPhone } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Drawer } from '@/components/ui/Drawer';
import { Skeleton } from '@/components/ui/Skeleton';
import type { AdminDelivery } from '@/lib/data-access/models';
import { formatDateTime } from '@/lib/format';
import {
  assignAction,
  classifyDeliveryError,
  findAction,
  isKnownEvent,
  isOrderStatus,
} from '../delivery-model';
import { useAdminDelivery } from '../hooks';
import { useDeliveryActions, useDeliveryErrorText } from '../use-delivery-actions';
import { AssignRiderModal } from './AssignRiderModal';
import { ConfirmReturnModal } from './ConfirmReturnModal';
import { DeliveryReasonModal, type DeliveryReasonKind } from './DeliveryReasonModal';
import { DeliveryStatusPill } from './DeliveryStatusPill';

const phoneHref = (phone: string) => `tel:${phone.replace(/[^0-9+]/g, '')}`;

type ModalState = 'assign' | 'return' | DeliveryReasonKind | null;

/**
 * Detalle de una entrega propia (panel lateral): pedido, motorista (nombre, vehículo, teléfono ENMASCARADO), línea de tiempo del
 * historial y, SOLO si el servidor dice `contactVisible`, el contacto y la dirección del cliente. Las acciones salen de
 * `availableActions` del servidor (`NO_PERMISSION` se oculta; `ORDER_NOT_READY` se muestra deshabilitada con su motivo): la web
 * nunca decide transiciones. Es UN solo diálogo en todos los estados (cargando, error, con datos) para no perder el foco.
 */
export function DeliveryDrawer({
  deliveryId,
  code,
  onClose,
  onChanged,
}: {
  deliveryId: string;
  /** Número del pedido para el título mientras llega el detalle (si se conoce; con un enlace directo no). */
  code?: string;
  onClose: () => void;
  /** Un comando terminó (con o sin éxito): el padre descarta páginas extra y refresca. */
  onChanged: () => void;
}) {
  const t = useTranslations('backoffice.deliveries.fleet');
  const td = useTranslations('backoffice.deliveries.fleet.detail');
  const tu = useTranslations('ui');
  const locale = useLocale();
  const query = useAdminDelivery(deliveryId);
  const errorText = useDeliveryErrorText();
  const actions = useDeliveryActions();
  const [modal, setModal] = useState<ModalState>(null);
  // Texto visible (además del aviso del toast) del último conflicto o error: estado actual y qué hacer.
  const [note, setNote] = useState<string | null>(null);
  const delivery = query.data;
  const error = !delivery && query.isError ? classifyDeliveryError(query.error) : null;

  const closeModal = (result: 'done' | 'stale' | 'closed', text?: string) => {
    setModal(null);
    if (result === 'done') setNote(null);
    if (result === 'stale' && text) setNote(text);
    if (result !== 'closed') onChanged();
  };

  const direct = async (kind: 'pickedUp' | 'delivered', d: AdminDelivery) => {
    const result = await actions.run(
      { kind, id: d.id, expectedVersion: d.version },
      d.displayNumber,
    );
    setNote(result.ok ? null : result.text);
    onChanged();
  };

  return (
    <>
      <Drawer
        open
        zone="bo"
        title={`#${delivery?.displayNumber ?? code ?? deliveryId}`}
        eyebrow={delivery ? delivery.branchName : undefined}
        headerExtra={delivery ? <DrawerHeader delivery={delivery} /> : undefined}
        footer={
          delivery ? (
            <DrawerFooter
              delivery={delivery}
              pending={actions.pending}
              onModal={setModal}
              onDirect={(kind) => void direct(kind, delivery)}
            />
          ) : undefined
        }
        onClose={onClose}
      >
        <div data-testid="delivery-detail" style={{ display: 'grid', gap: 16 }}>
          {note ? (
            <Banner zone="bo" tone="warning" role="status" data-testid="delivery-note">
              {note} {td('noteHint')}
            </Banner>
          ) : null}
          {delivery ? (
            <DrawerBody delivery={delivery} locale={locale} />
          ) : error ? (
            <Banner
              zone="bo"
              tone={error.kind === 'deliveryNotFound' ? 'neutral' : 'danger'}
              role="alert"
            >
              {errorText(error)}{' '}
              {error.kind === 'network' || error.kind === 'busy' || error.kind === 'unknown' ? (
                <button type="button" className="link-btn" onClick={() => void query.refetch()}>
                  {tu('retry')}
                </button>
              ) : null}
            </Banner>
          ) : (
            <div role="status" aria-busy="true" className="col gap8">
              <span className="sr-only">{t('loading')}</span>
              <Skeleton zone="bo" style={{ height: 64, borderRadius: 12 }} />
              <Skeleton zone="bo" style={{ height: 120, borderRadius: 12 }} />
              <Skeleton zone="bo" style={{ height: 160, borderRadius: 12 }} />
            </div>
          )}
        </div>
      </Drawer>

      {delivery && modal === 'assign' ? (
        <AssignRiderModal delivery={delivery} onClose={closeModal} />
      ) : null}
      {delivery && modal === 'return' ? (
        <ConfirmReturnModal delivery={delivery} onClose={closeModal} />
      ) : null}
      {delivery && (modal === 'cancel' || modal === 'unassign') ? (
        <DeliveryReasonModal kind={modal} delivery={delivery} onClose={closeModal} />
      ) : null}
    </>
  );
}

function DrawerHeader({ delivery }: { delivery: AdminDelivery }) {
  const t = useTranslations('backoffice.deliveries.fleet');
  return (
    <div className="row gap8 wrap" style={{ marginTop: 8 }}>
      <DeliveryStatusPill status={delivery.status} />
      {delivery.awaitingReturn ? <span className="late">{t('awaitingReturn')}</span> : null}
    </div>
  );
}

function DrawerFooter({
  delivery,
  pending,
  onModal,
  onDirect,
}: {
  delivery: AdminDelivery;
  pending: boolean;
  onModal: (modal: ModalState) => void;
  onDirect: (kind: 'pickedUp' | 'delivered') => void;
}) {
  const t = useTranslations('backoffice.deliveries.fleet.actions');
  const td = useTranslations('backoffice.deliveries.fleet.detail');
  const assign = assignAction(delivery);
  const picked = findAction(delivery, 'mark_picked_up');
  const delivered = findAction(delivery, 'mark_delivered');
  const ret = findAction(delivery, 'return_to_branch');
  const unassign = findAction(delivery, 'unassign_rider');
  const cancel = findAction(delivery, 'cancel');
  const any = assign || picked || delivered || ret || unassign || cancel;
  if (!any) {
    return (
      <p className="xs muted" style={{ margin: 0, fontWeight: 600 }}>
        {td('noActions')}
      </p>
    );
  }
  return (
    <>
      {assign ? (
        <button
          type="button"
          className="btn btn-primary block"
          disabled={pending}
          onClick={() => onModal('assign')}
        >
          {t(assign === 'assign_rider' ? 'assign' : 'reassign')}
        </button>
      ) : null}
      {picked ? (
        <div>
          <button
            type="button"
            className="btn btn-primary block"
            disabled={!picked.enabled || pending}
            aria-busy={pending}
            aria-describedby={picked.enabled ? undefined : 'dl-picked-hint'}
            onClick={() => onDirect('pickedUp')}
          >
            {t('pickedUp')}
          </button>
          {!picked.enabled ? (
            <span
              id="dl-picked-hint"
              className="xs muted"
              style={{ fontWeight: 600, display: 'block', marginTop: 4 }}
            >
              {td('orderNotReady')}
            </span>
          ) : null}
        </div>
      ) : null}
      {delivered ? (
        <button
          type="button"
          className="btn btn-primary block"
          disabled={!delivered.enabled || pending}
          aria-busy={pending}
          onClick={() => onDirect('delivered')}
        >
          {t('delivered')}
        </button>
      ) : null}
      {ret ? (
        <button
          type="button"
          className="btn btn-primary block"
          disabled={!ret.enabled || pending}
          onClick={() => onModal('return')}
        >
          {t('return')}
        </button>
      ) : null}
      {unassign ? (
        <button
          type="button"
          className="btn block"
          disabled={!unassign.enabled || pending}
          onClick={() => onModal('unassign')}
        >
          {t('unassign')}
        </button>
      ) : null}
      {cancel ? (
        <button
          type="button"
          className="btn btn-ghost danger"
          disabled={!cancel.enabled || pending}
          onClick={() => onModal('cancel')}
        >
          {t('cancel')}
        </button>
      ) : null}
    </>
  );
}

function DrawerBody({ delivery, locale }: { delivery: AdminDelivery; locale: string }) {
  const t = useTranslations('backoffice.deliveries.fleet');
  const td = useTranslations('backoffice.deliveries.fleet.detail');
  const tr = useTranslations('backoffice.riders');
  const to = useTranslations('backoffice.orders.live.status');
  const when = (iso: string) => formatDateTime(iso, locale);
  const rider = delivery.rider;
  return (
    <>
      <section aria-labelledby="dl-order">
        <div className="sect-t" id="dl-order">
          {td('order')}
        </div>
        <dl className="kv kv-wide">
          <dt>{td('orderNumber')}</dt>
          <dd>#{delivery.order.displayNumber}</dd>
          <dt>{td('orderStatus')}</dt>
          <dd>
            {isOrderStatus(delivery.order.status)
              ? to(delivery.order.status)
              : delivery.order.status}
          </dd>
          <dt>{td('provider')}</dt>
          <dd>
            {delivery.order.deliveryProvider === 'OWN' ? t('providerOwn') : t('providerOther')}
          </dd>
          <dt>{td('zone')}</dt>
          <dd>
            {[
              delivery.municipalityName,
              delivery.zone ? t('zoneName', { zone: delivery.zone }) : null,
            ]
              .filter(Boolean)
              .join(' · ') || '—'}
          </dd>
          <dt>{td('createdAt')}</dt>
          <dd>{when(delivery.createdAt)}</dd>
          <dt>{td('updatedAt')}</dt>
          <dd>{when(delivery.updatedAt)}</dd>
        </dl>
      </section>

      <section aria-labelledby="dl-rider">
        <div className="sect-t" id="dl-rider">
          {td('rider')}
        </div>
        {rider ? (
          <>
            <dl className="kv kv-wide" data-testid="delivery-rider">
              <dt>{td('riderName')}</dt>
              <dd>{rider.fullName}</dd>
              <dt>{td('riderVehicle')}</dt>
              <dd>{rider.vehicleType ? tr(`vehicles.${rider.vehicleType}`) : tr('vehicleNone')}</dd>
              <dt>{td('riderPhone')}</dt>
              <dd className="num">{rider.phoneMasked}</dd>
            </dl>
            {delivery.riderOccupied ? (
              <p className="xs muted" style={{ margin: '6px 0 0', fontWeight: 600 }}>
                {delivery.awaitingReturn ? td('occupiedUntilReturn') : td('occupied')}
              </p>
            ) : null}
          </>
        ) : (
          <div className="empty-mini">{td('noRider')}</div>
        )}
      </section>

      <section aria-labelledby="dl-contact">
        <div className="sect-t" id="dl-contact">
          {td('contact')}
        </div>
        {delivery.contactVisible && delivery.customer ? (
          <div className="info-list" data-testid="delivery-contact">
            <div className="info-row">
              <IconPhone />
              <div className="grow">
                <div className="strong">{delivery.customer.name}</div>
                <a
                  className="muted sm num"
                  style={{ fontWeight: 600 }}
                  href={phoneHref(delivery.customer.phone)}
                >
                  {delivery.customer.phone}
                </a>
              </div>
            </div>
            {delivery.address ? (
              <div className="info-row">
                <IconMapPin />
                <div className="grow">
                  <div className="strong">
                    {delivery.address.addressLine}
                    {delivery.address.zone
                      ? ` · ${t('zoneName', { zone: delivery.address.zone })}`
                      : ''}
                  </div>
                  <div className="muted sm" style={{ fontWeight: 600 }}>
                    {[delivery.address.municipalityName, delivery.address.referenceNote]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
              </div>
            ) : null}
            <p className="xs muted" style={{ margin: 0, fontWeight: 600 }}>
              {td('contactHint')}
            </p>
          </div>
        ) : (
          <div className="empty-mini" data-testid="delivery-contact-hidden">
            {td('contactHidden')}
          </div>
        )}
      </section>

      <section aria-labelledby="dl-history">
        <div className="sect-t" id="dl-history">
          {td('history')}
        </div>
        {delivery.historyTruncated ? (
          <p className="xs muted" style={{ margin: '0 0 6px', fontWeight: 600 }}>
            {td('historyTruncated')}
          </p>
        ) : null}
        <ol className="dl-timeline" data-testid="delivery-history">
          {delivery.history.map((h, i) => (
            <li key={`${h.at}-${i}`}>
              <div className="dl-tl-head">
                <span className="strong">
                  {isKnownEvent(h.event) ? t(`event.${h.event}`) : h.event}
                </span>
                <span className="xs muted num">{when(h.at)}</span>
              </div>
              <div className="xs muted" style={{ fontWeight: 600 }}>
                {[h.riderName, h.actorName ? td('by', { name: h.actorName }) : td('bySystem')]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
              {h.reason ? (
                <div className="xs" style={{ fontWeight: 600 }}>
                  {td('reason', { reason: h.reason })}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
