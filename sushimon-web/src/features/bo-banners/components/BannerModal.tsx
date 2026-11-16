'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { IconImage } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { useAdminBanner, useCreateBanner, useUpdateBanner } from '@/features/banners/hooks';
import { BranchScopePicker } from '@/features/bo-catalog/components/PromotionScopePickers';
import { useAdminCategories } from '@/features/categories/hooks';
import { useAdminProducts } from '@/features/products/hooks';
import { useAdminPromotions } from '@/features/promotions/hooks';
import { queryKeys } from '@/features/query-keys';
import {
  BANNER_ALT_MAX,
  BANNER_CTA_LABEL_MAX,
  BANNER_SORT_MAX,
  BANNER_SUBTITLE_MAX,
  BANNER_TITLE_MAX,
} from '@/lib/banner-rules';
import { isApiError } from '@/lib/data-access/errors';
import type { AdminBanner } from '@/lib/data-access/models';
import {
  BANNER_CTA_OPTIONS,
  BANNER_PAGE_OPTIONS,
  bannerServerError,
  bannerToForm,
  emptyBannerForm,
  toCreateRequest,
  toUpdateRequest,
  validateBannerForm,
  type BannerField,
  type BannerFormValues,
  type TextValues,
} from '../banners-view';
import { BannerImageField } from './BannerImageField';
import { BannerPreview } from './BannerPreview';

const FIELD_ORDER: readonly BannerField[] = [
  'code',
  'image',
  'esTitle',
  'esSubtitle',
  'esCtaLabel',
  'esImageAlt',
  'enTitle',
  'enSubtitle',
  'enCtaLabel',
  'enImageAlt',
  'cta',
  'startsAt',
  'endsAt',
  'branches',
  'promotion',
  'sortOrder',
];

type Errors = Partial<Record<BannerField, string>>;

/**
 * Alta y edición de un banner (F16). Al editar carga el detalle (`GET /v1/admin/banners/{id}`: `version` y ambas traducciones sin
 * respaldo) y envía solo lo que cambió con `expectedVersion`; un 409 de versión ofrece cargar la versión actual sin pisar a nadie.
 */
