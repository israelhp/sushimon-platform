# ADR-0013 Geografía, cobertura por proveedor y zonas propias de entrega

**Estado**: **propuesta** (2026-11-14, F09). Se acepta al fusionar `specs/008-delivery-zones-coverage`.

**Contexto**: el DBML define `departments`, `municipalities` y `delivery_zones` (`base_fee`), pero no existen en migraciones ni API. El mock
de la web decide cobertura con «tiers» fijos y ETA inventados, y el prototipo habla de «radio» (brecha B7). PedidosYa (proveedor principal) no
tiene documentación, sandbox ni credenciales (`docs/integrations/pedidosya/README.md`), por lo que su cobertura no se puede verificar. Los
repartidores propios sí pueden cubrir zonas definidas por el restaurante. F19/F20 (otro desarrollador) necesitan un único punto fiable de
cobertura y tarifa.

## Decisión

1. **B7 resuelto**: cobertura por **municipio + zona opcional**, no por radio (el radio queda descartado; `branches.latitude/longitude` no se usan para cobertura).
2. **Dos proveedores, evaluados por separado**: `PEDIDOSYA` y `OWN`. No existe un booleano `covered`. Las zonas propias no implican cobertura
   de PedidosYa ni al revés. Cada proveedor lleva `enabled` (flag administrativo) separado de su disponibilidad geográfica.
3. **`UNKNOWN` es un estado propio** de PedidosYa (`AVAILABLE | UNAVAILABLE | UNKNOWN`). Sin integración verificable, siempre `UNKNOWN` +
   `integrationStatus = BLOCKED_EXTERNAL`; error o timeout del proveedor también ⇒ `UNKNOWN` con `reason`, nunca `UNAVAILABLE` ni 5xx
   (`UNAVAILABLE` solo puede venir de una respuesta de cobertura válida del proveedor).
4. **Puerto neutral `CourierCoveragePort`** (entrada mínima, salida `{provider, status, integrationStatus, reason?}`) separado de cualquier cotización
   (`quoteStatus = NOT_AVAILABLE`). Dos adaptadores: `UnavailableIntegrationAdapter` (defecto y producción) y `MockPedidosYaCoverageAdapter`
   (determinista, sin red). Selección solo por configuración explícita (`PEDIDOSYA_COVERAGE_ADAPTER`), validada con zod; **`mock` + `NODE_ENV=production` impide arrancar**.
   El mock marca `integrationStatus = MOCK` y `eligibility.simulated = true`; nunca autoriza solicitudes reales. F29 añadirá un adaptador `LIVE`
   sin cambiar el contrato público (enums abiertos).
5. **Servicios únicos de dominio**: `OwnDeliveryCoverageService` (cobertura propia, una consulta acotada, no evalúa zonas si el flag está apagado) y
   `DeliveryCoverageService` (orquestador; algoritmo único para HTTP y F19/F20). La elegibilidad (`CONFIRMED | PENDING | NONE`, `confirmedProviders`,
   `pendingProviders`) se deriva **en servidor**; el cliente no la recalcula. F09 no depende de F08: horarios se combinan en checkout.
6. **Configuración por sucursal** en tabla 1:1 `branch_delivery_settings` (no columnas en `branches`: F07 permanece intacta y la auditoría es
   por entidad). Defaults `own=false`, `pedidosya=true`; **fila ausente = defaults, sin backfill** (lazy upsert), con los defaults en un único
   lugar del código y de la BD. `pedidosyaEnabled` es administrativo, no un indicador de integración.
7. **Zonas propias** `delivery_zones` + `zone_key` (clave normalizada) y `UNIQUE (branch, municipality, zone_key)` con `zone_key = ''` para «sin
   etiqueta». Esto resuelve la unicidad con NULL **sin** `NULLS NOT DISTINCT` ni índices de expresión (portables a PGlite/Supabase) y expresa de forma
   explícita que **NULL = cobertura general del municipio**. Prioridad zona específica > general > nada, sin selección arbitraria (a lo sumo 2
   candidatas). Sin borrado físico (solo `active`); la unicidad incluye inactivas. La normalización (NFC, recorte, colapso de espacios,
   comparación sin acentos ni mayúsculas) vive en la API; la BD valida coherencia mediante CHECK (no hay `unaccent` inmutable).
