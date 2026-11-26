import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { demoStaffFromSeed } from '../src/mocks/fixtures/staff';
import { CART_KEY, DUMPLINGS, cartV2, deliveryMode } from './support/cart';

/**
 * Accesibilidad automática (axe) por ruta y tema. Sin violaciones serias ni críticas.
 * Cada bloque de pantallas agrega aquí sus rutas (y, si hace falta, una `ready` para esperar sus datos).
 */
interface RouteCase {
  path: string;
  /** Texto accesible a esperar antes de analizar (la pantalla ya pintó sus datos). */
  ready: { role: 'heading' | 'button' | 'link'; name: string | RegExp };
  /** Abre antes la sesión de DEMOSTRACIÓN del cliente (sessionStorage); las rutas de cuenta la necesitan. */
  signedIn?: boolean;
  /** Abre antes la sesión de DEMOSTRACIÓN del personal del backoffice con ese rol (sessionStorage). */
  staff?: 'admin' | 'manager' | 'kitchen' | 'staff';
  /** Etiqueta para distinguir casos de la misma ruta (p. ej. pasos del checkout). */
  label?: string;
  /** Preferencias del cliente a precargar (carrito, modo de pedido…) en localStorage. */
  local?: Record<string, string>;
  /** Borrador a precargar en sessionStorage (p. ej. el paso del checkout). */
  session?: Record<string, string>;
  /** Acción previa al análisis (p. ej. abrir un modal); se ejecuta cuando la pantalla ya pintó. */
  step?: (page: Page) => Promise<void>;
}

/** Checkout (bloque 4): carrito con un producto, modo «a domicilio» y el paso pedido (borrador no sensible). */
const CHECKOUT_LOCAL = {
  [CART_KEY]: cartV2('sucursal-1', [DUMPLINGS]),
  'monsushi-order-mode-v1': deliveryMode('sucursal-1'),
};
const checkoutStep = (step: number) => ({
  'monsushi-checkout-v1': JSON.stringify({
    step,
    contact: { name: 'Cliente Demo', phone: '5555-1234', email: 'cliente@ejemplo.com' },
    address: {
      department: 'Guatemala',
      municipality: 'Guatemala',
      zone: '10',
      line: '6a avenida 10-50',
      references: '',
    },
    addressId: 'other',
    notes: '',
    deliveryBranchId: null,
  }),
});

