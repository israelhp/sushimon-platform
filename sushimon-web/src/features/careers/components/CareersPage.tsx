'use client';

import { CircleCheck, FileCheck, FileUp, LoaderCircle, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useRef, useState, type FormEvent } from 'react';
import { SimulationBadge } from '@/components/ui/SimulationBadge';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { Field } from '@/features/account/components/Field';
import { useSubmitJobApplication } from '../hooks';
import {
  APPLICATION_FIELD_ORDER,
  EMPTY_APPLICATION,
  EXPERIENCE_OPTIONS,
  POSITION_IDS,
  checkCv,
  toApplicationRequest,
  validateApplication,
  type ApplicationErrors,
  type ApplicationField,
  type ApplicationValues,
} from '../validation';

const CULTURE_TONES = [
  'bg-primary text-onprimary',
  'bg-secondary text-onsecondary',
  'bg-accent text-[rgb(var(--on-band-amber))]',
  'bg-deep text-ondeep',
];

/** Datos de prueba del botón "Usar datos de prueba" (solo demostración). */
const DEMO_VALUES: ApplicationValues = {
  name: 'Ana López',
  email: 'ana.lopez@ejemplo.com',
  phone: '5555-6789',
  position: 'mesero',
  experience: 'y1to3',
  message: '',
  consent: true,
};

const FIELD_ID: Record<ApplicationField, string> = {
  name: 'j-name',
  email: 'j-email',
  phone: 'j-phone',
  position: 'j-pos',
  experience: 'j-exp',
  cv: 'j-cv',
  consent: 'j-consent',
};

function demoCv(): File {
  const pdf = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n%%EOF';
  return new File([pdf], 'CV-Ana-Lopez.pdf', { type: 'application/pdf' });
}

/**
 * "Trabaja con nosotros": portada, cultura, vacantes y formulario de postulación. La subida del CV está
 * SIMULADA (no se envía ningún archivo: solo nombre y tamaño; la carga real llegará con almacenamiento
 * firmado). La validación es accesible: mensajes enlazados con `aria-describedby`, resumen de errores y
 * foco en el primer campo inválido.
 */
