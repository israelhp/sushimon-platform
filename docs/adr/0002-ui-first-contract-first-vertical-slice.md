# ADR-0002 Metodología híbrida

**Estado**: aceptada · 2026-11-11

**Decisión**: UI First con Mock Data tras una capa de acceso a datos intercambiable; Contract First con OpenAPI canónico versionado y verificado contra NestJS; integración por vertical slices.
**Consecuencias**: el contrato precede a la API; la UI puede avanzar sin backend; `resolveDataSource` impide el fallback silencioso a mock en producción. Ver `docs/architecture/development-methodology.md`.
