# Auditoría de calidad F00–F09 — SOLO LECTURA

**Objetivo:** revisar qué se implementó de F00 a F09 en ambas computadoras y en `develop` ANTES de autorizar una nueva feature. **No ejecutar reparación automática.**

## Precondiciones

- Leer `docs/BACKLOG.md`, `docs/FEATURE-WORKFLOW.md`, `CLAUDE.md`, specs individuales existentes, DBML y prototipos.
- Verificar rama actual, `git status`, `git log`, PRs accesibles, `origin/develop` y demás ramas F00–F09. Una feature en otra máquina o rama no fusionada no es automáticamente visible; registrar dónde falta evidencia.
- Distinguir **código local**, **rama remota**, **develop integrado** y **base de datos real de desarrollo**. No inferir estado integrado por una pantalla de demo.
- No cambiar ramas mediante reset/clean/stash, no cherry-pick ni merge, no instalaciones/migraciones de riesgo ni despliegue. Solo lectura salvo ejecutar checks no destructivos disponibles.
- No afirmar test pasado si no se ejecutó; marcar `NOT_RUN` y motivo. Si no hay navegador o credenciales, marcar `NOT_VERIFIED` la prueba E2E, no PASS.

## Estados por subcomponente

`PASS`: evidencia ejecutada y aceptada; `PARTIAL`: falta un requisito; `FAIL`: fallo demostrado; `NOT_VERIFIED`: no hay evidencia; `BLOCKED_EXTERNAL`: depende de API oficial de tercero; `NOT_APPLICABLE`: excepción justificada (ej. UI comercial F00).

## Matriz F00–F09 por caso de uso

### F00 — Fundamentos de API y estándares transversales · A/B: A · Tipo: API/infraestructura + integración técnica WEB; sin pantalla comercial

- [ ] NestJS + Express levanta sin errores, schema Prisma y conexión DB configurada sin secretos en Git.
- [ ] GET /v1/health y /ready (si existe) responden de acuerdo al contrato.
- [ ] OpenAPI generado y cliente tipado consumido por Next.js; errores/CORS/validación/versionado.
- [ ] Scripts lint, typecheck, tests, build verificables de API y Web.

**Pruebas mínimas:** verificar contratos/DTO, unidad, integración API, integración Next.js según alcance, escenarios negativos, lint/typecheck/build; evidencias con ruta de archivo y/o comando.

### F01 — Google OAuth y contexto de sesión · A/B: A · Tipo: API + WEB (tienda y backoffice)

- [ ] Google OAuth callback/PKCE, sesión y logout reales en Next.js.
- [ ] JWT issuer/audience/firma/exp verificados en NestJS; no tokens/secretos expuestos.
- [ ] Cuenta cliente puede entrar; usuario sin preautorización no accede a backoffice.
- [ ] Navegación SSR y estados de sesión expirados funcionan.

**Pruebas mínimas:** verificar contratos/DTO, unidad, integración API, integración Next.js según alcance, escenarios negativos, lint/typecheck/build; evidencias con ruta de archivo y/o comando.

### F02 — MFA TOTP obligatorio en backoffice · A/B: A · Tipo: API + WEB (flujo administrativo)

- [ ] Supabase MFA enrolamiento/challenge/verify y UI completa.
- [ ] aal1 no puede ejecutar rutas admin; aal2 sí con permisos, no basta MFA.
- [ ] Errores/reintentos/recuperación aprobada; empleado desactivado rechazado.
- [ ] No se implementó segundo sistema TOTP.

**Pruebas mínimas:** verificar contratos/DTO, unidad, integración API, integración Next.js según alcance, escenarios negativos, lint/typecheck/build; evidencias con ruta de archivo y/o comando.

### F03 — Empleados, roles, permisos y asignaciones · A/B: A · Tipo: API + WEB (administración de empleados, roles y sucursales)

- [ ] Preautorización segura y vínculo al primer Google OAuth; resolver `auth_user_id NOT NULL` del DBML sin vulnerabilidad.
- [ ] CRUD empleados/roles/permisos/asignaciones y panel Next.js conectado.
- [ ] Guards y policies branch-scoped; escalada de privilegios y último admin protegidos.
- [ ] Auditoría de acciones sensibles; sin bypass admin para F07–F09.

**Pruebas mínimas:** verificar contratos/DTO, unidad, integración API, integración Next.js según alcance, escenarios negativos, lint/typecheck/build; evidencias con ruta de archivo y/o comando.

### F04 — Perfil y preferencias de cliente · A/B: A · Tipo: API + WEB (cuenta del cliente)

- [ ] Perfil vinculado a Supabase, idempotencia/evitar duplicados y propiedad.
- [ ] API GET/PATCH /v1/me valida datos y 401.
- [ ] Pantalla Mi cuenta edita/consulta datos reales, loading/error/ES-EN.
- [ ] No mezcla información entre cuentas al cambiar sesión.

**Pruebas mínimas:** verificar contratos/DTO, unidad, integración API, integración Next.js según alcance, escenarios negativos, lint/typecheck/build; evidencias con ruta de archivo y/o comando.

### F05 — Direcciones guardadas · A/B: A · Tipo: API + WEB (Mis direcciones + selector en checkout)

- [ ] CRUD /v1/me/addresses, endpoint predeterminada, ownership/IDOR y default única bajo concurrencia.
- [ ] Validación municipio y campos, sin exigir cobertura PedidosYa.
- [ ] Mi cuenta→Mis direcciones: listar/crear/editar/eliminar/default con API real.
- [ ] Selector de dirección guardada en checkout (solo seleccionar/guardar; sin cotizar) integrado sin Mock Data engañosa.