export function CareersPage() {
  const t = useTranslations('careers');
  const tCheckout = useTranslations('checkout');
  const tv = useTranslations();
  const { notify } = useToast();
  const submit = useSubmitJobApplication();
  const formRef = useRef<HTMLElement>(null);
  const [values, setValues] = useState<ApplicationValues>(EMPTY_APPLICATION);
  const [cv, setCv] = useState<File | null>(null);
  const [errors, setErrors] = useState<ApplicationErrors>({});
  const [sent, setSent] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [failed, setFailed] = useState(false);

  const culture = t.raw('culture') as { t: string; d: string }[];
  const errorText = (field: ApplicationField) => {
    const key = errors[field];
    return key ? t(`errors.${key}`) : undefined;
  };
  const failedFields = APPLICATION_FIELD_ORDER.filter((f) => errors[f]);

  const change = (patch: Partial<ApplicationValues>) => {
    setValues((v) => ({ ...v, ...patch }));
    setErrors((e) => {
      const next = { ...e };
      for (const key of Object.keys(patch) as ApplicationField[]) delete next[key];
      return next;
    });
  };

  const pickCv = (file: File | undefined) => {
    if (!file) {
      setCv(null);
      return;
    }
    const problem = checkCv(file);
    if (problem) {
      setCv(null);
      setErrors((e) => ({ ...e, cv: problem }));
      return;
    }
    setCv(file);
    setErrors((e) => ({ ...e, cv: undefined }));
  };

  const apply = (id: string) => {
    change({ position: id });
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    formRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFailed(false);
    setAttempted(true);
    const found = validateApplication(values, cv);
    setErrors(found);
    const first = APPLICATION_FIELD_ORDER.find((f) => found[f]);
    if (first || !cv) {
      notify(t('fixFields'));
      // El foco va al primer campo inválido en el siguiente frame, salvo que el usuario ya lo haya
      // movido (p. ej. con un enlace del resumen de errores): un frame tardío no debe quitárselo.
      const focusAtSubmit = document.activeElement;
      requestAnimationFrame(() => {
        if (document.activeElement !== focusAtSubmit) return;
        document.getElementById(FIELD_ID[first ?? 'cv'])?.focus();
      });
      return;
    }
    submit.mutate(toApplicationRequest(values, cv), {
      onSuccess: () => {
        setSent(true);
        requestAnimationFrame(() => document.getElementById('j-success')?.focus());
      },
      onError: () => setFailed(true),
    });
  };

  const fillDemo = () => {
    setValues({ ...DEMO_VALUES, message: t('demoMessage') });
    setCv(demoCv());
    setErrors({});
    notify(t('demoFilled'));
  };

  return (
    <>
      <section className="seigaiha seigaiha-ink relative overflow-hidden py-16 md:py-20">
        <span
          className="pointer-events-none absolute -right-6 bottom-[-30px] font-jp text-[160px] leading-none text-white/[0.06] sm:text-[260px]"
          aria-hidden="true"
        >
          仲間
        </span>
        <div className="wrap relative">
          <p className="eyebrow text-accent">
            {t('eyebrow')}{' '}
            <span className="ml-2 font-jp tracking-[0.2em]" lang="ja">
              仲間募集
            </span>
          </p>
          <h1 className="disp mt-3.5 max-w-[14ch] text-[clamp(36px,7.4vw,100px)]">
            {t('heroA')}
            <span className="text-red-500">{t('heroB')}</span>
          </h1>
          <p className="my-6 text-[22px] text-white/90">{t('heroSub')}</p>
          <a className="btn btn-primary" href="#vacantes">
            {t('seeJobs')}
          </a>
        </div>
      </section>

      <section className="py-14 md:py-20">
        <div className="wrap">
          <h2 className="disp mb-8 text-[clamp(34px,5vw,60px)]">{t('team')}</h2>
          <div className="grid gap-[18px] sm:grid-cols-2 lg:grid-cols-4">
            {culture.map((item, index) => (
              <div
                key={item.t}
                className={cn(
                  CULTURE_TONES[index % CULTURE_TONES.length],
                  'flex flex-col gap-3 rounded-[20px] p-6 shadow-card',
                )}
              >
                <h3 className="disp text-xl">{item.t}</h3>
                <p className="m-0 leading-relaxed">{item.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="vacantes" className="scroll-mt-24 pb-14 md:pb-20">
        <div className="wrap">
          <h2 className="disp text-[clamp(34px,5vw,60px)]">{t('jobs')}</h2>
          <p className="mb-8 mt-2.5 text-[17px] text-muted">{t('jobsSub')}</p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {POSITION_IDS.map((id) => (
              <div
                key={id}
                className="flex flex-col gap-2.5 rounded-[20px] border border-line bg-surface p-[22px] shadow-card"
              >
                <span className="self-start rounded-full bg-secondary-soft px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide text-secondary">
                  {t('hiring')}
                </span>
                <h3 className="m-0 text-[21px] font-extrabold">{t(`positions.${id}.title`)}</h3>
                <p className="m-0 text-[15px] leading-snug text-muted">
                  {t(`positions.${id}.area`)}
                </p>
                <ul className="m-0 flex flex-1 list-none flex-col gap-1 p-0 text-[13px] text-muted">
                  <li>
                    <strong className="text-fg">{t('shift')}</strong> {t(`positions.${id}.shift`)}
                  </li>
                  <li>
                    <strong className="text-fg">{t('req')}</strong> {t(`positions.${id}.req`)}
                  </li>
                </ul>
                <button
                  type="button"
                  className="btn mt-1.5 !min-h-[46px]"
                  aria-label={`${t('applyBtn')}: ${t(`positions.${id}.title`)}`}
                  onClick={() => apply(id)}
                >
                  {t('applyBtn')}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section ref={formRef} id="postular" className="scroll-mt-24 pb-20">
        <div className="wrap min-w-0 max-w-[860px]">
          {sent ? (
            <div className="panel" role="status">
              <div
                id="j-success"
                tabIndex={-1}
                className="notice notice-info outline-none"
                aria-live="polite"
              >
                <CircleCheck className="mt-0.5 h-[18px] w-[18px] flex-none" aria-hidden="true" />
                <div>
                  <span className="font-extrabold">{t('received')}</span> {t('receivedMsg')}
                </div>
              </div>
              <Link href="/" className="btn btn-dark w-full no-underline">
                {tv('common.backHome')}
              </Link>
            </div>
          ) : (
            <form className="panel" onSubmit={onSubmit} noValidate aria-describedby="j-summary">
              <div>
                <p className="eyebrow text-secondary">{t('formEyebrow')}</p>
                <h2 className="disp mt-2 text-[clamp(28px,3.4vw,38px)]">{t('formTitle')}</h2>
              </div>

              <button
                type="button"
                onClick={fillDemo}
                className="inline-flex min-h-[44px] items-center gap-2 self-start rounded-full border border-dashed border-accent bg-accent-soft px-4 text-sm font-extrabold text-fg"
              >
                <Sparkles className="h-4 w-4" aria-hidden="true" /> {t('demoFill')}
              </button>

              <div id="j-summary">
                {attempted && failedFields.length > 0 ? (
                  <div role="alert" className="notice notice-warn">
                    <div>
                      <p className="m-0 font-extrabold">{t('fixFields')}</p>
                      <ul className="m-0 mt-1 list-disc pl-5">
                        {failedFields.map((field) => (
                          <li key={field}>
                            <a
                              href={`#${FIELD_ID[field]}`}
                              className="underline"
                              onClick={(e) => {
                                e.preventDefault();
                                document.getElementById(FIELD_ID[field])?.focus();
                              }}
                            >
                              {errorText(field)}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
                <Field id="j-name" label={t('name')} error={errorText('name')}>
                  {(props) => (
                    <input
                      {...props}
                      type="text"
                      autoComplete="off"
                      value={values.name}
                      onChange={(e) => change({ name: e.target.value })}
                    />
                  )}
                </Field>
                <Field id="j-email" label={t('email')} error={errorText('email')}>
                  {(props) => (
                    <input
                      {...props}
                      type="text"
                      inputMode="email"
                      autoComplete="off"
                      placeholder="cliente@ejemplo.com"
                      value={values.email}
                      onChange={(e) => change({ email: e.target.value })}
                    />
                  )}
                </Field>
                <Field id="j-phone" label={t('phone')} error={errorText('phone')}>
                  {(props) => (
                    <input
                      {...props}
                      type="tel"
                      inputMode="tel"
                      autoComplete="off"
                      placeholder={tCheckout('phonePh')}
                      value={values.phone}
                      onChange={(e) => change({ phone: e.target.value })}
                    />
                  )}
                </Field>
                <Field id="j-pos" label={t('position')} error={errorText('position')}>
                  {(props) => (
                    <select
                      {...props}
                      value={values.position}
                      onChange={(e) => change({ position: e.target.value })}
                    >
                      <option value="">{t('positionPh')}</option>
                      {POSITION_IDS.map((id) => (
                        <option key={id} value={id}>
                          {t(`positions.${id}.title`)}
                        </option>
                      ))}
                      <option value="other">{t('other')}</option>
                    </select>
                  )}
                </Field>
                <Field
                  id="j-exp"
                  label={t('experience')}
                  error={errorText('experience')}
                  className="sm:col-span-2"
                >
                  {(props) => (
                    <select
                      {...props}
                      value={values.experience}
                      onChange={(e) => change({ experience: e.target.value })}
                    >
                      <option value="">{t('experiencePh')}</option>
                      {EXPERIENCE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {t(`expOptions.${option}`)}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field id="j-msg" label={t('message')} className="sm:col-span-2">
                  {(props) => (
                    <textarea
                      {...props}
                      className="input min-h-[88px] resize-y"
                      placeholder={t('messagePh')}
                      value={values.message}
                      onChange={(e) => change({ message: e.target.value })}
                    />
                  )}
                </Field>

                <div className="sm:col-span-2">
                  <span className="lbl flex flex-wrap items-center gap-2">
                    {t('cv')} <SimulationBadge />
                  </span>
                  <label
                    htmlFor="j-cv"
                    className={cn(
                      'flex min-h-[72px] cursor-pointer items-center gap-3 rounded-[14px] border-2 border-dashed p-3.5 transition hover:bg-subtle focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-secondary',
                      errors.cv
                        ? 'border-danger bg-danger-soft'
                        : cv
                          ? 'border-success bg-success-soft'
                          : 'border-line bg-surface',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-11 w-11 flex-none items-center justify-center rounded-xl text-ondeep',
                        cv ? 'bg-success' : 'bg-primary',
                      )}
                    >
                      {cv ? (
                        <FileCheck className="h-5 w-5" aria-hidden="true" />
                      ) : (
                        <FileUp className="h-5 w-5" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-[15px]">
                        {cv ? cv.name : t('cvTap')}
                      </strong>
                      <span className="block text-[13px] text-muted">
                        {cv ? t('cvReady') : t('cvHint')}
                      </span>
                    </span>
                    <input
                      id="j-cv"
                      type="file"
                      accept="application/pdf,.pdf"
                      aria-invalid={!!errors.cv}
                      aria-describedby={
                        errors.cv ? 'j-cv-help j-cv-sim j-cv-error' : 'j-cv-help j-cv-sim'
                      }
                      className="sr-only"
                      onChange={(e) => pickCv(e.target.files?.[0])}
                    />
                  </label>
                  <p id="j-cv-help" className="mt-1.5 text-[13px] text-muted">
                    {t('cvPrivacy')}
                  </p>
                  <p id="j-cv-sim" className="mt-1 text-[13px] text-muted">
                    {t('cvSimulated')}
                  </p>
                  {errors.cv ? (
                    <p id="j-cv-error" className="err">
                      {errorText('cv')}
                    </p>
                  ) : null}
                </div>

                <div className="sm:col-span-2">
                  <label className="flex items-start gap-3 text-[15px] leading-snug">
                    <input
                      id="j-consent"
                      type="checkbox"
                      className="mt-0.5 h-[22px] w-[22px] flex-none accent-[rgb(var(--secondary))]"
                      checked={values.consent}
                      aria-invalid={!!errors.consent}
                      aria-describedby={errors.consent ? 'j-consent-error' : undefined}
                      onChange={(e) => change({ consent: e.target.checked })}
                    />
                    <span>{t('consent')}</span>
                  </label>
                  {errors.consent ? (
                    <p id="j-consent-error" className="err">
                      {errorText('consent')}
                    </p>
                  ) : null}
                </div>
              </div>

              {failed ? (
                <div role="alert" className="notice notice-warn">
                  {t('submitError')}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={submit.isPending}
                aria-busy={submit.isPending}
                className="btn btn-dark w-full"
              >
                {submit.isPending ? (
                  <LoaderCircle className="anim-spin h-5 w-5" aria-hidden="true" />
                ) : null}
                {submit.isPending ? t('submitting') : t('submit')}
              </button>
            </form>
          )}
        </div>
      </section>
    </>
  );
}
