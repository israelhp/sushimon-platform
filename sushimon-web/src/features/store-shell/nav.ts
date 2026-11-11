import { Ellipsis, House, ShoppingBag, Tag, UtensilsCrossed, type LucideIcon } from 'lucide-react';

/** Rutas reales de la tienda (la URL cambia; el prototipo usaba MemoryRouter). */
export const STORE_ROUTES = {
  home: '/',
  menu: '/menu',
  promos: '/promociones',
  checkout: '/checkout',
  more: '/mas',
  account: '/cuenta',
  track: '/consultar',
  incidents: '/incidencias',
  careers: '/trabaja-con-nosotros',
} as const;

export interface PrimaryNavItem {
  href: string;
  /** Clave de `nav.*`. */
  label: 'home' | 'menu' | 'promos';
  Icon: LucideIcon;
  /** Activo solo con la ruta exacta. */
  exact?: boolean;
}

/** Enlaces principales (Pedido abre el carrito y Más agrupa el resto: ver `isMoreActive`). */
export const PRIMARY_NAV: readonly PrimaryNavItem[] = [
  { href: STORE_ROUTES.home, label: 'home', Icon: House, exact: true },
  { href: STORE_ROUTES.menu, label: 'menu', Icon: UtensilsCrossed },
  { href: STORE_ROUTES.promos, label: 'promos', Icon: Tag },
];

export const ORDER_ICON = ShoppingBag;
export const MORE_ICON = Ellipsis;

/** Rutas que se resaltan bajo "Más". */
const MORE_PREFIXES = [
  '/mas',
  '/trabaja-con-nosotros',
  '/cuenta',
  '/mis-pedidos',
  '/pedidos',
  '/consultar',
  '/incidencias',
];

export function isRouteActive(pathname: string, item: Pick<PrimaryNavItem, 'href' | 'exact'>) {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}

export function isMoreActive(pathname: string): boolean {
  return MORE_PREFIXES.some((p) => pathname.startsWith(p));
}