**Pruebas mínimas:** verificar contratos/DTO, unidad, integración API, integración Next.js según alcance, escenarios negativos, lint/typecheck/build; evidencias con ruta de archivo y/o comando.

### F06 — Favoritos del cliente · A/B: A · Tipo: API + WEB (Mis favoritos + botones en tienda)

- [ ] Relación cliente-producto única en Prisma/DB y PUT/DELETE idempotente.
- [ ] GET favoritos por dueño, productos válidos y sin datos de otras cuentas.
- [ ] Pantalla Mis favoritos real y corazones sincronizados en menú/detalle; usuario sin login gestionado.
- [ ] Estado por sucursal y caché privada sin una petición por producto.

**Pruebas mínimas:** verificar contratos/DTO, unidad, integración API, integración Next.js según alcance, escenarios negativos, lint/typecheck/build; evidencias con ruta de archivo y/o comando.

### F07 — Sucursales y metadatos públicos · A/B: B · Tipo: API + WEB (selector público + administración de sucursales)

- [ ] GET públicos, GET/POST/PATCH admin, estado admin, unicidad de código, integridad de relaciones.
- [ ] Selector público usa sucursales reales y reacciona a inactivos.
- [ ] Backoffice sucursales: listado/crear/editar/activar/desactivar conectado.
- [ ] JWT + aal2 + RBAC/scope F03 en rutas administrativas; sin bypass.

**Pruebas mínimas:** verificar contratos/DTO, unidad, integración API, integración Next.js según alcance, escenarios negativos, lint/typecheck/build; evidencias con ruta de archivo y/o comando.

### F08 — Horarios y cierres excepcionales · A/B: B · Tipo: API + WEB (horarios públicos + editor administrativo)

- [ ] Horarios semanales con tramos y closures persistidos en Prisma, cronología consistente America/Guatemala.
- [ ] Availability distingue active/open/accepting, próximas transiciones, cierres y medianoche.
- [ ] Backoffice editor horario/cierres y tienda muestran estado real.
- [ ] Seguridad administrativa, pruebas de límites y caché con próxima transición.

**Pruebas mínimas:** verificar contratos/DTO, unidad, integración API, integración Next.js según alcance, escenarios negativos, lint/typecheck/build; evidencias con ruta de archivo y/o comando.

### F09 — Geografía, zonas y cobertura de entrega · A/B: B · Tipo: API + WEB (catálogo geográfico, cobertura/configuración y administración)

- [ ] Departamentos/municipios reales, OWN zones, tarifa Decimal y flag `ownDeliveryZonesEnabled=false` por sucursal.
- [ ] Cobertura propia se evalúa solo si flag ON; proveedor PedidosYa se modela separado y devuelve UNKNOWN sin sandbox.
- [ ] Backoffice configura proveedores/zonas/tarifas; tienda consulta cobertura sin afirmar datos ficticios.
- [ ] Mock determinista solo dev; F29 externa BLOCKED_EXTERNAL y sin endpoints inventados; RBAC por sucursal.

**Pruebas mínimas:** verificar contratos/DTO, unidad, integración API, integración Next.js según alcance, escenarios negativos, lint/typecheck/build; evidencias con ruta de archivo y/o comando.

## Evidencias que debe recolectar Claude

| Campo            | Descripción                                                                  |
| ---------------- | ---------------------------------------------------------------------------- |
| FXX              | ID exacto                                                                    |
| Rama/commit      | Dónde existe el código, diferencia contra `develop`                          |
| Requisito        | Ficha BACKLOG o spec individual exacta                                       |
| API              | Ruta de controller/service/repo y endpoint probado                           |
| BD               | Modelo/migración/índice probado; jamás deducir del DBML que ya se aplicó     |
| WEB              | Pantalla real, cliente HTTP, query hook y prueba de flujo; mock identificado |
| Seguridad        | 401, 403, IDOR/scope, aal2 en admin                                          |
| Tests            | Comando, fecha, salida resumida y código de salida                           |
| Resultado        | PASS / PARTIAL / FAIL / NOT_VERIFIED / BLOCKED_EXTERNAL                      |
| Riesgo           | blocker P0 / alta / media / baja                                             |
| Acción propuesta | Archivo/cambio y dueño A/B; **sin implementar**                              |

## Gate de salida

- **Bloqueo crítico:** autenticación/autorización accesible sin guard, pérdida de datos o falsos precios/cobertura; no autorizar nueva feature dependiente hasta resolver.
- **Parcial:** si solo existen contratos/Mocks, reportar qué integración falta (API, Web o DB); no READY full-stack.
- **Proveedor externo:** F09 puede cerrar como `READY interna / MOCK_READY proveedor / BLOCKED_EXTERNAL real`; no exigir PedidosYa para declarar la cobertura OWN funcional.
- **Sin evidencia:** rama no visible, DB no accesible, test no ejecutable → `NOT_VERIFIED`, no PASS.
- Al terminar, entregar tabla F00–F09 con estado global y **columnas API, WEB, DB, SEGURIDAD, TESTS, DEPENDENCIAS y PENDIENTES**; añadir hallazgos por severidad y el orden de reparación recomendado. **Detenerse sin reparar, sin siguiente feature y sin push/merge.**