8. **Dinero exacto**: `numeric(12,2)` + CHECK `0..99999.99`; en la API **string decimal** (entrada 0–2 decimales, salida 2); nunca `number`. El
   frontend nunca decide el precio; los pedidos congelan el `baseFee` devuelto por el servidor.
9. **Concurrencia**: `version` entera con `expectedVersion` en `PATCH` de zonas (409 `DELIVERY_ZONE_VERSION_CONFLICT`, sin candados);
   estado y settings son asignaciones explícitas idempotentes de último-gana; duplicados concurrentes ⇒ `23505` ⇒ 409 `DELIVERY_ZONE_DUPLICATE`. Se
   añaden `version`, `created_at`, `updated_at` a una tabla que aún no existe (evolución del DBML con migración + este ADR).
10. **Catálogos geográficos**: públicos, solo lectura, ordenados en la API con `Intl.Collator('es')` y con caché pública larga. Seed por migración
    idempotente: 22 departamentos (hecho conocido) y **solo** los 17 municipios del departamento de Guatemala; el resto queda **pendiente de
    fuente oficial (INE)** y no se inventa. UUID por entorno (nada de ids fijos en clientes).
11. **Seguridad**: admin con JWT + personal activo + aal2 + permiso por método + alcance por sucursal (fuera de alcance ⇒ 404) + auditoría en la
    misma transacción + `no-store`. El endpoint público de cobertura no recibe costos, no crea nada y es `no-store`; referencias inválidas del cuerpo
    ⇒ 422 (rutas padre ⇒ 404).
12. **Sin dependencias nuevas**: ni librería de normalización, ni Redis, ni colas, ni caché del resultado externo, ni circuit breaker (diferidos a F29
    con la documentación del proveedor).

## Consecuencias

- Migración `0007` incremental no destructiva (4 tablas nuevas + seed); `customer_addresses` (F05) podrá referenciar `municipalities`.
- Los esquemas draft `Department`/`Municipality` pasan a `DraftDepartment`/`DraftMunicipality`; la web migra y retira los tiers/ETA del mock.
- El estado «PedidosYa conectado» no existe en ninguna pantalla; la UI solo muestra «Integración pendiente» o «Simulación».
- La tienda solo podrá ofrecer entrega fuera del departamento de Guatemala cuando se carguen sus municipios (migración de datos posterior).
- Zonas excluidas dentro de un municipio con cobertura general, ETA propio y mapas/polígonos quedan fuera (requieren nueva decisión y modelo).
- Cuando exista documentación de PedidosYa (F29): nuevo adaptador `LIVE`, ampliación aditiva del puerto, política de caché/reintentos y límite de
  tasa del endpoint público.

## Alternativas descartadas

- **Radio desde la sucursal** (prototipo): requiere geocodificar direcciones y proveedor de mapas; el modelo vigente es administrativo.
- **Un booleano `covered`**: oculta quién cubre y la diferencia entre «no cubre» y «no sé».
- **Tratar «sin integración» como `UNAVAILABLE`**: bloquearía pedidos válidos por una limitación nuestra; `UNKNOWN` lo distingue.
- **`NULLS NOT DISTINCT` o índice único con `COALESCE`**: menos portable/legible que `zone_key = ''` y no aporta la clave normalizada para búsqueda.
- **Normalizar en BD con `unaccent`**: no es `IMMUTABLE`; extensión adicional en Supabase sin necesidad.
- **Flags como columnas de `branches`**: toca F07, mezcla configuración logística con datos básicos y complica auditoría.
- **Último-gana en tarifas**: pérdida silenciosa de cambios monetarios.
- **Mock activable en producción para «demos»**: riesgo de autorizar entregas falsas; se impide al arrancar.
- **Sembrar municipios «aproximados» de todo el país**: datos sin fuente verificada.
