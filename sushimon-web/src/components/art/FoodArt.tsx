import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Ilustraciones planas de comida de la tienda (viewBox 200×200).
 * Trazados y paleta tomados del prototipo (ADR-0007: se reutilizan valores/SVG, se reescribe el código).
 * La paleta `A` son los tokens de ilustración: colores fijos que no cambian con el tema.
 */
const A = {
  ink: '#141414',
  rice: '#FAF8F0',
  salmon: '#E94A3F',
  leaf: '#7CC36A',
  egg: '#F2B33D',
  dough: '#F1E2C4',
  rib: '#B5532A',
  ribLight: '#C8642D',
  crisp: '#F2A65A',
  crispLight: '#F7B96B',
  navy: '#283479',
  crust: '#E89A4B',
  cheese: '#F2C14E',
  sky: '#068DDD',
  herb: '#5FB27A',
  wine: '#7A1E3A',
  wineLight: '#9E2A4C',
  avocado: '#A8D58A',
  ice: '#BFE3F8',
  pink: '#F7A1A1',
} as const;

const ART = {
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
  ribs: (
    <>
      <ellipse cx="100" cy="140" rx="86" ry="30" fill={A.rice} />
      <rect
        x="30"
        y="94"
        width="130"
        height="32"
        rx="16"
        fill={A.rib}
        transform="rotate(-14 95 110)"
      />
      <rect
        x="46"
        y="120"
        width="130"
        height="32"
        rx="16"
        fill={A.ribLight}
        transform="rotate(-6 111 136)"
      />
      <path d="M150 80 h22 M168 118 h20" fill="none" />
      <path
        d="M60 108 l10 -4 M90 102 l10 -4 M80 138 l10 -2 M112 134 l10 -2"
        fill="none"
        strokeWidth={4}
        stroke={A.rice}
      />
    </>
  ),
  popcorn: (
    <>
      <circle cx="72" cy="78" r="15" fill={A.crisp} />
      <circle cx="126" cy="76" r="15" fill={A.crisp} />
      <circle cx="100" cy="66" r="17" fill={A.crispLight} />
      <circle cx="56" cy="98" r="16" fill={A.crispLight} />
      <circle cx="86" cy="92" r="18" fill={A.crisp} />
      <circle cx="116" cy="94" r="17" fill={A.crispLight} />
      <circle cx="144" cy="98" r="16" fill={A.crisp} />
      <path d="M32 104 H168 C168 152 138 172 100 172 C62 172 32 152 32 104 Z" fill={A.navy} />
      <path d="M54 128 h92" fill="none" strokeWidth={4} stroke={A.rice} />
    </>
  ),
  pizza: (
    <>
      <circle cx="100" cy="104" r="76" fill={A.crust} />
      <circle cx="100" cy="104" r="60" fill={A.rice} />
      <rect x="66" y="70" width="26" height="18" rx="4" fill={A.salmon} />
      <rect x="110" y="68" width="26" height="18" rx="4" fill={A.salmon} />
      <rect x="74" y="120" width="26" height="18" rx="4" fill={A.salmon} />
      <rect x="114" y="116" width="26" height="18" rx="4" fill={A.salmon} />
      <circle cx="100" cy="102" r="8" fill={A.leaf} />
      <path d="M100 28 V180 M24 104 H176" fill="none" strokeWidth={4} />
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
  burger: (
    <>
      <path d="M36 100 C36 44 164 44 164 100 Z" fill={A.crust} />
      <path
        d="M30 112 q14 -14 28 0 q14 -14 28 0 q14 -14 28 0 q14 -14 28 0 q14 -14 28 0"
        fill={A.leaf}
      />
      <rect x="34" y="112" width="132" height="26" rx="10" fill={A.salmon} />
      <path
        d="M38 142 H162 V152 C162 164 152 170 140 170 H60 C48 170 38 164 38 152 Z"
        fill={A.crust}
      />
      <path
        d="M76 72 l6 -3 M100 64 l6 -2 M122 74 l6 -3 M90 86 l6 -2"
        fill="none"
        strokeWidth={5}
        stroke={A.rice}
      />
    </>
  ),
  sake: (
    <>
      <path
        d="M70 30 H96 V56 C122 72 130 116 124 150 C122 162 114 170 104 170 H62 C52 170 44 162 42 150 C36 116 44 72 70 56 Z"
        fill={A.rice}
      />
      <path d="M44 108 H122" fill="none" />
      <path d="M46 126 H120" fill="none" strokeWidth={10} stroke={A.navy} />
      <path d="M136 128 H184 L176 170 H144 Z" fill={A.rice} />
      <path d="M142 140 H178" fill="none" strokeWidth={5} stroke={A.navy} />
    </>
  ),
  beer: (
    <>
      <path
        d="M136 82 H156 C168 82 172 92 172 104 V124 C172 136 166 144 154 144 H134"
        fill="none"
      />
      <path d="M54 58 H138 L130 172 H62 Z" fill={A.egg} />
      <path
        d="M50 64 C46 44 70 36 82 46 C92 30 118 30 124 46 C138 38 154 50 144 66 Z"
        fill={A.rice}
      />
      <circle cx="84" cy="110" r="5" fill={A.rice} />
      <circle cx="104" cy="136" r="4" fill={A.rice} />
      <circle cx="110" cy="96" r="4" fill={A.rice} />
    </>
  ),
  soju: (
    <>
      <rect x="86" y="18" width="28" height="16" rx="3" fill={A.navy} />
      <path
        d="M88 34 H112 V62 C128 72 132 86 132 102 V160 C132 166 128 172 122 172 H78 C72 172 68 166 68 160 V102 C68 86 72 72 88 62 Z"
        fill={A.herb}
      />
      <rect x="74" y="104" width="52" height="40" rx="6" fill={A.rice} />
      <path d="M88 118 h24 M88 130 h16" fill="none" strokeWidth={4} />
    </>
  ),
  wine: (
    <>
      <path
        d="M64 14 H84 V64 C100 74 104 88 104 104 V164 C104 170 100 174 94 174 H54 C48 174 44 170 44 164 V104 C44 88 48 74 64 64 Z"
        fill={A.wine}
      />
      <rect x="50" y="110" width="48" height="38" rx="5" fill={A.rice} />
      <path d="M126 70 H178 C178 104 166 118 152 118 C138 118 126 104 126 70 Z" fill={A.rice} />
      <path
        d="M128 88 H176 C174 106 164 116 152 116 C140 116 130 106 128 88 Z"
        fill={A.wineLight}
      />
      <path d="M152 118 V164 M134 168 H170" fill="none" />
    </>
  ),
  shake: (
    <>
      <path d="M122 14 L104 92" fill="none" strokeWidth={10} stroke={A.salmon} />
      <path d="M58 52 H142 L132 174 H68 Z" fill={A.rice} />
      <path d="M62 80 H138 L132 174 H68 Z" fill={A.pink} />
      <path d="M62 80 q10 10 19 0 q10 10 19 0 q10 10 19 0 q10 10 19 0" fill="none" />
      <circle cx="146" cy="60" r="16" fill={A.leaf} />
    </>
  ),
  tea: (
    <>
      <path d="M80 62 q-10 -12 0 -24 q10 -12 0 -24 M112 62 q-10 -12 0 -24" fill="none" />
      <ellipse cx="96" cy="164" rx="80" ry="14" fill={A.rice} />
      <path d="M144 96 C172 96 172 136 140 136" fill="none" />
      <path d="M40 78 H152 V110 C152 140 128 160 96 160 C64 160 40 140 40 110 Z" fill={A.rice} />
      <path d="M44 92 H148" fill="none" strokeWidth={8} stroke={A.ribLight} />
      <path d="M120 80 V112" fill="none" strokeWidth={3} />
      <rect x="110" y="112" width="20" height="18" rx="2" fill={A.egg} />
    </>
  ),
  water: (
    <>
      <rect x="84" y="16" width="32" height="18" rx="4" fill={A.navy} />
      <path
        d="M86 34 H114 V48 C126 56 132 68 132 82 V164 C132 170 128 174 122 174 H78 C72 174 68 170 68 164 V82 C68 68 74 56 86 48 Z"
        fill={A.ice}
      />
      <rect x="68" y="104" width="64" height="34" fill={A.sky} />
      <path d="M80 154 h40" fill="none" strokeWidth={4} stroke={A.rice} />
    </>
  ),
  can: (
    <>
      <rect x="60" y="34" width="80" height="140" rx="16" fill={A.salmon} />
      <path d="M60 92 q20 -14 40 0 q20 14 40 0 V126 q-20 14 -40 0 q-20 -14 -40 0 Z" fill={A.rice} />
      <path d="M74 34 V26 H126 V34" fill="none" />
      <path d="M132 18 L120 62" fill="none" strokeWidth={9} stroke={A.sky} />
    </>
  ),
  icecream: (
    <>
      <circle cx="100" cy="72" r="28" fill={A.rice} />
      <circle cx="72" cy="100" r="28" fill={A.avocado} />
      <circle cx="128" cy="100" r="28" fill={A.pink} />
      <path d="M150 40 L120 104" fill="none" strokeWidth={9} stroke={A.sky} />
      <path d="M42 112 H158 L142 172 H58 Z" fill={A.navy} />
      <path d="M56 132 H144" fill="none" strokeWidth={4} stroke={A.rice} />
    </>
  ),
  fries: (
    <>
      <rect
        x="62"
        y="34"
        width="16"
        height="80"
        rx="3"
        fill={A.cheese}
        transform="rotate(-10 70 74)"
      />
      <rect x="86" y="24" width="16" height="90" rx="3" fill={A.cheese} />
      <rect
        x="110"
        y="30"
        width="16"
        height="84"
        rx="3"
        fill={A.cheese}
        transform="rotate(8 118 72)"
      />
      <rect
        x="128"
        y="44"
        width="16"
        height="70"
        rx="3"
        fill={A.cheese}
        transform="rotate(16 136 79)"
      />
      <path d="M46 92 H154 L142 174 H58 Z" fill={A.salmon} />
      <path d="M76 120 q24 18 48 0" fill="none" strokeWidth={6} stroke={A.rice} />
    </>
  ),
  avocado: (
    <>
      <ellipse cx="100" cy="146" rx="86" ry="26" fill={A.rice} />
      <path d="M30 140 C30 92 74 74 90 108 C96 122 86 142 30 140 Z" fill={A.crust} />
      <path d="M76 136 C76 84 124 66 140 104 C146 120 132 138 76 136 Z" fill={A.crust} />
      <path d="M90 128 C92 96 120 86 128 108 C132 120 122 128 90 128 Z" fill={A.avocado} />
      <path d="M120 138 C124 98 164 84 176 116 C180 128 170 140 120 138 Z" fill={A.crust} />
      <path d="M60 92 l4 -4 M110 70 l4 -4 M156 92 l4 -4" fill="none" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type FoodArtKind = keyof typeof ART;
export const FOOD_ART_KINDS = Object.keys(ART) as FoodArtKind[];

export interface FoodArtProps {
  kind: FoodArtKind;
  className?: string;
  /** Si hay foto del producto se muestra en lugar de la ilustración. */
  image?: string | null;
  /** Texto alternativo de la foto; la ilustración es decorativa. */
  alt?: string;
}

export function FoodArt({ kind, className, image, alt = '' }: FoodArtProps) {
  if (image) {
    // Fotos de catálogo de origen arbitrario: <img> simple como el prototipo (sin optimizador).
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={image}
        alt={alt}
        loading="lazy"
        className={cn('h-full w-full object-cover', className)}
      />
    );
  }
  return (
    <svg viewBox="0 0 200 200" className={className} aria-hidden="true" focusable="false">
      <g stroke={A.ink} strokeWidth={6} strokeLinejoin="round" strokeLinecap="round">
        {ART[kind] ?? ART.roll}
      </g>
    </svg>
  );
}
