'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { displayMediaSrc } from '@/lib/media-simulated';

/**
 * Miniatura de una imagen del backoffice (alt = texto alternativo; vacío = decorativa). Una URL simulada (`*.invalid`) sin bytes
 * en memoria NO se pide por red: muestra un recuadro rotulado. Ante un fallo de carga muestra el mismo recuadro (sin reintentos).
 */
export function MediaThumb({
  url,
  alt = '',
  src: preview,
  size = 64,
  fill = false,
}: {
  url?: string | null;
  alt?: string;
  /** Vista previa local (`blob:` de un archivo elegido); tiene prioridad. */
  src?: string | null;
  size?: number;
  /** Llena su contenedor (tarjetas de la lista) en vez de una caja de `size` px. */
  fill?: boolean;
}) {
  const t = useTranslations('backoffice.media');
  const src = preview ?? displayMediaSrc(url);
  const [failed, setFailed] = useState<string | null>(null);
  const box: React.CSSProperties = {
    width: fill ? '100%' : size,
    height: fill ? '100%' : size,
    flex: 'none',
    overflow: 'hidden',
    border: fill ? 0 : '1px solid var(--bo-line)',
    borderRadius: fill ? 0 : 10,
    background: 'var(--bo-surface-2)',
  };
  if (src && failed !== src) {
    return (
      <span style={{ ...box, display: 'inline-block' }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- miniatura del backoffice (blob: local o URL https del CDN) */}
        <img
          src={src}
          alt={alt}
          width={size}
          height={size}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(src)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={alt || t('thumbSimulated')}
      title={t('thumbSimulated')}
      className="xs muted"
      style={{
        ...box,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        fontSize: 10,
        padding: 4,
      }}
    >
      {t('thumbSimulated')}
    </span>
  );
}
