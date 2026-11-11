'use client';

import { useTranslations } from 'next-intl';
import { useId, useRef, useState, type FormEvent } from 'react';
import { IconTag } from '@/components/icons/bo';
import { Banner } from '@/components/ui/Banner';
import { Modal } from '@/components/ui/Modal';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { useToast } from '@/components/ui/Toast';
import { useSavePromotion } from '@/features/backoffice/hooks';
import { useNow } from '@/features/backoffice-shell/use-now';
import { errorMessage } from '@/features/bo-orders/error-message';
import { cn } from '@/lib/cn';
import { addDaysISO, localDate } from '@/lib/time';
import {
  ISO_DAYS,
  PROMOTION_KINDS,
  emptyPromotionForm,
  promotionInput,
  validatePromotionForm,
  type PromotionField,
  type PromotionFormError,
  type PromotionFormValues,
} from '../catalog-view';

/** Modal "Nueva promoción": tipo, valor, días, horas y vigencia, con validación accesible. */
export function PromotionModal({ onClose }: { onClose: () => void }) {
  const t = useTranslations('backoffice.promotions.form');
  const tp = useTranslations('backoffice.promotions');
  const toast = useToast();
  const save = useSavePromotion();
  const now = useNow();
  const ids = useId();

  const [values, setValues] = useState<PromotionFormValues>(() => {
    const today = now ? localDate(now) : '';
    return emptyPromotionForm(today, today ? addDaysISO(today, 30) : '');
  });
  const [errors, setErrors] = useState<PromotionFormError[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);

  const nameRef = useRef<HTMLInputElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);
  const daysRef = useRef<HTMLButtonElement>(null);
  const startRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLInputElement>(null);
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const focusField = (field: PromotionField) =>
    ({
      name: nameRef,
      value: valueRef,
      days: daysRef,
      start: startRef,
      end: endRef,
      from: fromRef,
      to: toRef,
    })[field].current?.focus();

  const patch = (change: Partial<PromotionFormValues>) => {
    setValues((v) => ({ ...v, ...change }));
    setErrors([]);
    setServerError(null);
  };
  const invalid = (field: PromotionField) => errors.some((e) => e.field === field);
  const bannerId = `${ids}-error`;
  const describe = (field: PromotionField) => (invalid(field) ? bannerId : undefined);
  const firstError = errors[0];
  const message = firstError ? t(`errors.${firstError.code}`) : serverError;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = validatePromotionForm(values);
    setErrors(found);
    setServerError(null);
    if (found[0]) {
      focusField(found[0].field);
      return;
    }
    try {
      await save.mutateAsync({ input: promotionInput(values) });
      toast.notify(tp('toast.created'));
      onClose();
    } catch (error) {
      setServerError(errorMessage(error));
    }
  };

  const toggleDay = (day: number) =>
    patch({
      days: values.days.includes(day)
        ? values.days.filter((d) => d !== day)
        : [...values.days, day],
    });

  return (
    <Modal
      open
      zone="bo"
      size="wide"
      icon={<IconTag />}
      title={t('title')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            {t('cancel')}
          </button>
          <button
            type="submit"
            form={`${ids}-form`}
            className="btn btn-primary"
            disabled={save.isPending}
          >
            {save.isPending ? t('saving') : t('save')}
          </button>
        </>
      }
    >
      <form id={`${ids}-form`} noValidate onSubmit={submit} style={{ display: 'contents' }}>
        <div className="form-grid">
          <label className="field span-2">
            <span className="flabel">{t('name')}</span>
            <input
              ref={nameRef}
              className="inp"
              placeholder={t('namePlaceholder')}
              value={values.name}
              aria-required="true"
              aria-invalid={invalid('name')}
              aria-describedby={describe('name')}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </label>
          <div className="field span-2">
            <span className="flabel">{t('type')}</span>
            <SegmentedControl
              zone="bo"
              label={t('typeLabel')}
              value={values.kind}
              onChange={(kind) => patch({ kind })}
              options={PROMOTION_KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) }))}
            />
          </div>
          {values.kind !== '2x1' ? (
            <label className="field">
              <span className="flabel">
                {values.kind === 'percent' ? t('valuePercent') : t('valuePrice')}
              </span>
              <input
                ref={valueRef}
                className="inp"
                type="number"
                min="0"
                inputMode="decimal"
                value={values.value}
                aria-required="true"
                aria-invalid={invalid('value')}
                aria-describedby={describe('value')}
                onChange={(e) => patch({ value: e.target.value })}
              />
            </label>
          ) : null}
          <div className="field span-2">
            <span className="flabel" id={`${ids}-days`}>
              {t('days')}
            </span>
            <div className="row gap6 wrap" role="group" aria-labelledby={`${ids}-days`}>
              {ISO_DAYS.map((d, i) => {
                const on = values.days.includes(d);
                return (
                  <button
                    key={d}
                    ref={i === 0 ? daysRef : undefined}
                    type="button"
                    className={cn('dayb', on && 'on')}
                    aria-pressed={on}
                    aria-label={tp(`days.${d}.full`)}
                    aria-describedby={describe('days')}
                    onClick={() => toggleDay(d)}
                  >
                    {tp(`days.${d}.short`)}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="field">
            <span className="flabel">{t('start')}</span>
            <input
              ref={startRef}
              className="inp"
              type="time"
              value={values.start}
              aria-invalid={invalid('start')}
              aria-describedby={describe('start')}
              onChange={(e) => patch({ start: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="flabel">{t('end')}</span>
            <input
              ref={endRef}
              className="inp"
              type="time"
              value={values.end}
              aria-invalid={invalid('end')}
              aria-describedby={describe('end')}
              onChange={(e) => patch({ end: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="flabel">{t('from')}</span>
            <input
              ref={fromRef}
              className="inp"
              type="date"
              value={values.from}
              aria-invalid={invalid('from')}
              aria-describedby={describe('from')}
              onChange={(e) => patch({ from: e.target.value })}
            />
          </label>
          <label className="field">
            <span className="flabel">{t('to')}</span>
            <input
              ref={toRef}
              className="inp"
              type="date"
              value={values.to}
              aria-invalid={invalid('to')}
              aria-describedby={describe('to')}
              onChange={(e) => patch({ to: e.target.value })}
            />
          </label>
        </div>
        {message ? (
          <Banner zone="bo" tone="alert" role="alert" id={bannerId} icon={null}>
            {message}
          </Banner>
        ) : null}
      </form>
    </Modal>
  );
}
