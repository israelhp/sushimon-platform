# Constitución técnica de Sushi Mon Platform

**Versión**: 1.0.0 · **Ratificada**: 2026-11-11 · **Última enmienda**: 2026-11-11

Esta constitución rige todas las especificaciones, planes y tareas (`/speckit-*`). Un plan que la
contradiga debe justificar la excepción por escrito (sección "Complexity Tracking" del plan).

## Principios

### I. Seguridad desde el diseño (NO NEGOCIABLE)

- La autorización se decide **siempre en la API**; el cliente solo refleja permisos.
- Backoffice: identidad Google válida → usuario interno activo → rol → permiso → alcance de sucursal
  → autorización sobre el recurso. Una cuenta Google válida **no** concede acceso.
- Ningún secreto en el repositorio, en `NEXT_PUBLIC_*` ni en logs. Nunca se almacena CVV, PIN ni PAN.
- Entradas validadas en el borde; errores seguros (sin trazas ni detalles internos).

### II. Contract First

- El contrato HTTP canónico es `packages/contracts/openapi/openapi.yaml`, diseñado **antes** de
  implementar y verificado contra NestJS (`pnpm contracts:check`).
- Los tipos del consumidor se **generan**; no se duplican a mano.
- Cambios incompatibles requieren nueva versión de ruta (`/v2`) y ADR.

### III. Integridad de datos

- El DBML (`docs/references/monsushi_dbdiagram.dbml`) es la línea base; no se reemplaza, se evoluciona
  mediante migraciones revisadas y ADR.
- La API calcula los precios finales. Los pedidos conservan snapshots históricos. Pago, pedido y
  entrega tienen ciclos de vida independientes. Operaciones monetarias auditadas e idempotentes.
- Prohibidas migraciones destructivas sin aprobación humana explícita.

### IV. Arquitectura modular y simple

- Monolito modular NestJS organizado por dominio/caso de uso, no por tabla. Controladores delgados.
- Sin Redis, colas, microservicios ni librerías "por si acaso". Toda dependencia nueva se justifica.
- Los proveedores externos (PedidosYa, Neonet) viven tras adaptadores; no definen el dominio.

### V. UI First con Mock Data honesto

- Las pantallas se construyen primero con datos simulados deterministas tras una capa de acceso a
  datos intercambiable (mock/http). Cambiar de fuente no reescribe pantallas.
- **Prohibido el fallback silencioso a mock** en producción. Las simulaciones (PedidosYa, Neonet)
  se rotulan visualmente como demostración.

### VI. Vertical slices verificables

- Una funcionalidad no está terminada hasta cumplir criterios de aceptación **e integración**.
- Estado de seguimiento: `MOCK_ONLY → CONTRACT_DEFINED → API_IMPLEMENTED → INTEGRATED → VERIFIED`
  (o `BLOCKED_EXTERNAL`). No confundir convergencia de la spec con prueba de integración real.

### VII. Pruebas y calidad (NO NEGOCIABLE)

- Todo cambio de comportamiento lleva pruebas; todo bug lleva prueba de regresión.
- Quality gates (`pnpm check`): formato, lint, tipos estrictos, pruebas, contrato, secretos, build.
- No se informa un control como exitoso si no se ejecutó.

### VIII. Accesibilidad y fidelidad visual

- Semántica HTML, teclado, foco visible, contraste y `prefers-reduced-motion`. Tema claro/oscuro,
  español/inglés y responsive son requisitos, no extras.
- La UI respeta la identidad de los prototipos de referencia, sin copiar su código empaquetado.

### IX. Rendimiento y costos

- Paginación, índices, prevención de N+1, caché con invalidación definida, imágenes optimizadas.
- Las decisiones de costo se basan en datos medidos o en límites oficiales vigentes, nunca inventados.

### X. Git Flow y trazabilidad

- Git Flow tradicional: `main` (producción), `develop` (integración), `feature/*`, `release/*`,
  `hotfix/*`. Conventional Commits. SemVer con tags en `main`.
- Sin `git push`, releases, cambios de reglas remotas ni despliegues sin autorización humana.
- Decisiones relevantes en `docs/adr/`. La documentación distingue: implementado · planificado ·
  simulado · pendiente de proveedor · bloqueado · pendiente de decisión.

## Gobernanza

Las enmiendas se proponen por PR a `develop`, con ADR si cambian una decisión técnica, y suben la
versión de este documento (SemVer: MAJOR = principio eliminado/redefinido; MINOR = principio nuevo;
PATCH = redacción).
