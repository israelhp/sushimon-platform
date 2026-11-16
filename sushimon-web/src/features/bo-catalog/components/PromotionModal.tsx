'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { IconTag } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useNow } from '@/features/backoffice-shell/use-now';
import { useShell } from '@/features/backoffice-shell/shell-context';
import {
  useAdminPromotion,
  useCreatePromotion,
  useUpdatePromotion,
} from '@/features/promotions/hooks';
import { queryKeys } from '@/features/query-keys';
import { isApiError } from '@/lib/data-access/errors';
import type { AdminPromotion } from '@/lib/data-access/models';
import { PROMOTION_DESCRIPTION_MAX, PROMOTION_NAME_MAX } from '@/lib/promotion-rules';
import { localDate } from '@/lib/time';
import {
  PROMOTION_KINDS,
  emptyPromotionForm,
  promotionServerError,
  promotionToForm,
  toCreateRequest,
  toUpdateRequest,
  validatePromotionForm,
  type PromotionField,
  type PromotionFormValues,
} from '../promotions-view';
import { PromotionScheduleEditor } from './PromotionScheduleEditor';
import { BranchScopePicker, ProductScopePicker } from './PromotionScopePickers';

const FIELD_ORDER: readonly PromotionField[] = [
  'name',
  'description',
  'code',
  'value',
  'startsAt',
  'endsAt',
  'branches',
  'products',
  'schedule',
];

type Errors = Partial<Record<PromotionField, string>>;

/**
 * Alta y edición de una promoción o cupón (F15). Al editar carga el detalle (`GET /v1/admin/promotions/{id}`: `version`, productos
 * y tramos) y envía solo lo que cambió con `expectedVersion`; un 409 de versión ofrece cargar la versión actual sin pisar a nadie.
 */
export function PromotionModal({
  promotionId,
  onClose,
}: {
  /** Promoción a editar; sin él, alta. */
  promotionId?: string;
  onClose: () => void;
}) {
  const t = useTranslations('backoffice.promotions.form');
  const tu = useTranslations('ui');
  const detail = useAdminPromotion(promotionId ?? null);
  const [generation, setGeneration] = useState(0);

  if (promotionId && !detail.data) {
    const gone = detail.isError && isApiError(detail.error) && detail.error.status === 404;
    return (
      <Modal
        open
        zone="bo"
        size="wide"
        icon={<IconTag />}
        title={t('titleEdit')}
        onClose={onClose}
        footer={
          <button type="button" className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
        }
      >
        {detail.isError ? (
          <Banner zone="bo" tone="danger" role="alert">
            {gone ? t('gone') : t('loadError')}{' '}
            {gone ? null : (
              <button type="button" className="link-btn" onClick={() => void detail.refetch()}>
                {tu('retry')}
              </button>
            )}
          </Banner>
        ) : (
          <div aria-busy="true" aria-label={tu('loading')}>
            <Skeleton zone="bo" style={{ height: 240, borderRadius: 12 }} />
          </div>
        )}
      </Modal>
    );
  }

  return (
    <PromotionForm
      // Al cargar la versión actual tras un 409 el formulario se reinicia con los datos nuevos.
      key={`${detail.data?.id ?? 'new'}-${detail.data?.version ?? 0}-${generation}`}
      current={detail.data}
      onReload={async () => {
        await detail.refetch();
        setGeneration((n) => n + 1);
      }}
      onClose={onClose}
    />
  );
}

