import type { BoNavIconKey } from '@/components/icons/bo';
import { canSee, type BackofficeScreen, type Grants } from '@/lib/permissions';

/** Ruta real de cada pantalla del backoffice. */
export const BACKOFFICE_BASE = '/backoffice';
export const LOGIN_PATH = `${BACKOFFICE_BASE}/login`;

export function screenHref(screen: BackofficeScreen): string {
  return `${BACKOFFICE_BASE}/${screen}`;
}

/** Pantalla activa a partir del pathname (`/backoffice/pedidos/...` → `pedidos`). */
export function screenFromPath(pathname: string | null): BackofficeScreen | null {
  const slug = pathname?.split('/')[2];
  return (ALL_SCREENS as readonly string[]).includes(slug ?? '')
    ? (slug as BackofficeScreen)
    : null;
}

export interface NavItemDef {
  screen: BackofficeScreen;
  icon: BoNavIconKey;
}
export interface NavSectionDef {
  key: 'operation' | 'catalog' | 'admin';
  items: readonly NavItemDef[];
}

/** NAV del prototipo: secciones Operación / Catálogo / Administración. */
export const NAV: readonly NavSectionDef[] = [
  {
    key: 'operation',
    items: [
      { screen: 'panel', icon: 'home' },
      { screen: 'pedidos', icon: 'bag' },
      { screen: 'entregas', icon: 'bike' },
      { screen: 'motoristas', icon: 'rider' },
    ],
  },
  {
    key: 'catalog',
    items: [
      { screen: 'productos', icon: 'fork' },
      { screen: 'categorias', icon: 'grid' },
      { screen: 'modificadores', icon: 'layers' },
      { screen: 'promociones', icon: 'tag' },
      { screen: 'banners', icon: 'image' },
    ],
  },
  {
    key: 'admin',
    items: [
      { screen: 'sucursales', icon: 'store' },
      { screen: 'usuarios', icon: 'users' },
      { screen: 'roles', icon: 'lock' },
      { screen: 'reportes', icon: 'chart' },
    ],
  },
];

const ALL_SCREENS = NAV.flatMap((s) => s.items.map((i) => i.screen));

/** Secciones visibles según los permisos (`grants`) del contexto administrativo (solo cosmético: la API decide). */
export function navForGrants(grants: Grants | null | undefined): NavSectionDef[] {
  return NAV.map((section) => ({
    ...section,
    items: section.items.filter((i) => canSee(grants, i.screen)),
  })).filter((section) => section.items.length > 0);
}
