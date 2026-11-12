# F00 — Fundamentos de API y estándares transversales

**Rama**: `feature/f00-api-foundations` · **Prioridad**: P0 · **Dependencias**: ninguna
**Estado de integración**: `API_IMPLEMENTED` (la web lee el contrato; sin pantallas que dependan aún).

## Historias

- **US1 (operación)**: como operador quiero comprobar que la API vive (`/v1/health`) y que puede hablar con
  PostgreSQL y el esquema `app` (`/v1/health/ready`, protegido).
- **US2 (consumidor)**: como cliente web quiero errores con una forma única y un `requestId` para soporte.
- **US3 (seguridad)**: como equipo quiero CORS explícito, rate limiting, cabeceras seguras y cero credenciales
  en Git.

## Requisitos funcionales

- FR-001 NestJS + Express, TypeScript estricto.
- FR-002 Prisma 7 + Supabase PostgreSQL (esquema `app`), pool pequeño apto para serverless (ADR-0003).
- FR-003 Variables de entorno validadas al arrancar (zod); vacías = no definidas; en producción son obligatorias
  `DATABASE_URL` y `HEALTH_READY_TOKEN`, y `CORS_ORIGINS` no admite `*`. Nunca se imprime un valor.
- FR-004 Validación global de DTOs (whitelist, forbidNonWhitelisted, transform) → 400 con `details`.
- FR-005 Error único `ErrorResponse {statusCode, error, message, requestId?, details?}`; 5xx sin detalles internos.
- FR-006 `X-Request-Id` en toda respuesta; se reutiliza el entrante solo si es seguro (`[A-Za-z0-9._-]{8,64}`).
- FR-007 CORS con lista de orígenes; rate limit global por IP (`RATE_LIMIT_*`); `helmet`.
- FR-008 Swagger/OpenAPI + contrato canónico verificado (`contracts:check`).
- FR-009 `GET /v1/health` público, sin dependencias, exento de rate limit.
- FR-010 `GET /v1/health/ready` con `x-health-token`: 200 / 401 / 503 (mensaje genérico).
- FR-011 Pruebas unitarias, e2e (Prisma simulado) e integración (PostgreSQL real); CI con servicio Postgres.
- FR-012 Web: `ApiError` con `requestId`/`details`, cliente de health tipado con tipos generados.

## Criterios de aceptación

API ejecutable · conexión comprobada contra PostgreSQL real (local y CI) · errores consistentes · `pnpm check`
verde · sin credenciales en Git (`secrets:scan`).

## Fuera de alcance / pendiente

- Probar contra el proyecto Supabase real (no hay credenciales; requiere autorización) y fijar SSL si hace falta.
- Rate limit con almacenamiento compartido (hoy por instancia).
- Logging estructurado JSON, métricas y tracing (slice de observabilidad).
- Autenticación/RBAC (Etapa 3). Despliegue (sin autorización).
