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

## Pendiente (📐)

Rate limiting (`@nestjs/throttler`) · cabeceras de seguridad (Helmet/Next headers) · política CSRF según mecanismo de sesión ·
RLS en Supabase · auditoría de acciones monetarias · logging estructurado sin PII · verificación de firmas de webhooks ·
retención de datos personales · escáner dedicado en CI (gitleaks); `pnpm audit` ya está incluido.

## Reporte

Hallazgos de seguridad: `security-reviewer` (solo lectura) con evidencia `archivo:línea`.
