/**
 * Arte de producto del backoffice (viewBox 200×200) extraído de la plantilla del prototipo (ADR-0007).
 * `variant="card"`: ilustración completa (tarjetas de producto y promociones).
 * `variant="thumb"`: versión simplificada (miniaturas de tabla y vista previa de foto).
 * Paleta `A`: tokens de ilustración (colores fijos, no cambian con el tema).
 */
import { cn } from '@/lib/cn';

const A = {
  ink: '#141414',
  rice: '#FAF8F0',
  salmon: '#F05249',
  leaf: '#7CC36A',
  egg: '#F2B33D',
  dough: '#F1E2C4',
  cheese: '#F2C14E',
  pink: '#F7A1A1',
  sky: '#068DDD',
  avocado: '#A8D58A',
  navy: '#2D408A',
} as const;

const CARD = {
  roll: (
    <>
      <path d="M24 46 L182 22" fill="none" strokeWidth={7} />
      <path d="M30 60 L186 44" fill="none" strokeWidth={7} />
      <circle cx="134" cy="96" r="44" fill={A.ink} />
      <circle cx="134" cy="96" r="31" fill={A.rice} />
      <circle cx="134" cy="96" r="13" fill={A.salmon} />
      <circle cx="70" cy="132" r="48" fill={A.ink} />
      <circle cx="70" cy="132" r="34" fill={A.rice} />
      <path d="M58 120 h22 v22 h-22 z" fill={A.salmon} />
      <circle cx="84" cy="142" r="7" fill={A.leaf} />
      <circle cx="56" cy="148" r="5" fill={A.egg} />
    </>
  ),
  dumpling: (
    <>
      <ellipse cx="100" cy="150" rx="86" ry="22" fill={A.rice} />
      <path d="M22 140 C 30 92, 92 80, 104 140 Z" fill={A.dough} />
      <path d="M80 136 C 90 70, 170 66, 178 136 Z" fill={A.rice} />
      <path d="M110 92 q8 12 2 26 M130 84 q8 14 2 30 M152 90 q8 12 2 26" fill="none" />
      <path d="M40 116 q6 8 2 18 M58 104 q6 10 2 22" fill="none" />
    </>
  ),
  soup: (
    <>
      <path
        d="M76 62 q-10 -12 0 -24 q10 -12 0 -24 M104 62 q-10 -12 0 -24 q10 -12 0 -24 M132 62 q-10 -12 0 -24"
        fill="none"
      />
      <path d="M150 30 L110 104 M170 38 L124 108" fill="none" />
      <path d="M24 96 H176 C176 148 144 174 100 174 C56 174 24 148 24 96 Z" fill={A.salmon} />
      <ellipse cx="100" cy="96" rx="76" ry="14" fill={A.cheese} />
      <circle cx="80" cy="94" r="9" fill={A.rice} />
      <circle cx="112" cy="96" r="9" fill={A.rice} />
      <path d="M60 134 h80" fill="none" strokeWidth={4} stroke={A.rice} />
    </>
  ),
  drink: (
    <>
      <path d="M122 14 L104 92" fill="none" strokeWidth={10} stroke={A.salmon} />
      <path d="M58 52 H142 L132 174 H68 Z" fill={A.rice} />
      <path d="M62 80 H138 L132 174 H68 Z" fill={A.pink} />
      <path d="M62 80 q10 10 19 0 q10 10 19 0 q10 10 19 0 q10 10 19 0" fill="none" />
      <circle cx="146" cy="60" r="16" fill={A.leaf} />
    </>
  ),
  dessert: (
    <>
      <circle cx="100" cy="72" r="28" fill={A.rice} />
      <circle cx="72" cy="100" r="28" fill={A.avocado} />
      <circle cx="128" cy="100" r="28" fill={A.pink} />
      <path d="M150 40 L120 104" fill="none" strokeWidth={9} stroke={A.sky} />
      <path d="M42 112 H158 L142 172 H58 Z" fill={A.navy} />
      <path d="M56 132 H144" fill="none" strokeWidth={4} stroke={A.rice} />
    </>
  ),
};

const THUMB = {
  roll: (
    <>
      <circle cx="134" cy="96" r="44" fill={A.ink} />
      <circle cx="134" cy="96" r="31" fill={A.rice} />
      <circle cx="134" cy="96" r="13" fill={A.salmon} />
      <circle cx="70" cy="132" r="48" fill={A.ink} />
      <circle cx="70" cy="132" r="34" fill={A.rice} />
      <path d="M58 120 h22 v22 h-22 z" fill={A.salmon} />
    </>
  ),
  dumpling: (
    <>
      <ellipse cx="100" cy="150" rx="86" ry="22" fill={A.rice} />
      <path d="M22 140 C 30 92, 92 80, 104 140 Z" fill={A.dough} />
      <path d="M80 136 C 90 70, 170 66, 178 136 Z" fill={A.rice} />
    </>
  ),
  soup: (
    <>
      <path d="M24 96 H176 C176 148 144 174 100 174 C56 174 24 148 24 96 Z" fill={A.salmon} />
      <ellipse cx="100" cy="96" rx="76" ry="14" fill={A.cheese} />
    </>
  ),
  drink: (
    <>
      <path d="M58 52 H142 L132 174 H68 Z" fill={A.rice} />
      <path d="M62 80 H138 L132 174 H68 Z" fill={A.pink} />
    </>
  ),
  dessert: (
    <>
      <circle cx="72" cy="100" r="28" fill={A.avocado} />
      <circle cx="128" cy="100" r="28" fill={A.pink} />
      <path d="M42 112 H158 L142 172 H58 Z" fill={A.navy} />
    </>
  ),
};

export type BoProductArtKind = keyof typeof CARD;

export interface BoProductArtProps {
  kind: BoProductArtKind;
  variant?: 'card' | 'thumb';
  /** Grosor del trazo base (la vista previa de foto del prototipo usa 6 en la variante thumb). */
  strokeWidth?: number;
  className?: string;
}

export function BoProductArt({
  kind,
  variant = 'card',
  strokeWidth,
  className,
}: BoProductArtProps) {
  const card = variant === 'card';
  return (
    <svg
      viewBox="0 0 200 200"
      className={cn('art', className)}
      aria-hidden="true"
      focusable="false"
    >
      <g
        stroke={A.ink}
        strokeWidth={strokeWidth ?? (card ? 6 : 7)}
        strokeLinejoin="round"
        strokeLinecap={card ? 'round' : undefined}
      >
        {(card ? CARD : THUMB)[kind]}
      </g>
    </svg>
  );
}
