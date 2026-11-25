'use client';

import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { BANNER_HEIGHT_CLASSES, BannerSlide } from '@/features/home/components/banner-slide';
import { cn } from '@/lib/cn';
import { previewBanner, type BannerFormValues } from '../banners-view';

type Device = 'desktop' | 'mobile' | 'mobileSmall';

/**
 * Previsualización SIN publicar (F16 simplificado): el MISMO componente `BannerSlide` que usa la tienda, con la imagen elegida
 * recortada como se verá en el carrusel (escritorio ≈ 240 px de alto; móvil ≈ 176 px, ancho 360 o 320). No llama a la API ni
 * cambia nada publicado.
 */
export function BannerPreview({ values }: { values: BannerFormValues }) {
  const t = useTranslations('backoffice.banners.preview');
  const titleId = useId();
  const [device, setDevice] = useState<Device>('desktop');
  const banner = previewBanner(values);

  return (
    <section className="field span-2" aria-labelledby={titleId}>
      <h3 className="flabel" id={titleId}>
        {t('title')}
      </h3>
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
      </div>
      {banner ? (
        <div
          data-testid="banner-preview"
          data-device={device}
          // Contenido inerte: es una vista previa, no un banner publicado.
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
          <BannerSlide banner={banner} eager imageSrc={values.image?.previewSrc ?? undefined} />
        </div>
      ) : (
        <p className="sm muted" role="status">
          {t('incomplete')}
        </p>
      )}
      <span className="xs muted" style={{ fontWeight: 600 }}>
        {t('note')}
      </span>
    </section>
  );
}
