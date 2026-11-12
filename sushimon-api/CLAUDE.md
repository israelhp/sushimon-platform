# sushimon-api — reglas NestJS

Contexto global en `../CLAUDE.md`. Aquí solo lo específico de la API.

- **Stack**: NestJS 12 (Express), TypeScript estricto, ESM (`.js` en imports relativos), Vitest, ESLint.
- **Monolito modular**: un módulo por dominio/caso de uso (`catalog`, `orders`, `delivery`, `payments`,
  `auth`…), no por tabla. `AppModule` solo compone módulos.
- **Capas**: controller (HTTP, DTO, auth) → service (reglas de negocio, transacciones) →
  repositorio/acceso a datos (solo si aporta). Controladores delgados; sin lógica en DTOs.
- **Prefijo y versión**: todo bajo `/v1`. Cambios incompatibles → `/v2` + ADR.
- **Contract First**: el endpoint debe existir antes en `packages/contracts/openapi/openapi.yaml` con el mismo
  `operationId` y códigos de respuesta. `pnpm contracts:check` falla si divergen.
- **Validación**: DTOs con `class-validator` (ValidationPipe global: whitelist + forbidNonWhitelisted).
  Config de entorno validada con zod en `src/config/env.ts` (falla al arrancar).
- **Errores**: `AllExceptionsFilter` devuelve `{statusCode,error,message}`; nunca trazas en 5xx.
- **Auth** (pendiente, slice `google-oauth`): guard que verifica JWT de Supabase, resuelve usuario interno,
  rol, permisos y alcance de sucursal; decoradores explícitos por endpoint. Denegar por defecto.
- **Dinero**: la API calcula totales en GTQ con enteros/decimal exacto, nunca `number` flotante;
  idempotencia (`Idempotency-Key`) en operaciones de pedido/pago.
- **Proveedores externos**: tras interfaces (`DeliveryProvider`, `PaymentGateway`); adaptadores reales
  solo con documentación oficial + sandbox. Mientras tanto, adaptadores mock explícitos.
- **ORM**: Prisma 7.10.1 + adapter `pg` (ADR-0003). No instalar otro ORM ni SQL ad-hoc en servicios. Migraciones con `DIRECT_URL`; nunca aplicar a Supabase sin autorización.
- **Pruebas**: `*.spec.ts` junto al código (unit); `test/*.e2e-spec.ts` (supertest). Mocks de red siempre.
- **Logging**: estructurado, sin PII ni secretos.

Comandos: `pnpm --filter sushimon-api {dev|test|test:e2e|lint|typecheck|build}`.

## Inyección de dependencias

Usa `@Inject(Clase)` explícito en los constructores de providers/controladores/guards: el script
`openapi:emit` corre con `tsx` (esbuild), que no emite `emitDecoratorMetadata`. Sin `@Inject`, Nest falla
con salida vacía y código 1 (el logger está desactivado en ese script).