export const A11Y_ROUTES: RouteCase[] = [
  // Cuenta, Más, empleo y 404 (bloque 6). Las de cuenta, con y sin sesión de demostración.
  { path: '/mas', ready: { role: 'heading', name: /^Más/ } },
  {
    path: '/mas',
    label: 'horario de sucursal',
    ready: { role: 'heading', name: /^Más/ },
    step: async (page) => {
      await page.getByRole('button', { name: 'Ver horario: Sucursal 1' }).click();
      await page.getByRole('region', { name: 'Horario de Sucursal 1' }).waitFor();
    },
  },
  { path: '/cuenta', ready: { role: 'heading', name: /Mi cuenta/ } },
  { path: '/cuenta', ready: { role: 'heading', name: /Mi cuenta/ }, signedIn: true },
  {
    path: '/cuenta/datos',
    ready: { role: 'heading', name: 'Mis datos personales' },
    signedIn: true,
  },
  {
    path: '/cuenta/direcciones',
    ready: { role: 'heading', name: 'Mis direcciones' },
    signedIn: true,
  },
  {
    path: '/cuenta/direcciones',
    label: 'modal dirección con zona requerida',
    ready: { role: 'heading', name: 'Mis direcciones' },
    signedIn: true,
    step: async (page) => {
      await page.getByRole('button', { name: 'Agregar dirección' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Nueva dirección' });
      await dialog.getByRole('button', { name: 'Guardar dirección' }).click();
      await dialog.getByText('Indicá la zona.').waitFor();
    },
  },
  { path: '/cuenta/favoritos', ready: { role: 'heading', name: 'Mis favoritos' }, signedIn: true },
  { path: '/cuenta/pedidos', ready: { role: 'heading', name: 'Mis pedidos' }, signedIn: true },
  { path: '/cuenta/direcciones', ready: { role: 'heading', name: 'Mis direcciones' } },
  { path: '/trabaja-con-nosotros', ready: { role: 'heading', name: /MONcheros/ } },
  { path: '/ruta-que-no-existe', ready: { role: 'heading', name: 'Este roll no existe' } },
  { path: '/', ready: { role: 'heading', name: /hambre/i } },
  // Consulta de invitado, reclamos y seguimiento (bloque 5). El seguimiento exige sesión: lo decide la API.
  { path: '/consultar', ready: { role: 'heading', name: /Consulta tu orden/ } },
  { path: '/incidencias', ready: { role: 'heading', name: /Hacer un reclamo/ } },
  {
    path: '/incidencias',
    label: 'con pedidos',
    ready: { role: 'heading', name: 'Tus últimos pedidos' },
    signedIn: true,
  },
  {
    path: '/incidencias/nuevo?pedido=MON-490217',
    ready: { role: 'heading', name: /Reportar un problema/ },
    signedIn: true,
  },
  {
    path: '/pedidos/MON-490217',
    ready: { role: 'heading', name: 'Seguimiento del pedido' },
    signedIn: true,
  },
  // Checkout (bloque 4): un caso por paso.
  {
    path: '/checkout',
    label: 'paso 1',
    ready: { role: 'heading', name: 'Tu pedido' },
    local: CHECKOUT_LOCAL,
  },
  {
    path: '/checkout',
    label: 'paso 2',
    ready: { role: 'heading', name: 'Entrega' },
    local: CHECKOUT_LOCAL,
    session: checkoutStep(2),
  },
  {
    path: '/checkout',
    label: 'paso 3',
    ready: { role: 'heading', name: 'Envío' },
    local: CHECKOUT_LOCAL,
    session: checkoutStep(3),
  },
  {
    path: '/checkout',
    label: 'paso 4',
    ready: { role: 'heading', name: 'Pago' },
    local: CHECKOUT_LOCAL,
    session: checkoutStep(4),
  },
  {
    path: '/checkout',
    label: 'paso 5',
    ready: { role: 'heading', name: 'Confirmación' },
    local: CHECKOUT_LOCAL,
    session: checkoutStep(5),
  },
  { path: '/menu', ready: { role: 'heading', name: /^Entradas/ } },
  { path: '/promociones', ready: { role: 'heading', name: /^Entradas/ } },
  // Backoffice, bloques 1–2 (acceso, Panel y Pedidos). Sesión de demostración del personal.
  { path: '/backoffice/login', ready: { role: 'heading', name: 'Iniciar sesión' } },
  {
    path: '/backoffice/panel',
    ready: { role: 'heading', name: /^Buenas tardes/ },
    staff: 'admin',
  },
  {
    path: '/backoffice/pedidos',
    ready: { role: 'heading', name: 'Pedidos' },
    staff: 'admin',
  },
  {
    path: '/backoffice/pedidos',
    label: 'cocina',
    ready: { role: 'heading', name: 'Pedidos' },
    staff: 'kitchen',
  },
  // Backoffice, bloque 3 (Entregas y modal Despachar; PedidosYa simulado).
  {
    path: '/backoffice/entregas',
    ready: { role: 'heading', name: 'Entregas' },
    staff: 'admin',
  },
  {
    // F22: el despacho simulado ya no se abre desde Pedidos (allí está deshabilitado); sigue en las alertas del Panel.
    path: '/backoffice/panel',
    label: 'encargado, modal Despachar',
    ready: { role: 'heading', name: /Buenas/ },
    staff: 'manager',
    step: async (page) => {
      await page
        .locator('.alert', { hasText: '#MON-307051' })
        .getByRole('button', { name: 'Despachar' })
        .click();
      await page.getByRole('dialog', { name: 'Despachar pedido' }).waitFor();
    },
  },
  // Backoffice, bloque 4 (Productos, Categorías y Promociones), con modales abiertos.
  { path: '/backoffice/productos', ready: { role: 'heading', name: 'Productos' }, staff: 'admin' },
  {
    path: '/backoffice/productos',
    label: 'encargado',
    ready: { role: 'heading', name: 'Productos' },
    staff: 'manager',
  },
  {
    path: '/backoffice/productos',
    label: 'tabla',
    ready: { role: 'heading', name: 'Productos' },
    staff: 'admin',
    step: async (page) => {
      await page.getByRole('button', { name: 'Tabla', exact: true }).click();
      await page.getByRole('table').waitFor();
    },
  },
  {
    path: '/backoffice/productos',
    label: 'modal producto',
    ready: { role: 'heading', name: 'Productos' },
    staff: 'admin',
    step: async (page) => {
      await page.getByRole('button', { name: 'Nuevo producto' }).click();
      await page.getByRole('dialog', { name: 'Nuevo producto' }).waitFor();
      await page.getByRole('button', { name: 'Guardar producto' }).click();
      await page.getByRole('dialog').getByRole('alert').first().waitFor();
    },
  },
  {
    path: '/backoffice/categorias',
    ready: { role: 'heading', name: 'Categorías' },
    staff: 'admin',
  },
  {
    path: '/backoffice/modificadores',
    ready: { role: 'heading', name: 'Extras' },
    staff: 'admin',
  },
  {
    path: '/backoffice/modificadores',
    label: 'modal grupo de extras',
    ready: { role: 'heading', name: 'Extras' },
    staff: 'admin',
    step: async (page) => {
      await page.getByRole('button', { name: 'Nuevo grupo' }).click();
      await page.getByRole('dialog', { name: 'Nuevo grupo de extras' }).waitFor();
      await page.getByRole('button', { name: 'Guardar grupo' }).click();
      await page.getByRole('dialog').getByRole('alert').first().waitFor();
    },
  },
  {
    path: '/backoffice/promociones',
    ready: { role: 'heading', name: 'Promociones' },
    staff: 'admin',
  },
  {
    path: '/backoffice/promociones',
    label: 'modal promoción',
    ready: { role: 'heading', name: 'Promociones' },
    staff: 'admin',
    step: async (page) => {
      await page.getByRole('button', { name: 'Nueva promoción' }).click();
      await page.getByRole('dialog', { name: 'Nueva promoción' }).waitFor();
      await page.getByRole('button', { name: 'Crear promoción' }).click();
      await page.getByRole('dialog').getByRole('alert').first().waitFor();
    },
  },
  {
    path: '/backoffice/promociones',
    label: 'modal editar promoción (horario, sucursales y productos)',
    ready: { role: 'heading', name: 'Promociones' },
    staff: 'admin',
    step: async (page) => {
      await page.getByRole('button', { name: 'Editar Happy Hour' }).click();
      const dialog = page.getByRole('dialog', { name: 'Editar promoción' });
      await dialog.getByRole('textbox', { name: 'Nombre' }).waitFor();
      await dialog.getByRole('button', { name: 'Elegir productos' }).click();
      await dialog.getByRole('button', { name: 'Añadir franja' }).click();
    },
  },
  {
    path: '/backoffice/sucursales',
    ready: { role: 'heading', name: 'Sucursales' },
    staff: 'admin',
  },
  // F08: editor de horario semanal y cierres extraordinarios.
  {
    path: '/backoffice/sucursales',
    label: 'modal horario semanal',
    ready: { role: 'heading', name: 'Sucursales' },
    staff: 'admin',
    step: async (page) => {
      await page.getByRole('button', { name: 'Horario y cierres de Sucursal 1' }).click();
      await page.getByRole('dialog', { name: 'Horario y cierres' }).waitFor();
      await page.getByLabel('Apertura del intervalo 1 de Lunes').waitFor();
    },
  },
  {
    path: '/backoffice/sucursales',
    label: 'horario con errores por intervalo',
    ready: { role: 'heading', name: 'Sucursales' },
    staff: 'admin',
    step: async (page) => {
      await page.getByRole('button', { name: 'Horario y cierres de Sucursal 1' }).click();
      const dialog = page.getByRole('dialog', { name: 'Horario y cierres' });
      await dialog.getByLabel('Apertura del intervalo 1 de Viernes').waitFor();
      await dialog.getByRole('button', { name: 'Agregar intervalo a Viernes' }).click();
      await dialog.getByLabel('Apertura del intervalo 2 de Viernes').fill('20:00');
      await dialog.getByLabel('Cierre del intervalo 2 de Viernes').fill('23:00');
      await dialog.getByRole('button', { name: 'Guardar horario' }).click();
      await dialog.getByText(/Se solapa con days\[4\]/).waitFor();
    },
  },
  {
    path: '/backoffice/sucursales',
    label: 'cierres extraordinarios',
    ready: { role: 'heading', name: 'Sucursales' },
    staff: 'admin',
    step: async (page) => {
      await page.getByRole('button', { name: 'Horario y cierres de Sucursal 1' }).click();
      const dialog = page.getByRole('dialog', { name: 'Horario y cierres' });
      await dialog.getByRole('tab', { name: 'Cierres' }).click();
      await dialog.getByText('Motivo: Mantenimiento de campana extractora').waitFor();
    },
  },
  {
    path: '/backoffice/sucursales',
    label: 'modal nuevo cierre con errores',
    ready: { role: 'heading', name: 'Sucursales' },
    staff: 'admin',
    step: async (page) => {
      await page.getByRole('button', { name: 'Horario y cierres de Sucursal 1' }).click();
      await page.getByRole('tab', { name: 'Cierres' }).click();
      await page.getByRole('button', { name: 'Nuevo cierre' }).click();
      await page.getByRole('dialog', { name: 'Nuevo cierre' }).waitFor();
      await page.getByRole('button', { name: 'Crear cierre' }).click();
      await page.getByRole('dialog', { name: 'Nuevo cierre' }).getByRole('alert').first().waitFor();
    },
  },
  {
    path: '/backoffice/sucursales',
    label: 'horario ocupado (BRANCH_SCHEDULE_BUSY)',
    ready: { role: 'heading', name: 'Sucursales' },
    staff: 'admin',
    step: async (page) => {
      await page.getByRole('button', { name: 'Horario y cierres de Sucursal 5' }).click();
      const dialog = page.getByRole('dialog', { name: 'Horario y cierres' });
      await dialog.getByRole('switch', { name: 'Atiende el día Lunes' }).click();
      await dialog.getByRole('button', { name: 'Guardar horario' }).click();
      await page
        .getByRole('dialog', { name: 'Guardar horario' })
        .getByRole('button', { name: 'Confirmar y guardar' })
        .click();
      await dialog.getByText(/Otra persona está guardando cambios/).waitFor();
    },
  },
  {
    path: '/backoffice/sucursales',
    label: 'cierre con inicio demasiado antiguo',
    ready: { role: 'heading', name: 'Sucursales' },
    staff: 'admin',
    step: async (page) => {
      await page.getByRole('button', { name: 'Horario y cierres de Sucursal 1' }).click();
      await page.getByRole('tab', { name: 'Cierres' }).click();
      await page.getByRole('button', { name: 'Nuevo cierre' }).click();
      const form = page.getByRole('dialog', { name: 'Nuevo cierre' });
      await form.getByLabel('Inicio (hora de Guatemala)').fill('2026-11-11T12:00');
      await form.getByLabel('Fin (hora de Guatemala, no incluido)').fill('2026-11-11T18:00');
      await form.getByRole('button', { name: 'Crear cierre' }).click();
      await form.getByText('El inicio no puede ser anterior a una hora atrás.').waitFor();
    },
  },
  {
    path: '/backoffice/sucursales',
    label: 'sucursal sin permiso de edición (encargado)',
    ready: { role: 'heading', name: 'Sucursales' },
    staff: 'manager',
    step: async (page) => {
      await page.getByRole('button', { name: 'Horario y cierres de Sucursal 1' }).click();
      await page.getByText(/Solo lectura: no tienes permiso para modificar horarios/).waitFor();
    },
  },
  // F09: entrega por sucursal (proveedores y zonas propias) y cobertura en la hoja de pedido.
  {
    path: '/backoffice/sucursales',
    label: 'entrega y zonas: proveedores',
    ready: { role: 'heading', name: 'Sucursales' },
    staff: 'admin',
    step: async (page) => {
      await page.getByRole('button', { name: 'Entrega y zonas de Sucursal 1' }).click();
      const dialog = page.getByRole('dialog', { name: 'Entrega y zonas' });
      await dialog.getByTestId('pedidosya-integration').waitFor();
    },
  },
  {
    path: '/backoffice/sucursales',
    label: 'entrega y zonas: confirmar cambio de proveedor',
    ready: { role: 'heading', name: 'Sucursales' },
    staff: 'admin',
    step: async (page) => {
      await page.getByRole('button', { name: 'Entrega y zonas de Sucursal 1' }).click();
      const dialog = page.getByRole('dialog', { name: 'Entrega y zonas' });
      await dialog.getByRole('switch', { name: 'Entrega propia en Sucursal 1' }).click();
      await page.getByRole('dialog', { name: 'Desactivar la entrega propia' }).waitFor();
    },
  },
  {
    path: '/backoffice/sucursales',
    label: 'zonas propias',
    ready: { role: 'heading', name: 'Sucursales' },
    staff: 'admin',
    step: async (page) => {
      await page.getByRole('button', { name: 'Entrega y zonas de Sucursal 1' }).click();
      const dialog = page.getByRole('dialog', { name: 'Entrega y zonas' });
      await dialog.getByRole('tab', { name: 'Zonas propias' }).click();
      await dialog.getByRole('table', { name: 'Zonas de entrega propias' }).waitFor();
    },
  },
  {
    path: '/backoffice/sucursales',
    label: 'todas las zonas de entrega',
    ready: { role: 'heading', name: 'Sucursales' },
    staff: 'admin',
    step: async (page) => {
      await page.getByRole('button', { name: 'Zonas de entrega' }).click();
      const dialog = page.getByRole('dialog', { name: 'Zonas de entrega' });
      await dialog.getByRole('table', { name: 'Zonas de entrega propias' }).waitFor();
    },
  },
  {
    path: '/backoffice/sucursales',
    label: 'nueva zona con errores',
    ready: { role: 'heading', name: 'Sucursales' },
    staff: 'admin',
    step: async (page) => {
      await page.getByRole('button', { name: 'Entrega y zonas de Sucursal 1' }).click();
      await page.getByRole('tab', { name: 'Zonas propias' }).click();
      await page.getByRole('button', { name: 'Nueva zona' }).click();
      const form = page.getByRole('dialog', { name: 'Nueva zona de entrega' });
      await form.getByLabel('Tarifa de envío (GTQ)').fill('15.001');
      await form.getByRole('button', { name: 'Crear zona' }).click();
      await form.getByText('Elige el municipio.').waitFor();
    },
  },
  {
    path: '/backoffice/sucursales',
    label: 'zona duplicada (409)',
    ready: { role: 'heading', name: 'Sucursales' },
    staff: 'admin',
    step: async (page) => {
      await page.getByRole('button', { name: 'Entrega y zonas de Sucursal 1' }).click();
      await page.getByRole('tab', { name: 'Zonas propias' }).click();
      await page.getByRole('button', { name: 'Nueva zona' }).click();
      const form = page.getByRole('dialog', { name: 'Nueva zona de entrega' });
      await form.getByLabel('Departamento').selectOption({ label: 'Guatemala' });
      await form.getByLabel('Municipio').selectOption({ label: 'Guatemala' });
      await form.getByLabel('Zona (opcional)').fill('Zona 10');
      await form.getByLabel('Tarifa de envío (GTQ)').fill('10');
      await form.getByRole('button', { name: 'Crear zona' }).click();
      await form.getByText(/Ya existe una zona con esa etiqueta/).waitFor();
    },
  },
  {
    path: '/backoffice/sucursales',
    label: 'entrega en solo lectura (encargado)',
    ready: { role: 'heading', name: 'Sucursales' },
    staff: 'manager',
    step: async (page) => {
      await page.getByRole('button', { name: 'Entrega y zonas de Sucursal 1' }).click();
      await page.getByText(/Solo lectura: no tienes permiso para modificar la entrega/).waitFor();
    },
  },
  {
    path: '/',
    label: 'pedir ahora a domicilio: cobertura pendiente',
    ready: { role: 'heading', name: /hambre/i },
    step: async (page) => {
      await page
        .getByRole('button', { name: /Iniciar pedido/ })
        .first()
        .click();
      const sheet = page.getByRole('dialog', { name: 'Pedir ahora' });
      await sheet.getByLabel('Municipio').selectOption({ label: 'Palencia' });
      await sheet.getByText(/No pudimos confirmar si llegamos a esa dirección/).waitFor();
    },
  },
  {
    path: '/',
    label: 'pedir ahora a domicilio: cobertura confirmada',
    ready: { role: 'heading', name: /hambre/i },
    step: async (page) => {
      await page
        .getByRole('button', { name: /Iniciar pedido/ })
        .first()
        .click();
      const sheet = page.getByRole('dialog', { name: 'Pedir ahora' });
      await sheet.getByLabel('Zona', { exact: true }).selectOption('10');
      await sheet.getByTestId('coverage-fee').waitFor();
    },
  },
  { path: '/backoffice/usuarios', ready: { role: 'heading', name: 'Usuarios' }, staff: 'admin' },
  {
    path: '/backoffice/roles',
    ready: { role: 'heading', name: 'Roles y permisos' },
    staff: 'admin',
  },
  {
    path: '/backoffice/usuarios',
    label: 'modal usuario',
    ready: { role: 'heading', name: 'Usuarios' },
    staff: 'admin',
    step: async (page) => {
      await page.getByRole('button', { name: /Nuevo usuario/ }).click();
      await page.getByRole('dialog', { name: 'Nuevo usuario' }).waitFor();
      await page.getByRole('button', { name: 'Guardar usuario' }).click();
      await page.getByRole('dialog').getByRole('alert').first().waitFor();
    },
  },
  {
    path: '/backoffice/usuarios',
    label: 'modal restablecer MFA',
    ready: { role: 'heading', name: 'Usuarios' },
    staff: 'admin',
    step: async (page) => {
      await page.getByRole('button', { name: 'Restablecer MFA de Cocina Zona 4' }).click();
      await page.getByRole('dialog', { name: 'Restablecer MFA' }).waitFor();
    },
  },
  { path: '/backoffice/reportes', ready: { role: 'heading', name: 'Reportes' }, staff: 'admin' },
  {
    path: '/backoffice/reportes',
    label: 'historial',
    ready: { role: 'heading', name: 'Reportes' },
    staff: 'admin',
    step: async (page) => {
      await page.getByRole('tab', { name: 'Historial de pedidos' }).click();
      await page.getByRole('heading', { name: 'Pedidos del periodo' }).waitFor();
    },
  },
];

/** Usuarios de demostración del personal por rol, con los `grants` que calcula el mock (F03). */
const STAFF_SESSIONS = {
  admin: demoStaffFromSeed('u1'),
  manager: demoStaffFromSeed('u2'),
  kitchen: demoStaffFromSeed('u5'),
  staff: demoStaffFromSeed('u9'),
} as const;

for (const theme of ['light', 'dark'] as const) {
  for (const route of A11Y_ROUTES) {
    test(`a11y ${route.path}${route.label ? ` (${route.label})` : ''}${route.signedIn ? ' (con sesión)' : ''}${route.staff ? ` (personal: ${route.staff})` : ''} · ${theme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.addInitScript((value) => localStorage.setItem('monsushi-theme', value), theme);
      if (route.local || route.session) {
        await page.addInitScript(
          ([local, session]) => {
            for (const [k, v] of Object.entries(local ?? {})) localStorage.setItem(k, v);
            for (const [k, v] of Object.entries(session ?? {})) sessionStorage.setItem(k, v);
          },
          [route.local, route.session] as const,
        );
      }
      if (route.signedIn) {
        await page.addInitScript(() =>
          sessionStorage.setItem(
            'monsushi-demo-session-v1',
            JSON.stringify({
              customer: {
                email: 'cliente@ejemplo.com',
                name: 'Cliente Demo',
                provider: 'google-demo',
              },
              staff: null,
            }),
          ),
        );
      }
      if (route.staff) {
        await page.addInitScript(
          (staff) =>
            sessionStorage.setItem(
              'monsushi-demo-session-v1',
              JSON.stringify({ customer: null, staff }),
            ),
          STAFF_SESSIONS[route.staff],
        );
      }
      await page.goto(route.path);
      await page.getByRole(route.ready.role, { name: route.ready.name }).first().waitFor();
      // Datos del catálogo ya pintados (no solo el esqueleto).
      await page
        .locator('[aria-busy="true"]')
        .first()
        .waitFor({ state: 'detached' })
        .catch(() => {});
      await page.waitForTimeout(300);
      await route.step?.(page);

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      expect(
        blocking.map((v) => ({
          id: v.id,
          impact: v.impact,
          nodes: v.nodes
            .slice(0, 8)
            .map((n) => n.target.join(' ') + ' :: ' + (n.any[0]?.message ?? '')),
        })),
      ).toEqual([]);
    });
  }
}

test('el carrito, el modo de pedido y el inicio de sesión abren como diálogos accesibles', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('heading', { name: /hambre/i }).waitFor();

  await page
    .getByRole('button', { name: /Iniciar pedido/ })
    .first()
    .click();
  const sheet = page.getByRole('dialog', { name: 'Pedir ahora' });
  await expect(sheet).toBeVisible();
  // El análisis de contraste no es fiable con la hoja a medio animar (mezcla de opacidades): se espera a que termine la animación de entrada.
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== 'running'),
  );
  const sheetResults = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
  expect(
    sheetResults.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
  ).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
});
