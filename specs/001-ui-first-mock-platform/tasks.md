# Tasks: Demo funcional UI First (tienda + backoffice)

**Input**: `spec.md`, `plan.md` · Rama `feature/ui-first-mock-platform` · Estado de integración: `MOCK_ONLY`

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [x] T001 Crear rama `feature/ui-first-mock-platform` desde `develop`
- [x] T002 ADR-0004/0005 actualizados; ADR-0007 y ADR-0008 nuevos
- [x] T003 `scripts/prototype-extract.mjs` + `scripts/prototype-i18n.mjs`; `docs/ui/extracted/` ignorado
- [x] T004 Prueba `node:test` del extractor en `scripts/prototype-extract.test.mjs`
- [x] T005 Dependencias web: next-intl, lucide-react, clsx, @fontsource/*, Testing Library, jsdom, Playwright, axe, pixelmatch, pngjs

## Phase 2: Foundational (bloquea las historias)

- [x] T010 [P] Tokens por zona (`[data-zone=store|bo]`, claro/oscuro) + `@theme` + breakpoints/variants + keyframes en `src/app/globals.css`
- [x] T011 [P] Fuentes autoalojadas, `ThemeProvider` sin parpadeo, next-intl (`src/i18n/request.ts`, cookie `NEXT_LOCALE`), mensajes es/en
- [x] T012 [P] Componentes base en `src/components/ui/` + página `/_ui` (solo desarrollo)
- [x] T013 [P] Ilustraciones (`src/components/art/`), logos (`public/brand/`), íconos del backoffice (`src/components/icons/bo/`)
- [x] T020 [P] Esquemas draft en `packages/contracts/openapi/openapi.yaml` + `pnpm contracts:generate`; `docs/contracts/planned-endpoints.md`
- [x] T021 [P] `DataClient.request`, `ApiError`, `paths.ts`, http-client ampliado, `mock-client.ts`, `DataProvider` (QueryClient)
- [x] T022 [P] MockStore + reloj + PRNG + fixtures fusionadas + handlers por ruta + escenarios
- [x] T023 [P] Services por dominio + hooks de feature + pruebas unitarias y de paridad mock/http
- [x] T024 Estado local del cliente: carrito, modo de pedido, sesión de demostración (cliente y personal)

## Phase 3: US1 Pedido en la tienda (P1) 🎯 MVP

- [x] T030 [US1] Layout de tienda: header, nav móvil, footer, toggles, CartDrawer, OrderModeSheet
- [x] T031 [US1] Inicio: carrusel, categorías, favoritos, Happy Hour
- [x] T032 [US1] Menú `?cat=` + ProductSheet; Promociones
- [x] T033 [US1] Checkout 5 pasos + modal NeoNet simulado + confirmación
- [x] T034 [US1] Pruebas de componentes (carrito, checkout) y E2E de compra en efectivo y tarjeta rechazada

## Phase 4: US2 Gestión de pedidos en el backoffice (P1)

- [x] T040 [US2] Login de demostración + shell (sidebar, topbar, popovers, toast) con menú por rol
- [x] T041 [US2] Panel (KPIs) + Pedidos (kanban/tabla, drawer, aceptar/rechazar/preparar/listo)
- [x] T042 [US2] Entregas + modal Despachar (PedidosYa simulado / propio)
- [x] T043 [US2] E2E: encargado lleva un pedido a entregado; cocina sin acceso a entregas

## Phase 5: US3 Seguimiento y consulta (P2)

- [x] T050 [US3] `pedidos/[id]`, `consultar`, `incidencias` + E2E de consulta de invitado

## Phase 6: US4 Cuenta (P2)

- [x] T060 [US4] `cuenta/*` (datos, direcciones, favoritos, pedidos), modal de inicio de sesión simulado, reorden

## Phase 7: US5 Administración (P3)

- [x] T070 [US5] Productos, categorías, promociones (+ modales)
- [x] T071 [US5] Sucursales, usuarios, reportes (resumen con SVG propio, historial)

## Phase 8: US6 Contenido (P3)

- [x] T080 [US6] `mas`, `trabaja-con-nosotros` (validación accesible), 404

## Phase 9: Polish & Cross-Cutting

- [x] T090 Playwright: configuración, axe en todas las rutas, comparación visual (`test:visual`)
- [x] T091 CI: job E2E + axe; umbral de cobertura en lib/mocks/services
- [x] T092 Revisiones: ui-ux-reviewer por bloque, security-reviewer, performance-reviewer; correcciones
- [x] T093 Docs: inventario, design-system, mock-data-strategy, screen-implementation-plan, overview (estado)
- [x] T094 `pnpm check` verde; `/speckit-converge`; PR a `develop` preparado (push solo con autorización)

## Dependencies & Execution Order

Phase 1 → Phase 2 (T010–T013 ∥ T020–T024) → US1 → US2 → US3/US4/US6 → US5 → Polish.
Por decisión del usuario, la tienda va antes que el backoffice; todo en una sola rama con commits por bloque.
