# ADR-0004 Modelo de caché de Next

**Estado**: revisada · 2026-11-11 — se mantiene **desactivado** durante la Etapa 1

El scaffold oficial de Next 16.4 activa `cacheComponents` y `partialPrefetching`; se **omitieron** en el bootstrap.
En la Etapa 1 los datos simulados viven en el navegador (ver ADR-0008) y las pantallas interactivas usan TanStack
Query, de modo que no hay datos de servidor que cachear. Reevaluar en la Etapa 3 con el catálogo real (datos
públicos por sucursal: candidato a caché) frente a pedidos/panel (por usuario: sin caché).
