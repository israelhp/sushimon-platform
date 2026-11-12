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

## Phase 10: Convergence

- [x] T095 HIGH: añadir un E2E que falle ante cualquier solicitud de red fuera de `localhost` durante un recorrido de tienda y de backoffice per SC-007 (missing)
- [ ] T096 HIGH: ejercitar en UI los escenarios `empty`, `error`, `offline`, `forbidden`, `branch-closed`, `product-unavailable`, `promotion-expired`, `rider-unavailable` y `loading` (p. ej. proyecto Playwright con servidor por escenario o selector de escenario en pruebas) per FR-012 (partial)
- [ ] T097 MEDIUM: reducir las diferencias visuales > 3 % (neonet-pendiente móvil, despacho móvil, promociones móvil, Inicio completo) o ratificar por pantalla el umbral con justificación en `docs/ui/prototype-inventory.md` per SC-002 (partial)
- [ ] T098 MEDIUM: añadir prueba de "sin desplazamiento horizontal" a 320 px en las rutas principales de ambas zonas y E2E móvil (proyecto `e2e-mobile`) de compra y de gestión de pedido per Edge Cases (missing)
- [ ] T099 MEDIUM: probar el arranque con `NEXT_PUBLIC_DATA_SOURCE=http` sin API disponible (falla explícito, sin caer a mock) per FR-014 (partial)
- [x] T100 LOW: permitir que el bloqueo 429 de la consulta de invitado se recupere (ventana de tiempo del reloj de la demo o reinicio al resetear el store) per US3/AC1 (partial)
- [ ] T101 LOW: registrar en `docs/ui/prototype-inventory.md` las adiciones no pedidas como diferencias intencionales (pausa del carrusel, "Editar" de sucursales, buscador de usuarios, `/incidencias/nuevo`, rutas `/v1/demo/*`, cabeceras de seguridad, límite 429) per Constitution VIII (unrequested)
- [ ] T102 LOW: dividir los mensajes i18n por zona y extraer un `CartPanel` compartido per Constitution IX (partial)
- [ ] T103 LOW: añadir aserción de duración a los E2E de compra (< 2 min) y de gestión de pedido (< 1 min) per SC-003 y SC-004 (partial)