export function BannerModal({
  bannerId,
  onClose,
}: {
  /** Banner a editar; sin él, alta. */
  bannerId?: string;
  onClose: () => void;
}) {
  const t = useTranslations('backoffice.banners.form');
  const tu = useTranslations('ui');
  const detail = useAdminBanner(bannerId ?? null);
  const [generation, setGeneration] = useState(0);

  if (bannerId && !detail.data) {
    const gone = detail.isError && isApiError(detail.error) && detail.error.status === 404;
    return (
      <Modal
        open
        zone="bo"
        size="wide"
        icon={<IconImage />}
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
    <BannerForm
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

/** Sección del formulario con título (`h3`) y nombre accesible. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="span-2 form-grid" aria-labelledby={id}>
      <h3
        id={id}
        className="span-2"
        style={{
          margin: '8px 0 0',
          paddingTop: 8,
          borderTop: '1px solid var(--bo-line)',
          fontSize: 14,
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '.04em',
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function BannerForm({
  current,
  onReload,
  onClose,
}: {
  current?: AdminBanner;
  onReload: () => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('backoffice.banners.form');
  const tb = useTranslations('backoffice.banners');
  const toast = useToast();
  const qc = useQueryClient();
  const { grants, can } = useShell();
  const create = useCreateBanner();
  const update = useUpdateBanner();
  const editing = Boolean(current);
  const pending = create.isPending || update.isPending;
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  const canAll = Boolean(grants[editing ? 'banners.update' : 'banners.create']?.allBranches);
  // Subir imagen = `catalog.update` con alcance global (F14; en v1 solo administración, P18).
  const canUpload = Boolean(grants['catalog.update']?.allBranches);
  const [values, setValues] = useState<BannerFormValues>(() =>
    current ? bannerToForm(current) : emptyBannerForm(canAll),
  );
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<{ message: string; conflict: boolean } | null>(
    null,
  );
  const [reloading, setReloading] = useState(false);

  const categories = useAdminCategories({ active: true });
  const products = useAdminProducts({ active: true, sort: 'name', order: 'asc', pageSize: 100 });
  const promotions = useAdminPromotions({ sort: 'name', order: 'asc', pageSize: 100 });

  const inputId = (f: string) => `${formId}-${f}`;
  const errId = (f: BannerField) => `${formId}-${f}-err`;
  const set = (patch: Partial<BannerFormValues>, field?: BannerField) => {
    setValues((v) => ({ ...v, ...patch }));
    if (field) setErrors((prev) => ({ ...prev, [field]: undefined }));
    setServerError(null);
  };
  const setText = (lang: 'es' | 'en', key: keyof TextValues, text: string, field: BannerField) =>
    set({ [lang]: { ...values[lang], [key]: text } } as Partial<BannerFormValues>, field);
  const focus = (field: BannerField) =>
    formRef.current?.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus();
  const first = (e: Errors) => FIELD_ORDER.find((f) => e[f]);
  const invalid = (f: BannerField) => (errors[f] ? true : undefined);
  const describedBy = (f: BannerField) => (errors[f] ? errId(f) : undefined);
  const fieldError = (f: BannerField) =>
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
    const parsed = bannerServerError(error);
    if (parsed.field) setErrors({ [parsed.field]: parsed.message });
    setServerError({ message: parsed.message, conflict: parsed.kind === 'versionConflict' });
    if (parsed.reload && parsed.kind !== 'versionConflict') {
      void qc.invalidateQueries({ queryKey: queryKeys.backoffice.banners });
    }
    if (parsed.field) focus(parsed.field);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const found: Errors = {};
    for (const f of validateBannerForm(values, editing)) found[f.field] ??= f.message;
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
        toast.notify(tb('toast.noChanges'));
        onClose();
        return;
      }
      update.mutate(
        { id: current.id, input: patch },
        {
          onSuccess: () => {
            toast.notify(tb('toast.updated', { name: values.es.title.trim() }));
            onClose();
          },
          onError: fail,
        },
      );
      return;
    }
    create.mutate(toCreateRequest(values), {
      onSuccess: () => {
        toast.notify(tb('toast.created'));
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

  const textField = (
    lang: 'es' | 'en',
    key: keyof TextValues,
    field: BannerField,
    max: number,
    opts: { required?: boolean; rows?: number } = {},
  ) => (
    <div className="field">
      <label className="flabel" htmlFor={inputId(field)}>
        {t(`texts.${key}`)}
        {opts.required ? ' *' : ''}
      </label>
      {opts.rows ? (
        <textarea
          id={inputId(field)}
          data-field={field}
          className="inp"
          rows={opts.rows}
          lang={lang}
          aria-required={opts.required ? 'true' : undefined}
          value={values[lang][key]}
          onChange={(e) => setText(lang, key, e.target.value, field)}
          aria-invalid={invalid(field)}
          aria-describedby={describedBy(field)}
        />
      ) : (
        <input
          id={inputId(field)}
          data-field={field}
          className="inp"
          type="text"
          lang={lang}
          autoComplete="off"
          aria-required={opts.required ? 'true' : undefined}
          maxLength={max * 2}
          value={values[lang][key]}
          onChange={(e) => setText(lang, key, e.target.value, field)}
          aria-invalid={invalid(field)}
          aria-describedby={describedBy(field)}
        />
      )}
      <span className="xs muted" style={{ fontWeight: 600 }}>
        {t('max', { count: values[lang][key].trim().length, max })}
      </span>
      {fieldError(field)}
    </div>
  );

  const productItems = products.data?.items ?? [];
  const categoryItems = categories.data?.items ?? [];
  const promotionItems = promotions.data?.items ?? [];
  const canReadPromotions = can('promotions.read');

  return (
    <Modal
      open
      zone="bo"
      size="wide"
      icon={<IconImage />}
      title={editing ? t('titleEdit') : t('title')}
      description={current?.title}
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
        <p className="xs muted span-2" style={{ margin: 0, fontWeight: 600 }}>
          {t('publishDelay')}
        </p>

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
            autoCapitalize="none"
            placeholder={t('codePlaceholder')}
            aria-required={editing ? undefined : 'true'}
            readOnly={editing}
            disabled={editing}
            value={values.code}
            onChange={(e) => set({ code: e.target.value }, 'code')}
            aria-invalid={invalid('code')}
            aria-describedby={describedBy('code')}
          />
          <span className="xs muted" style={{ fontWeight: 600 }}>
            {editing ? t('codeLocked') : t('codeHint')}
          </span>
          {fieldError('code')}
        </div>

        <Section title={t('sections.image')}>
          <BannerImageField
            value={values.image}
            onChange={(image) => set({ image }, 'image')}
            canUpload={canUpload}
            invalid={Boolean(errors.image)}
            describedBy={describedBy('image')}
          />
          {fieldError('image')}
        </Section>

        <Section title={t('sections.texts')}>
          <fieldset className="field span-2" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="flabel">{t('spanish')}</legend>
            <div className="form-grid">
              <div className="span-2">
                {textField('es', 'title', 'esTitle', BANNER_TITLE_MAX, { required: true })}
              </div>
              <div className="span-2">
                {textField('es', 'subtitle', 'esSubtitle', BANNER_SUBTITLE_MAX)}
              </div>
              {textField('es', 'ctaLabel', 'esCtaLabel', BANNER_CTA_LABEL_MAX)}
              {textField('es', 'imageAlt', 'esImageAlt', BANNER_ALT_MAX, { required: true })}
            </div>
          </fieldset>

          <fieldset className="field span-2" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="flabel">{t('english')}</legend>
            <span className="xs muted" style={{ fontWeight: 600 }}>
              {t('englishHint')}
            </span>
            <div className="form-grid">
              <div className="span-2">{textField('en', 'title', 'enTitle', BANNER_TITLE_MAX)}</div>
              <div className="span-2">
                {textField('en', 'subtitle', 'enSubtitle', BANNER_SUBTITLE_MAX)}
              </div>
              {textField('en', 'ctaLabel', 'enCtaLabel', BANNER_CTA_LABEL_MAX)}
              {textField('en', 'imageAlt', 'enImageAlt', BANNER_ALT_MAX)}
            </div>
          </fieldset>
        </Section>

        <Section title={t('sections.target')}>
          <div className="field span-2">
            <label className="flabel" htmlFor={inputId('ctaType')}>
              {t('cta')}
            </label>
            <select
              id={inputId('ctaType')}
              data-field="cta"
              className="inp"
              value={values.ctaType}
              onChange={(e) =>
                set(
                  {
                    ctaType: e.target.value as BannerFormValues['ctaType'],
                    categoryId: '',
                    productId: '',
                    page: '',
                  },
                  'cta',
                )
              }
              aria-invalid={invalid('cta')}
              aria-describedby={describedBy('cta')}
            >
              {BANNER_CTA_OPTIONS.map((type) => (
                <option key={type} value={type}>
                  {t(`ctaTypes.${type}`)}
                </option>
              ))}
            </select>
            {values.ctaType === 'CATEGORY' ? (
              <select
                aria-label={t('ctaCategory')}
                className="inp"
                value={values.categoryId}
                onChange={(e) => set({ categoryId: e.target.value }, 'cta')}
                aria-invalid={invalid('cta')}
                aria-describedby={describedBy('cta')}
              >
                <option value="">{t('ctaCategoryPlaceholder')}</option>
                {categoryItems.map((c) => (
                  <option key={c.id} value={c.id}>
                    {`${'— '.repeat(c.depth - 1)}${c.name}`}
                  </option>
                ))}
              </select>
            ) : null}
            {values.ctaType === 'PRODUCT' ? (
              <select
                aria-label={t('ctaProduct')}
                className="inp"
                value={values.productId}
                onChange={(e) => set({ productId: e.target.value }, 'cta')}
                aria-invalid={invalid('cta')}
                aria-describedby={describedBy('cta')}
              >
                <option value="">{t('ctaProductPlaceholder')}</option>
                {productItems.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            ) : null}
            {values.ctaType === 'PAGE' ? (
              <select
                aria-label={t('ctaPage')}
                className="inp"
                value={values.page}
                onChange={(e) => set({ page: e.target.value as BannerFormValues['page'] }, 'cta')}
                aria-invalid={invalid('cta')}
                aria-describedby={describedBy('cta')}
              >
                <option value="">{t('ctaPagePlaceholder')}</option>
                {BANNER_PAGE_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {t(`ctaPages.${p}`)}
                  </option>
                ))}
              </select>
            ) : null}
            <span className="xs muted" style={{ fontWeight: 600 }}>
              {t('ctaHint')}
            </span>
            {fieldError('cta')}
          </div>
        </Section>

        <Section title={t('sections.scope')}>
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
            <span className="xs muted" style={{ fontWeight: 600 }}>
              {t('startsAtHint')}
            </span>
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

          <div className="field span-2">
            <label className="flabel" htmlFor={inputId('promotion')}>
              {t('promotion')}
            </label>
            <select
              id={inputId('promotion')}
              data-field="promotion"
              className="inp"
              value={values.promotionId}
              disabled={!canReadPromotions && values.promotionId === ''}
              onChange={(e) => set({ promotionId: e.target.value }, 'promotion')}
              aria-invalid={invalid('promotion')}
              aria-describedby={describedBy('promotion')}
            >
              <option value="">{t('promotionNone')}</option>
              {current?.promotion && !promotionItems.some((p) => p.id === current.promotion?.id) ? (
                <option value={current.promotion.id}>{current.promotion.name}</option>
              ) : null}
              {promotionItems.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span className="xs muted" style={{ fontWeight: 600 }}>
              {t('promotionHint')}
            </span>
            {fieldError('promotion')}
            <Banner zone="bo" tone="warning" role="note" data-testid="coupon-text-warning">
              {t('couponWarning')}
            </Banner>
          </div>

          <div className="field">
            <label className="flabel" htmlFor={inputId('sortOrder')}>
              {t('sortOrder')}
            </label>
            <input
              id={inputId('sortOrder')}
              data-field="sortOrder"
              className="inp"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder={editing ? undefined : t('sortOrderAuto')}
              value={values.sortOrder}
              onChange={(e) => set({ sortOrder: e.target.value }, 'sortOrder')}
              aria-invalid={invalid('sortOrder')}
              aria-describedby={describedBy('sortOrder')}
            />
            <span className="xs muted" style={{ fontWeight: 600 }}>
              {t('sortOrderHint', { max: BANNER_SORT_MAX })}
            </span>
            {fieldError('sortOrder')}
          </div>

          {editing ? null : (
            <label className="row gap8" style={{ alignSelf: 'end' }}>
              <input
                type="checkbox"
                checked={values.active}
                onChange={(e) => set({ active: e.target.checked })}
              />
              <span className="sm" style={{ fontWeight: 700 }}>
                {t('active')}
              </span>
            </label>
          )}
        </Section>

        <BannerPreview values={values} />

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
