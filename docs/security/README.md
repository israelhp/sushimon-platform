# Seguridad

Estado: ✅ controles de repositorio (hooks, escáner de secretos, CORS/validación/errores base en la API) ·
✅ autenticación y autorización base (F01, ver `docs/security/auth.md`; Google real sin verificar) · ⏳ seguridad de proveedores. Reglas: `.claude/rules/security.md`, skill `auth-security`.

## Modelo de acceso (📐 slice `feature/google-oauth`)

- **Backoffice**: token verificable de Supabase (Google) → `staff_users.active` → rol → permiso → alcance de sucursal
  (`staff_assignments`) → autorización sobre el recurso. Denegar por defecto; el cliente no calcula permisos.
- **Tienda**: navegación y checkout invitado; Google opcional; un cliente solo accede a sus datos. Consulta de pedido de
  invitado por número+teléfono: rate limiting y respuesta uniforme para no enumerar pedidos.
- Bootstrap del primer administrador: `pnpm --filter sushimon-api staff:bootstrap` (manual y controlado; ver `docs/security/auth.md`).

## Controles base ya presentes

CORS por lista blanca (`CORS_ORIGINS`) · `ValidationPipe` (whitelist) · filtro de errores sin trazas · validación de entorno
con falla al arrancar · `.env` fuera de Git · escáner de secretos (`pnpm secrets:scan`) · hooks de Claude Code.

## Rate limiting por ruta y proxy (F09)

`POST /v1/delivery-coverage/check` (30/min) y `GET /v1/locations/*` (60/min) llevan `@Throttle` por IP (429 `RATE_LIMITED`,
`no-store`, `Retry-After`); el resto usa el tope global (`RATE_LIMIT_*`). El contador es en memoria por instancia y la IP sale de
`req.ip`: **detrás de un proxy/CDN (Vercel, Render, Fly…) `TRUST_PROXY_HOPS` debe ser >= 1; con 0 todos los clientes comparten la IP
del proxy y el límite se aplica al conjunto (o es evadible por cabeceras).** Es un **requisito bloqueante de despliegue**. No se
bloquea en `env.ts` (dejaría de arrancar entornos F00-F08 existentes): con `NODE_ENV=production` y `TRUST_PROXY_HOPS=0` la API
arranca pero registra un **warning** claro; verificarlo igualmente en la checklist de despliegue. Antes de F29
(PedidosYa real) revisar un almacenamiento compartido del contador.

`NODE_ENV` ausente no salta las comprobaciones de producción: si falta y `DATABASE_URL` apunta a un host que no es
`localhost`/`127.0.0.1`/`::1` (o hay una variable de plataforma como `VERCEL`, `RENDER`, `FLY_APP_NAME`, `K_SERVICE`), la API
**no arranca** y exige `NODE_ENV` explícito. Sin `DATABASE_URL` remota (desarrollo, test, CI) el default `development` no cambia.

El mock de cobertura de PedidosYa solo arranca con `NODE_ENV` explícitamente `development` o `test`.

Los campos `reason` (cierres F08, estado de zonas F09) son texto libre de operador, se guardan en auditoría y NO deben contener
datos personales.

**Auditoría sin PII.** `app.audit_events` guarda solo ids, estados y nombres de campo (`changedFields`), nunca nombre, correo,
teléfono ni dirección. `staff.created` y `staff.updated` ya no registran `fullName`/`email`. Las filas históricas anteriores a
este cambio pueden conservarlos: la tabla es append-only y no se reescribe (retención/anonimización: pendiente).

**Enumeración de empleados (F03, riesgo aceptado).** `POST /v1/admin/staff` responde `409` si el correo ya es empleado. Lo exige el
contrato y solo lo ve quien tiene `staff.create` con `aal2`, por lo que no se cambia. Un administrador puede así comprobar si
un correo es personal; el endpoint está protegido por rol, alcance, MFA y rate limit y cada intento queda auditado.

**Prueba de arquitectura.** `test/admin-routes-guards.e2e-spec.ts` recorre todos los controladores y falla si una ruta `/v1/admin/*`
no lleva `StaffGuard` y `MfaGuard` (`@RequireStaff`).

## Pendiente (📐)

Rate limiting (`@nestjs/throttler`) · cabeceras de seguridad (Helmet/Next headers) · política CSRF según mecanismo de sesión ·
RLS en Supabase · auditoría de acciones monetarias · logging estructurado sin PII · verificación de firmas de webhooks ·
retención de datos personales · escáner dedicado en CI (gitleaks); `pnpm audit` ya está incluido.

## Reporte

Hallazgos de seguridad: `security-reviewer` (solo lectura) con evidencia `archivo:línea`.
