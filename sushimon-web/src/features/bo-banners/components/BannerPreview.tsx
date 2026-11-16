'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { BANNER_HEIGHT_CLASSES, BannerSlide } from '@/features/home/components/banner-slide';
import { cn } from '@/lib/cn';
import type { BannerLocale } from '@/lib/data-access/models';
import { previewBanner, type BannerFormValues } from '../banners-view';

type Device = 'desktop' | 'mobile' | 'mobileSmall';

/**
 * Previsualización SIN publicar (F16): el MISMO componente `BannerSlide` que usa la tienda, con la imagen elegida, en el idioma
 * pedido (con el respaldo por campo a español resaltado) y en las dos alturas (escritorio ≈ 240 px; móvil ≈ 176 px, ancho 360). No
 * llama a la API ni cambia nada publicado.
 */
export function BannerPreview({ values }: { values: BannerFormValues }) {
  const t = useTranslations('backoffice.banners.preview');
  const tf = useTranslations('backoffice.banners.fields');
  const tg = useTranslations('home');
  const [locale, setLocale] = useState<BannerLocale>('es');
  const [device, setDevice] = useState<Device>('desktop');
  const banner = previewBanner(values, locale);

  return (
    <section className="field span-2" aria-label={t('title')}>
      <span className="flabel">{t('title')}</span>
      <div className="row gap8" style={{ flexWrap: 'wrap' }}>
        <SegmentedControl
          zone="bo"
          label={t('device')}
          value={device}
          onChange={setDevice}
          options={[
            { value: 'desktop', label: t('desktop') },
            { value: 'mobile', label: t('mobile') },
            { value: 'mobileSmall', label: t('mobileSmall') },
          ]}
        />
        <SegmentedControl
          zone="bo"
          label={t('language')}
          value={locale}
          onChange={setLocale}
          options={[
            { value: 'es', label: 'ES' },
            { value: 'en', label: 'EN' },
          ]}
        />
      </div>
      {banner ? (
        <div
          data-testid="banner-preview"
          data-device={device}
          // Contenido inerte: es una vista previa, no un banner publicado (sin foco ni clic en el CTA).
          inert
          className={cn(
            'overflow-hidden rounded-3xl',
            device === 'mobile'
              ? 'h-[176px] w-[360px] max-w-full'
              : device === 'mobileSmall'
                ? 'h-[176px] w-[320px] max-w-full'
                : cn('w-full', BANNER_HEIGHT_CLASSES),
          )}
        >
          <BannerSlide
            banner={banner}
            locale={locale}
            eager
            imageSrc={values.image?.previewSrc ?? undefined}
            markFallback
            ctaSlot={
              values.ctaType === 'NONE' ? null : (
                <span className="btn mt-1 !min-h-[40px] self-start !border-transparent !bg-white !px-4 text-sm !text-[rgb(var(--on-band-amber))]">
                  <span
                    lang={
                      locale === 'en' && banner.fallbackFields.includes('ctaLabel')
                        ? 'es'
                        : undefined
                    }
                  >
                    {banner.ctaLabel ?? tg('banner.cta')}
                  </span>
                </span>
              )
            }
          />
        </div>
      ) : (
        <p className="sm muted" role="status">
          {t('incomplete')}
        </p>
      )}
      {banner && banner.fallbackFields.length > 0 ? (
        <p className="xs muted" role="status" style={{ fontWeight: 600 }}>
          {t('fallback', {
            fields: banner.fallbackFields.map((f) => tf(`fallback.${f}`)).join(', '),
          })}
        </p>
      ) : null}
      <span className="xs muted" style={{ fontWeight: 600 }}>
        {t('note')}
      </span>
    </section>
  );
}