function PromotionForm({
  current,
  onReload,
  onClose,
}: {
  current?: AdminPromotion;
  onReload: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('backoffice.promotions.form');
  const tp = useTranslations('backoffice.promotions');
  const toast = useToast();
  const qc = useQueryClient();
  const { grants } = useShell();
  const create = useCreatePromotion();
  const update = useUpdatePromotion();
  const now = useNow();
  const editing = Boolean(current);
  const pending = create.isPending || update.isPending;
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  const canAll = Boolean(grants[editing ? 'promotions.update' : 'promotions.create']?.allBranches);
  const [values, setValues] = useState<PromotionFormValues>(() =>
    current ? promotionToForm(current) : emptyPromotionForm(now ? localDate(now) : '', canAll),
  );
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<{ message: string; conflict: boolean } | null>(
    null,
  );
  const [reloading, setReloading] = useState(false);

  const inputId = (f: PromotionField) => `${formId}-${f}`;
  const errId = (f: PromotionField) => `${formId}-${f}-err`;
  const set = (patch: Partial<PromotionFormValues>, field?: PromotionField) => {
    setValues((v) => ({ ...v, ...patch }));
    if (field) setErrors((prev) => ({ ...prev, [field]: undefined }));
    setServerError(null);
  };
  const focus = (field: PromotionField) =>
    formRef.current?.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus();
  const first = (e: Errors) => FIELD_ORDER.find((f) => e[f]);
  const invalid = (f: PromotionField) => (errors[f] ? true : undefined);
  const describedBy = (f: PromotionField) => (errors[f] ? errId(f) : undefined);
  const fieldError = (f: PromotionField) =>
    errors[f] ? (
      <span
        id={errId(f)}
        className="xs"
        role="alert"
        style={{ color: 'var(--bo-red-text)', fontWeight: 700 }}
      >
        {errors[f]}
      </span>
    ) : null;

  const fail = (error: unknown) => {
    const parsed = promotionServerError(error);
    if (parsed.field) setErrors({ [parsed.field]: parsed.message });
    setServerError({ message: parsed.message, conflict: parsed.kind === 'versionConflict' });
    if (parsed.reload && parsed.kind !== 'versionConflict') {
      void qc.invalidateQueries({ queryKey: queryKeys.backoffice.promotions });
    }
    if (parsed.field) focus(parsed.field);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const found: Errors = {};
    for (const f of validatePromotionForm(values)) found[f.field] ??= f.message;
    setErrors(found);
    setServerError(null);
    const firstField = first(found);
    if (firstField) {
      focus(firstField);
      return;
    }
    if (current) {
      const patch = toUpdateRequest(values, current);
      if (!patch) {
        toast.notify(tp('toast.noChanges'));
        onClose();
        return;
      }
      update.mutate(
        { id: current.id, input: patch },
        {
          onSuccess: () => {
            toast.notify(tp('toast.updated', { name: values.name.trim() }));
            onClose();
          },
          onError: fail,
        },
      );
      return;
    }
    create.mutate(toCreateRequest(values), {
      onSuccess: () => {
        toast.notify(tp('toast.created'));
        onClose();
      },
      onError: fail,
    });
  };

  const reload = async () => {
    setReloading(true);
    try {
      await onReload();
    } finally {
      setReloading(false);
    }
  };

  const isCoupon = values.code.trim() !== '';

  return (
    <Modal
      open
      zone="bo"
      size="wide"
      icon={<IconTag />}
      title={editing ? t('titleEdit') : t('title')}
      description={current?.name}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={pending}>
            {pending ? t('saving') : editing ? t('saveEdit') : t('save')}
          </button>
        </>
      }
    >
      <form id={formId} ref={formRef} noValidate onSubmit={submit} className="form-grid">
        <div className="field span-2">
          <label className="flabel" htmlFor={inputId('name')}>
            {t('name')}
          </label>
          <input
            id={inputId('name')}
            data-field="name"
            className="inp"
            type="text"
            autoComplete="off"
            placeholder={t('namePlaceholder')}
            aria-required="true"
            maxLength={PROMOTION_NAME_MAX * 2}
            value={values.name}
            onChange={(e) => set({ name: e.target.value }, 'name')}
            aria-invalid={invalid('name')}
            aria-describedby={describedBy('name')}
          />
          {fieldError('name')}
        </div>

        <div className="field span-2">
          <label className="flabel" htmlFor={inputId('description')}>
            {t('description')}
          </label>
          <textarea
            id={inputId('description')}
            data-field="description"
            className="inp"
            rows={2}
            value={values.description}
            onChange={(e) => set({ description: e.target.value }, 'description')}
            aria-invalid={invalid('description')}
            aria-describedby={describedBy('description')}
          />
          <span className="xs muted" style={{ fontWeight: 600 }}>
            {t('descriptionHint', { max: PROMOTION_DESCRIPTION_MAX })}
          </span>
          {fieldError('description')}
        </div>

        <div className="field span-2">
          <label className="flabel" htmlFor={inputId('code')}>
            {t('code')}
          </label>
          <input
            id={inputId('code')}
            data-field="code"
            className="inp"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            placeholder={t('codePlaceholder')}
            value={values.code}
            onChange={(e) => set({ code: e.target.value }, 'code')}
            aria-invalid={invalid('code')}
            aria-describedby={describedBy('code')}
          />
          <span className="xs muted" style={{ fontWeight: 600 }}>
            {isCoupon ? t('codeCoupon') : t('codeAuto')}
          </span>
          {fieldError('code')}
          {isCoupon ? (
            <Banner zone="bo" tone="warning" role="note" data-testid="coupon-public-warning">
              {t('codeCouponPublic')}
            </Banner>
          ) : null}
        </div>

        <div className="field span-2">
          <span className="flabel">{t('type')}</span>
          <SegmentedControl
            zone="bo"
            label={t('typeLabel')}
            value={values.kind}
            onChange={(kind) => set({ kind }, 'value')}
            options={PROMOTION_KINDS.map((k) => ({ value: k, label: tp(`kinds.${k}`) }))}
          />
        </div>

        <div className="field">
          <label className="flabel" htmlFor={inputId('value')}>
            {values.kind === 'PERCENT' ? t('valuePercent') : t('valueFixed')}
          </label>
          <input
            id={inputId('value')}
            data-field="value"
            className="inp"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-required="true"
            value={values.value}
            onChange={(e) => set({ value: e.target.value }, 'value')}
            aria-invalid={invalid('value')}
            aria-describedby={describedBy('value')}
          />
          {fieldError('value')}
        </div>

        <label className="row gap8" style={{ alignSelf: 'end' }}>
          <input
            type="checkbox"
            checked={values.dineInOnly}
            onChange={(e) => set({ dineInOnly: e.target.checked })}
          />
          <span className="sm" style={{ fontWeight: 700 }}>
            {t('dineIn')}
          </span>
        </label>

        <div className="field">
          <label className="flabel" htmlFor={inputId('startsAt')}>
            {t('startsAt')}
          </label>
          <input
            id={inputId('startsAt')}
            data-field="startsAt"
            className="inp"
            type="datetime-local"
            value={values.startsAt}
            onChange={(e) => set({ startsAt: e.target.value }, 'startsAt')}
            aria-invalid={invalid('startsAt')}
            aria-describedby={describedBy('startsAt')}
          />
          {fieldError('startsAt')}
        </div>
        <div className="field">
          <label className="flabel" htmlFor={inputId('endsAt')}>
            {t('endsAt')}
          </label>
          <input
            id={inputId('endsAt')}
            data-field="endsAt"
            className="inp"
            type="datetime-local"
            value={values.endsAt}
            onChange={(e) => set({ endsAt: e.target.value }, 'endsAt')}
            aria-invalid={invalid('endsAt')}
            aria-describedby={describedBy('endsAt')}
          />
          <span className="xs muted" style={{ fontWeight: 600 }}>
            {t('endsAtHint')}
          </span>
          {fieldError('endsAt')}
        </div>

        <BranchScopePicker
          scope={values.branchScope}
          branchIds={values.branchIds}
          allowAll={canAll}
          onChange={(branchScope, branchIds) => set({ branchScope, branchIds }, 'branches')}
          invalid={Boolean(errors.branches)}
          describedBy={describedBy('branches')}
        />
        {fieldError('branches')}

        <ProductScopePicker
          scope={values.productScope}
          products={values.products}
          onChange={(productScope, products) => set({ productScope, products }, 'products')}
          invalid={Boolean(errors.products)}
          describedBy={describedBy('products')}
        />
        {fieldError('products')}

        <PromotionScheduleEditor
          rows={values.slots}
          onChange={(slots) => set({ slots }, 'schedule')}
          invalid={Boolean(errors.schedule)}
          describedBy={describedBy('schedule')}
        />
        {fieldError('schedule')}

        <p className="xs muted span-2" style={{ margin: 0, fontWeight: 600 }}>
          {t('publicNote')}
        </p>
        {serverError ? (
          <Banner zone="bo" tone="alert" role="alert" className="span-2">
            {serverError.message}{' '}
            {serverError.conflict ? (
              <button
                type="button"
                className="link-btn"
                disabled={reloading}
                onClick={() => void reload()}
              >
                {t('reloadVersion')}
              </button>
            ) : null}
          </Banner>
        ) : null}
      </form>
    </Modal>
  );
}
