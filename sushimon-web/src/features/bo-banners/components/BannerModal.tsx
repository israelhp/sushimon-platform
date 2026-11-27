'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { IconImage } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';
import { useShell } from '@/features/backoffice-shell/shell-context';
import { useAdminBanner, useCreateBanner, useUpdateBanner } from '@/features/banners/hooks';
import { queryKeys } from '@/features/query-keys';
import { BANNER_ALT_MAX } from '@/lib/banner-rules';
import { isApiError } from '@/lib/data-access/errors';
import type { AdminBanner } from '@/lib/data-access/models';
import {
  bannerServerError,
  bannerToForm,
  emptyBannerForm,
  toCreateRequest,
  toUpdateRequest,
  validateBannerForm,
  type BannerField,
  type BannerFormValues,
} from '../banners-view';
import { BannerImageField } from './BannerImageField';
import { BannerPreview } from './BannerPreview';

type Errors = Partial<Record<BannerField, string>>;

/**
 * Alta y edición de un banner (F16 simplificado): imagen + texto alternativo + activo. Al editar carga el detalle
 * (`GET /v1/admin/banners/{id}`: `version`) y envía solo lo que cambió con `expectedVersion`; un 409 de versión ofrece cargar la
 * versión actual sin pisar a nadie.
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
  const { grants } = useShell();
  const create = useCreateBanner();
  const update = useUpdateBanner();
  const editing = Boolean(current);
  const pending = create.isPending || update.isPending;
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  // Subir imagen = `catalog.update` con alcance global (F14; en v1 solo administración).
  const canUpload = Boolean(grants['catalog.update']?.allBranches);
  const [values, setValues] = useState<BannerFormValues>(() =>
    current ? bannerToForm(current) : emptyBannerForm(),
  );
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<{ message: string; conflict: boolean } | null>(
    null,
  );
  const [reloading, setReloading] = useState(false);

  const altId = `${formId}-alt`;
  const altErrId = `${formId}-alt-err`;
  const altHelpId = `${formId}-alt-help`;
  const imageErrId = `${formId}-image-err`;
  const set = (patch: Partial<BannerFormValues>, field?: BannerField) => {
    setValues((v) => ({ ...v, ...patch }));
    if (field) setErrors((prev) => ({ ...prev, [field]: undefined }));
    setServerError(null);
  };
  const focus = (field: BannerField) =>
    formRef.current?.querySelector<HTMLElement>(`[data-field="${field}"]`)?.focus();

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
    for (const p of validateBannerForm(values)) found[p.field] ??= t(`errors.${p.problem}`);
    setErrors(found);
    setServerError(null);
    const firstField: BannerField | undefined = found.image
      ? 'image'
      : found.imageAlt
        ? 'imageAlt'
        : undefined;
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
            toast.notify(tb('toast.updated'));
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

  const altLength = values.imageAlt.trim().length;

  return (
    <Modal
      open
      zone="bo"
      size="wide"
      icon={<IconImage />}
      title={editing ? t('titleEdit') : t('title')}
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

        <BannerImageField
          value={values.image}
          onChange={(image) => set({ image }, 'image')}
          canUpload={canUpload}
          invalid={Boolean(errors.image)}
          describedBy={errors.image ? imageErrId : undefined}
          disabled={pending}
        />
        {errors.image ? (
          <span
            id={imageErrId}
            className="xs span-2"
            role="alert"
            style={{ color: 'var(--bo-red-text)', fontWeight: 700 }}
          >
            {errors.image}
          </span>
        ) : null}

        <div className="field span-2">
          <label className="flabel" htmlFor={altId}>
            {t('imageAlt')} *
          </label>
          <input
            id={altId}
            data-field="imageAlt"
            className="inp"
            type="text"
            autoComplete="off"
            aria-required="true"
            maxLength={BANNER_ALT_MAX}
            value={values.imageAlt}
            onChange={(e) => set({ imageAlt: e.target.value }, 'imageAlt')}
            aria-invalid={errors.imageAlt || altLength > BANNER_ALT_MAX ? true : undefined}
            aria-describedby={errors.imageAlt ? `${altHelpId} ${altErrId}` : altHelpId}
          />
          <span id={altHelpId} className="xs muted" style={{ fontWeight: 600 }}>
            {t('imageAltHelp')}
          </span>
          <span
            className={altLength > BANNER_ALT_MAX ? 'xs' : 'xs muted'}
            aria-hidden="true"
            style={{
              fontWeight: 700,
              ...(altLength > BANNER_ALT_MAX ? { color: 'var(--bo-red-text)' } : {}),
            }}
          >
            {t('max', { count: altLength, max: BANNER_ALT_MAX })}
          </span>
          {errors.imageAlt ? (
            <span
              id={altErrId}
              className="xs"
              role="alert"
              style={{ color: 'var(--bo-red-text)', fontWeight: 700 }}
            >
              {errors.imageAlt}
            </span>
          ) : null}
        </div>

        <div className="field span-2">
          <div className="row gap8">
            <Switch
              zone="bo"
              checked={values.active}
              label={t('active')}
              disabled={pending}
              onCheckedChange={(active) => set({ active })}
            />
            <span className="sm" style={{ fontWeight: 700 }}>
              {values.active ? t('activeOn') : t('activeOff')}
            </span>
          </div>
        </div>

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
