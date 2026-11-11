# ADR-0008 Capa de datos: puerto único con adaptadores mock/http

**Estado**: aceptada · 2026-11-11

**Decisión**:

- Flujo: `Componente → hook de feature (TanStack Query) → service de dominio → DataClient → mock | http`.
  Los componentes solo conocen hooks; los services solo conocen `DataClient` y las rutas de `lib/data-access/paths.ts`
  (las mismas de `docs/contracts/planned-endpoints.md`).
- `DataClient.request({ method, path, query, body })` con un único error tipado `ApiError { status, code, message }`.
- El **adaptador mock** resuelve cada `METHOD /v1/...` con _handlers_ puros sobre un `MockStore` sembrado de forma
  determinista (fixtures + PRNG con semilla + reloj inyectable). Vive en el navegador (una instancia por pestaña)
  y persiste en `sessionStorage`, para que un pedido creado en la tienda aparezca en el backoffice de la misma sesión.
- Los escenarios (`NEXT_PUBLIC_MOCK_SCENARIO`) alteran el store o los handlers (error, offline, forbidden, etc.).
- Tipos: esquemas _draft_ en `components/schemas` del OpenAPI (`x-status: draft`), sin `paths` hasta que la API los
  implemente (lo exige `contracts:check`).
- `resolveDataSource` no cambia: sin fallback silencioso a mock en producción.
  **Consecuencias**: pasar a la API real es cambiar `NEXT_PUBLIC_DATA_SOURCE=http` e implementar los endpoints; una
  prueba de paridad ejecuta los mismos services contra ambos adaptadores. La sesión simulada (cliente Google y rol del
  backoffice) es solo de demostración y se sustituye por Supabase Auth en la Etapa 3.
