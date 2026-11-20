/**
 * Íconos del backoffice (trazo 24×24) extraídos de la plantilla del prototipo (ADR-0007).
 * Por defecto heredan `currentColor`; dentro de [data-zone="bo"] la clase `.ic` (y `.ic.sm`) fija tamaño y trazo
 * como en el prototipo. Son decorativos (aria-hidden): el control que los contiene debe tener su etiqueta.
 */
import type { ReactNode, SVGProps } from 'react';
import { cn } from '@/lib/cn';

export interface BoIconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** `sm` = 16 px (clase `.ic.sm`); por defecto 18 px. */
  size?: 'md' | 'sm';
}

function make(name: string, body: ReactNode) {
  function Icon({ size = 'md', className, ...rest }: BoIconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size === 'sm' ? 16 : 18}
        height={size === 'sm' ? 16 : 18}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.1}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className={cn('ic', size === 'sm' && 'sm', className)}
        {...rest}
      >
        {body}
      </svg>
    );
  }
  Icon.displayName = `BoIcon${name}`;
  return Icon;
}

export const IconLock = make(
  'Lock',
  <>
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </>,
);

export const IconSun = make(
  'Sun',
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </>,
);

export const IconMoon = make(
  'Moon',
  <>
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </>,
);

export const IconMapPin = make(
  'MapPin',
  <>
    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
    <circle cx="12" cy="10" r="3" />
  </>,
);

export const IconChevronDown = make(
  'ChevronDown',
  <>
    <path d="m6 9 6 6 6-6" />
  </>,
);

export const IconHome = make(
  'Home',
  <>
    <path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" />
    <path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </>,
);

export const IconBag = make(
  'Bag',
  <>
    <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
    <path d="M3 6h18M16 10a4 4 0 0 1-8 0" />
  </>,
);

export const IconBike = make(
  'Bike',
  <>
    <circle cx="18.5" cy="17.5" r="3.5" />
    <circle cx="5.5" cy="17.5" r="3.5" />
    <circle cx="15" cy="5" r="1" />
    <path d="M12 17.5V14l-3-3 4-3 2 3h2" />
  </>,
);

export const IconFork = make(
  'Fork',
  <>
    <path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8" />
    <path d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7M2.1 21.8l6.4-6.3M19 5l-7 7" />
  </>,
);

export const IconGrid = make(
  'Grid',
  <>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
  </>,
);

/** F12: capas apiladas (extras / modificadores). */
export const IconLayers = make(
  'Layers',
  <>
    <path d="m12 2 9 5-9 5-9-5 9-5Z" />
    <path d="m3 12 9 5 9-5" />
    <path d="m3 17 9 5 9-5" />
  </>,
);

export const IconTag = make(
  'Tag',
  <>
    <path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z" />
    <circle cx="7.5" cy="7.5" r="1" />
  </>,
);

export const IconImage = make(
  'Image',
  <>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
  </>,
);

export const IconStore = make(
  'Store',
  <>
    <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    <path d="M2 7h20v3a2 2 0 0 1-2 2 2.7 2.7 0 0 1-2-1 2.7 2.7 0 0 1-4 0 2.7 2.7 0 0 1-4 0 2.7 2.7 0 0 1-4 0 2.7 2.7 0 0 1-2 1 2 2 0 0 1-2-2z" />
  </>,
);

export const IconUsers = make(
  'Users',
  <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </>,
);

export const IconChart = make(
  'Chart',
  <>
    <path d="M3 3v18h18" />
    <path d="M18 17V9M13 17V5M8 17v-3" />
  </>,
);

export const IconLogOut = make(
  'LogOut',
  <>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </>,
);

export const IconMenu = make(
  'Menu',
  <>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </>,
);

export const IconCalendar = make(
  'Calendar',
  <>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </>,
);

export const IconVolume = make(
  'Volume',
  <>
    <path d="M11 5 6 9H2v6h4l5 4z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
  </>,
);

export const IconZap = make(
  'Zap',
  <>
    <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
  </>,
);

export const IconBell = make(
  'Bell',
  <>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </>,
);

export const IconArrowRight = make(
  'ArrowRight',
  <>
    <path d="M5 12h14M12 5l7 7-7 7" />
  </>,
);

export const IconEye = make(
  'Eye',
  <>
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </>,
);

export const IconAlert = make(
  'Alert',
  <>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
    <path d="M12 9v4M12 17h.01" />
  </>,
);

export const IconCheck = make(
  'Check',
  <>
    <path d="M20 6 9 17l-5-5" />
  </>,
);

export const IconSearch = make(
  'Search',
  <>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </>,
);

export const IconHistory = make(
  'History',
  <>
    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5M12 7v5l4 2" />
  </>,
);

export const IconDownload = make(
  'Download',
  <>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </>,
);

export const IconInfo = make(
  'Info',
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 16v-4M12 8h.01" />
  </>,
);

export const IconPlus = make(
  'Plus',
  <>
    <path d="M12 5v14M5 12h14" />
  </>,
);

export const IconPencil = make(
  'Pencil',
  <>
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </>,
);

export const IconGrip = make(
  'Grip',
  <>
    <circle cx="9" cy="6" r="1" />
    <circle cx="15" cy="6" r="1" />
    <circle cx="9" cy="12" r="1" />
    <circle cx="15" cy="12" r="1" />
    <circle cx="9" cy="18" r="1" />
    <circle cx="15" cy="18" r="1" />
  </>,
);

export const IconChevronUp = make(
  'ChevronUp',
  <>
    <path d="m6 15 6-6 6 6" />
  </>,
);

export const IconClock = make(
  'Clock',
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </>,
);

export const IconChevronLeft = make(
  'ChevronLeft',
  <>
    <path d="m15 18-6-6 6-6" />
  </>,
);

export const IconChevronRight = make(
  'ChevronRight',
  <>
    <path d="m9 18 6-6-6-6" />
  </>,
);

export const IconClose = make(
  'Close',
  <>
    <path d="M18 6 6 18M6 6l12 12" />
  </>,
);

export const IconPhone = make(
  'Phone',
  <>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </>,
);

export const IconFileText = make(
  'FileText',
  <>
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <path d="M14 2v6h6M16 13H8M16 17H8" />
  </>,
);

export const IconCheckBold = make(
  'CheckBold',
  <>
    <path d="m5 12 5 5 9-10" />
  </>,
);

export const IconShop = make(
  'Shop',
  <>
    <path d="m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7" />
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
  </>,
);

export const IconUserPlus = make(
  'UserPlus',
  <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M19 8v6M22 11h-6" />
  </>,
);

/** Motorista (casco): sección «Motoristas» del backoffice (F27). */
export const IconRider = make(
  'Rider',
  <>
    <path d="M4 14a8 8 0 0 1 16 0v1H4z" />
    <path d="M4 15v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" />
    <path d="M12 6v4h8" />
  </>,
);

/** Mapa de íconos de navegación del sidebar (claves del prototipo: it.ic.*). */
export const BO_NAV_ICONS = {
  home: IconHome,
  bag: IconBag,
  bike: IconBike,
  rider: IconRider,
  fork: IconFork,
  grid: IconGrid,
  tag: IconTag,
  image: IconImage,
  layers: IconLayers,
  store: IconStore,
  users: IconUsers,
  chart: IconChart,
  lock: IconLock,
} as const;
export type BoNavIconKey = keyof typeof BO_NAV_ICONS;
