# F09 — Geografía, cobertura y configuración logística por sucursal

**Rama**: `feature/F09-delivery-zones-coverage` (desde `develop` con F00–F08)
**Prioridad**: P0 · **Dependencias**: F00, F01, F02, F03 (RBAC), F07 (sucursales) · **Independiente de F08** (no importa `branch-schedule`)
**Relacionadas (solo contratos reutilizables)**: F05 (direcciones), F19 (checkout), F20 (pedidos), F27/F28 (motoristas), F29 (PedidosYa real)
**Estado global**: `CONTRACT_DEFINED` (contrato + spec + ADR-0013; sin API ni web; sin migración). Ver estados por componente.

## Alcance

Catálogos geográficos públicos (departamentos, municipios), zonas de entrega **propias** del restaurante por sucursal
(`delivery_zones`), configuración logística por sucursal (`branch_delivery_settings`), comprobación pública de cobertura **por
proveedor** (`PEDIDOSYA`, `OWN`) y los servicios de dominio que F19/F20 reutilizarán. Fuera: checkout, pedidos, motoristas,
PedidosYa real (F29), direcciones de cliente (F05), horarios y cierres (F08), ETA/cotización de reparto, RBAC/auth.

## Estados por componente

| Componente                                                                           | Estado                                    | Nota                                                                              |
| ------------------------------------------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------- |
| Catálogos `departments`/`municipalities` (+ seed) y `GET /v1/locations/*`            | `CONTRACT_DEFINED` → READY al implementar | Seed parcial de municipios (D9): carga pendiente de fuente oficial                |
| Zonas propias (`delivery_zones`) + `/v1/admin/delivery-zones*`                       | `CONTRACT_DEFINED` → READY al implementar | Sin dependencia externa                                                           |
| Config por sucursal (`branch_delivery_settings`) + `/delivery-settings`              | `CONTRACT_DEFINED` → READY al implementar | Flags administrativos                                                             |
| Cobertura propia (`OwnDeliveryCoverageService`) y `POST /v1/delivery-coverage/check` | `CONTRACT_DEFINED` → READY al implementar | El resultado `OWN` es real (depende solo de datos del restaurante)                |
| Adaptador simulado `MockPedidosYaCoverageAdapter`                                    | `MOCK_READY` (al implementar)             | Solo desarrollo/pruebas; jamás en producción; no autoriza nada real               |
| Cobertura REAL de PedidosYa                                                          | **`BLOCKED_EXTERNAL`**                    | Sin API, sandbox ni credenciales. Hoy `coverageStatus = UNKNOWN`. Pertenece a F29 |

F09 **no** es una integración externa completa: existir un mock no cambia el estado de PedidosYa.

## Hechos verificados del repo

- `departments`, `municipalities`, `delivery_zones` están en el DBML (`docs/references/monsushi_dbdiagram.dbml:47-69`) pero NO en migraciones
  (0001–0006) ni en `schema.prisma`: migración `0007` incremental no destructiva. `customer_addresses.municipality_id` (DBML:83) y
  `customer_addresses.zone text` libre (DBML:85) pertenecen a F05; F09 no las crea.
- Permisos F03 vigentes (migración 0005, líneas 87 y 145): `branches.read` y `branches.manage_delivery_zones`. Hoy `manager` solo tiene
  `branches.read` (0005:192); `manage_delivery_zones` solo lo tiene `admin`. F09 NO toca RBAC (ver pendientes).
- Patrones a reutilizar: `AuthorizationService.scopeFor/canAccess` (fuera de alcance = 404), `AuditService.record(tx, …)` (misma
  transacción), `AllExceptionsFilter` con `code`/`violations`, `no-store` admin por prefijo, paginación `page/pageSize/total`
  (`AdminBranchPage`), `@RequireStaff('permiso')` por método, validación de entorno con zod (`src/config/env.ts`).
- Web actual (mock, `MOCK_ONLY`): cobertura como `Branch.coverage: CoverageRule[]` con **tiers** `near|mid|extended|far`
  (tarifas fijas 15/20/25/30 + ETA en `mocks/fixtures/store.ts`, `DELIVERY_TIER_SEEDS`); selector departamento→municipio→zona numérica
  `1..MAX_ZONE` en `features/checkout/components/AddressFields.tsx`, lista `StoreConfig.departments` (3 departamentos de ejemplo:
  `mocks/fixtures/store.ts:42-65`); `coveringBranch` (`features/checkout/coverage.ts`); `GET /v1/delivery/quote` simulado
  (`mocks/handlers/public.ts`); `BranchesScreen` muestra `coverageLabels` y radio (`bo-admin/components/BranchesScreen.tsx:259-264`);
  `DispatchModal` simula PedidosYa (`bo-deliveries`). Gap B7 (`docs/database/schema-gap-analysis.md:29`): el prototipo habla de «radio»;
  el modelo vigente es municipio/zona → **ADR-0013 cierra B7 a favor de municipio + zona** (el radio queda descartado).
- Colisión de nombres: el contrato ya tenía los esquemas draft `Department` y `Municipality` (forma del mock). Se renombraron a
  `DraftDepartment`/`DraftMunicipality` (como F08 con `DraftBranchHours`); `models.ts` mantiene el alias `Department` → `DraftDepartment`
  (cambio de 1 línea; `pnpm --filter sushimon-web typecheck` verde). La web de F09 migra a los esquemas nuevos y retira los drafts.

## Decisiones

- **D1 Dos proveedores independientes**. `PEDIDOSYA` (principal; integración `BLOCKED_EXTERNAL`) y `OWN` (zonas del restaurante). Se evalúan
  y se reportan por separado; NO existe un booleano `covered`. Las zonas propias no reemplazan ni implican cobertura de PedidosYa y viceversa.
- **D2 PedidosYa = `UNKNOWN` sin integración verificable**. Estados `AVAILABLE | UNAVAILABLE | UNKNOWN`; `UNKNOWN` ≠ `UNAVAILABLE` ≠ `AVAILABLE`.
  Adaptador por defecto (y único posible en producción): `UnavailableIntegrationAdapter` → `UNKNOWN`, `reason = INTEGRATION_NOT_CONFIGURED`,
  `integrationStatus = BLOCKED_EXTERNAL`. `quoteStatus` = `NOT_AVAILABLE` (cobertura y cotización son conceptos separados; no se asume
  endpoint separado ni tarifas/tiempos/estados de PedidosYa).
- **D3 Enums** (abiertos: los clientes toleran valores futuros): `integrationStatus` ∈ `BLOCKED_EXTERNAL | MOCK | LIVE` (`LIVE` reservado a F29;
  F09 nunca lo emite); `reason` ∈ `PROVIDER_DISABLED | INTEGRATION_NOT_CONFIGURED | PROVIDER_TIMEOUT | PROVIDER_ERROR | INVALID_REQUEST |
PROVIDER_UNDETERMINED | NO_ZONE_COVERAGE`. Son códigos NUESTROS; nunca se reenvía texto, código ni payload del proveedor.
- **D4 Flags por sucursal** (`branch_delivery_settings`, 1:1 con `branches`): `ownDeliveryZonesEnabled` default **false**; `pedidosyaEnabled`
  default **true** (proveedor principal). `pedidosyaEnabled` es un indicador **administrativo**: no habilita operaciones reales ni equivale a
  integración operativa (la respuesta de settings añade `pedidosyaIntegrationStatus` para que la UI lo diga). **Fila ausente = defaults, sin
  backfill**: los defaults viven en UN solo lugar del código (constante) y coinciden con los `DEFAULT` de columna; GET sin fila devuelve
  defaults con `isDefault=true`, `updatedAt=null`; el primer PATCH hace `INSERT … ON CONFLICT (branch_id) DO UPDATE` (lazy upsert). F07 no
  crea la fila. Desactivar zonas propias NO borra zonas, motoristas, entregas en curso ni pedidos; solo impide nuevas elegibilidades.
- **D5 Zonas propias** (`delivery_zones`): `branch_id`, `municipality_id`, `zone_label` (NULL permitido), `zone_key`, `base_fee numeric(12,2)`,
  `active`, `version`, `created_at`, `updated_at`. Sin borrado físico: solo `PATCH …/status`. Columnas nuevas respecto al DBML (`zone_key`,
  `version`, `created_at`, `updated_at`) justificadas en ADR-0013. La tabla es nueva, así que no hay riesgo de migrar datos.
- **D6 Normalización de `zone_label`** (la API es la única fuente; documentada y probada): NFC → eliminar caracteres de control → recorte →
  colapso de cualquier secuencia de espacios (Unicode `\s`) a un espacio → vacío ⇒ `NULL`; máx. 60 caracteres tras normalizar (400 si excede o
  trae caracteres de control). **Etiqueta legible** (`zone_label`) conserva mayúsculas y acentos. **Clave** (`zone_key`) = etiqueta normalizada →
  NFD → quitar marcas diacríticas → minúsculas (`toLowerCase`, sin dependencias nuevas) → `''` si la etiqueta es NULL. NO se normalizan ceros a
  la izquierda ni sinónimos (`"Zona 4"` ≠ `"4"` ≠ `"04"`): el cliente web emite la misma etiqueta que el backoffice (D19). La comprobación pública
  aplica la misma función a `zone`.
- **D7 Unicidad lógica y NULL explícito**: `UNIQUE (branch_id, municipality_id, zone_key)` sobre TODAS las filas (activas e inactivas). Como
  `zone_key = ''` para NULL, **no hay hueco de NULL**: a lo sumo UNA cobertura general por (sucursal, municipio). `NULL` significa
  **cobertura general del municipio**. Crear un duplicado de una zona inactiva => 409 (se reactiva la existente; no se crea otra). CHECK de
  coherencia: `(zone_label IS NULL AND zone_key = '') OR (zone_label IS NOT NULL AND zone_key <> '')`, y `zone_key = btrim(zone_key)`,
  `zone_key = lower(zone_key)`, sin dobles espacios. Duplicados concurrentes: gana el primero; el segundo recibe `23505` sobre
  `delivery_zones_branch_municipality_zone_key` ⇒ 409 `DELIVERY_ZONE_DUPLICATE` (nunca 500).
- **D8 Prioridad y no ambigüedad** (`OwnDeliveryCoverageService`): sobre filas **activas** de (branch, municipality) con
  `zone_key IN (claveDeZone, '')`: **zona específica > cobertura general del municipio > sin cobertura**. Por D7 hay a lo sumo 2 candidatas
  (una por clave): no se elige «la primera». Sin `zone` solo puede aplicar la general. `zone` informada pero sin zona específica coincidente ⇒
  cae a la general si existe, si no `UNAVAILABLE` (`reason NO_ZONE_COVERAGE`). Una zona **inactiva se ignora como si no existiera** (no
  funciona como exclusión: si hay cobertura general activa, el cliente de esa zona la recibe). Excluir una zona dentro de un municipio con
  cobertura general queda **pendiente** (requeriría un tipo «excluida»; no es decisión de F09).
- **D9 Seed geográfico** (migración 0007, `ON CONFLICT DO NOTHING`, idempotente, sin `id` fijos: los UUID son por entorno):
  - **22 departamentos** de Guatemala (hecho conocido): Alta Verapaz, Baja Verapaz, Chimaltenango, Chiquimula, El Progreso, Escuintla, Guatemala,
    Huehuetenango, Izabal, Jalapa, Jutiapa, Petén, Quetzaltenango, Quiché, Retalhuleu, Sacatepéquez, San Marcos, Santa Rosa, Sololá,
    Suchitepéquez, Totonicapán, Zacapa.
  - **17 municipios del departamento de Guatemala** (lista aportada por el usuario; cotejar con INE antes de producción): Guatemala, Santa
    Catarina Pinula, San José Pinula, San José del Golfo, Palencia, Chinautla, San Pedro Ayampuc, Mixco, San Pedro Sacatepéquez, San Juan
    Sacatepéquez, San Raymundo, Chuarrancho, Fraijanes, Amatitlán, Villa Nueva, Villa Canales, San Miguel Petapa.
  - **PENDIENTE**: municipios de los otros 21 departamentos (~320) no se siembran ni se inventan; se cargan en una migración posterior
    desde fuente oficial (INE) verificada por una persona. Hasta entonces esos departamentos devuelven `items: []` y la tienda solo permite
    entrega en el departamento de Guatemala. Los ejemplos del mock (Antigua, Jocotenango, Escuintla…) desaparecen al migrar a http.
  - Solo lectura vía API; sin endpoints de alta de catálogos (cambian por migración).
- **D10 Catálogos públicos** (`listLocationDepartments`, `listLocationMunicipalities`): sin auth; ordenados en la **API** con
  `Intl.Collator('es', { sensitivity: 'base' })` + desempate por `id` (conjuntos pequeños; la colación de BD no es fiable entre entornos). Sin
  paginación (22 departamentos; ≤ ~340 municipios). `Cache-Control: public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400` solo en
  2xx (los errores `no-store`, central). `municipalities` exige `departmentId`: ausente/no UUID ⇒ 400; UUID inexistente ⇒ 404
  `DEPARTMENT_NOT_FOUND` (el departamento es el padre de la sub-colección); existente sin municipios ⇒ 200 `[]`. Una consulta indexada por
  `department_id` (el UNIQUE `(department_id, name)` la cubre) + comprobación de existencia en la misma consulta (`EXISTS`).
- **D11 Dinero**: `baseFee` es **string decimal** en la API (`"15.00"`; entrada con 0–2 decimales, salida siempre 2), `numeric(12,2)` en BD,
  `CHECK (base_fee >= 0 AND base_fee <= 99999.99)` (el tope es técnico anti-error de captura, revisable; `0.00` válido = envío gratis). Un
  número JSON ⇒ 400. En la API se parsea a `Prisma.Decimal`/texto, jamás `Number`; leer con `::text` si el cliente tipado no garantiza exactitud.
  **El frontend nunca decide el precio**: muestra el `baseFee` devuelto; F19/F20 lo recalculan en servidor y lo congelan como snapshot.
- **D12 Concurrencia** — `PATCH /admin/delivery-zones/{id}`: **optimista con `version` entero** (`expectedVersion` obligatorio; `UPDATE … WHERE
id AND version = $v` ⇒ 0 filas = 409 `DELIVERY_ZONE_VERSION_CONFLICT`; sin candados, sin `lock_timeout`). Elegido sobre «último gana»
  porque la tarifa es un dato monetario y los cambios simultáneos silenciosos son costosos (a diferencia del `reason` de cierres, F08 B2).
  `PATCH …/status` y `PATCH …/delivery-settings` fijan valores explícitos: idempotentes, **último gana** (documentado); un cambio real de
  estado también sube `version`. PATCH sin cambios reales ⇒ 200 sin escribir, sin subir `version`, sin auditar.
- **D13 Inmutables**: `branchId` y `municipalityId` de una zona no se editan (otra identidad ⇒ nueva zona; evita mover zonas entre sucursales
  y reduce superficie de alcance). PATCH acepta solo `zoneLabel` y `baseFee`; `active` solo por `…/status`.
- **D14 Seguridad admin**: JWT → personal activo → aal2 → `@RequireStaff('branches.read')` en los GET, `@RequireStaff('branches.manage_delivery_zones')`
  en POST/PATCH; alcance por sucursal con `scopeFor(permiso)`/`canAccess` (nunca la unión plana). Fuera de alcance o inexistente ⇒ 404 (listado
  con `branchId` ajeno ⇒ 404; sin filtro ⇒ solo sus sucursales). Una sucursal **inactiva SÍ admite** zonas y settings (preparar antes de
  activar). `Cache-Control: no-store` (incluye 401/403). Sin PII. UUID en rutas validados (400).
- **D15 Auditoría** (misma transacción, solo diff real, `branch_id` = sucursal): `delivery_zone.created` (new: label, municipio, baseFee,
  active), `delivery_zone.updated` (old/new de los campos cambiados), `delivery_zone.status_changed` (old/new `active`, `reason?`),
  `branch_delivery_settings.updated` (old/new de los flags cambiados; `entity_id` = `branch_id`; incluye el alta implícita). Importes como string.
- **D16 Servicios de dominio** (módulo `src/delivery-coverage/`, exporta tokens/puertos):
  - `OwnDeliveryCoverageService.evaluate({ branchId, municipalityId, zone?, tx? }) → { status: 'AVAILABLE'|'UNAVAILABLE', deliveryZoneId: string|null,
baseFee: string|null, currency: 'GTQ', matchedBy: 'ZONE'|'MUNICIPALITY'|null, reason? }`. Lee el flag; si está apagado devuelve `UNAVAILABLE` con
    `reason PROVIDER_DISABLED` **sin consultar zonas**. Si está encendido, **una consulta acotada** por la clave `(branch, municipality,
zone_key IN (…))` con `active` (índice del UNIQUE; sin cargar la tabla). Asume `branchId` y `municipalityId` ya validados.
  - `DeliveryCoverageService.check({ branchId, municipalityId, zone?, tx? }) → DeliveryCoverageResult` (idéntico al cuerpo HTTP): **algoritmo
    único** (valida sucursal activa y municipio; lee settings; evalúa `OWN` y, solo si `pedidosyaEnabled`, consulta el puerto; deriva
    `eligibility`). El endpoint público y F19/F20 lo llaman; nadie lo reimplementa. Exportado como puerto `DELIVERY_COVERAGE_PORT`.
  - `CourierCoveragePort` (token `COURIER_COVERAGE_PORT`): `checkCoverage({ branchId, municipalityId, zone? }) → { provider: 'PEDIDOSYA', status:
'AVAILABLE'|'UNAVAILABLE'|'UNKNOWN', integrationStatus, reason? }`. Entrada deliberadamente mínima: F29 la amplía de forma aditiva
    cuando exista documentación (coordenadas, etc.); nada se asume. Neutral: sin tipos de PedidosYa.
  - Adaptadores: `UnavailableIntegrationAdapter` (**defecto y producción**, sin red) y `MockPedidosYaCoverageAdapter` (determinista, sin red,
    sin reloj aleatorio) con escenarios `available | unavailable | unknown | timeout | provider_error | invalid_request` → resultado:
    AVAILABLE / UNAVAILABLE / UNKNOWN(`PROVIDER_UNDETERMINED`) / UNKNOWN(`PROVIDER_TIMEOUT`) / UNKNOWN(`PROVIDER_ERROR`) / UNKNOWN(`INVALID_REQUEST`).
    El mock siempre reporta `integrationStatus = MOCK`.
- **D17 Selección del adaptador (config)**: `PEDIDOSYA_COVERAGE_ADAPTER` ∈ `unavailable` (default; vacío = default) | `mock`;
  `PEDIDOSYA_MOCK_SCENARIO` ∈ los 6 escenarios (default `unknown`; solo válido con `mock`, si no ⇒ error de arranque);
  `PEDIDOSYA_COVERAGE_TIMEOUT_MS` (entero 100–10000, default 3000: tope técnico del orquestador, no un SLA de PedidosYa). Validado con zod en
  `validateEnv`; **`mock` con `NODE_ENV=production` ⇒ la API NO arranca** (mensaje sin valores). Staging con `NODE_ENV=production` tampoco admite
  el mock (conservador; excepción solo con ADR). Al arrancar con mock se registra un aviso (sin secretos). No hay credenciales falsas ni variables
  de URL/token: F29 las definirá.
- **D18 Timeouts y errores de proveedor**: el orquestador envuelve la llamada al puerto con deadline (`PEDIDOSYA_COVERAGE_TIMEOUT_MS`) y `try/catch`.
  Timeout ⇒ `UNKNOWN` + `PROVIDER_TIMEOUT`; excepción ⇒ `UNKNOWN` + `PROVIDER_ERROR`; solicitud inválida ⇒ `UNKNOWN` + `INVALID_REQUEST`. **Nunca**
  `UNAVAILABLE` por error ni 5xx por culpa del proveedor; el detalle se registra solo con `requestId` y nombre de la clase de error (sin cuerpo).
  Sin reintentos, sin circuit breaker y **sin caché** del resultado externo en F09 (F29 decide con la documentación). `OWN` se evalúa
  siempre aunque PedidosYa falle. Las dos evaluaciones corren en paralelo; presupuesto de consultas del endpoint ≤ 2 (contexto sucursal+settings+municipio;
  zonas), todas por clave.
- **D19 `POST /v1/delivery-coverage/check`** (público, no-store, no crea pedido ni solicita motorista): cuerpo `{ branchId, municipalityId,
zone? }`, `additionalProperties: false` (un `fee`/`deliveryFee`/`total` del cliente ⇒ 400). Respuesta: `providers.PEDIDOSYA`
  `{ enabled, coverageStatus, integrationStatus, quoteStatus, reason? }` y `providers.OWN { enabled, coverageStatus, deliveryZoneId, baseFee,
currency, matchedBy, reason? }`, más `eligibility`, `checkedAt` (ISO UTC con ms, reloj del servidor) y `zone` normalizada. `enabled=false` se
  expresa separado de la disponibilidad geográfica (el consumidor lee `enabled` primero; con `enabled=false` el `coverageStatus` es solo un
  marcador: `UNAVAILABLE` en `OWN`, `UNKNOWN` en `PEDIDOSYA`, con `reason PROVIDER_DISABLED`, y el proveedor externo NO se consulta). NO
  considera horarios/cierres (F08 se combina en checkout; F09 no importa `branch-schedule`). La recogida no depende de cobertura: el endpoint
  no la menciona. Errores: sucursal inexistente **o inactiva** ⇒ 422 `BRANCH_NOT_AVAILABLE` (no se distingue); municipio inexistente ⇒ 422
  `MUNICIPALITY_NOT_FOUND`; ambos con `violations[{path, code, message}]`. Se usa 422 (no 404) porque son referencias dentro del cuerpo de un
  POST que existe; en cambio `departmentId` de `GET /locations/municipalities` (padre de la ruta) da 404. Coherente con F08: forma ⇒ 400, regla
  de negocio/referencia ⇒ 422.
- **D20 Elegibilidad derivada** (`eligibility`: `status`, `confirmedProviders`, `pendingProviders`, `simulated`): `confirmed` = habilitado y
  `AVAILABLE`; `pending` = habilitado (solo `PEDIDOSYA`) y `UNKNOWN`; `status` = `CONFIRMED` si hay confirmados, si no `PENDING` si hay pendientes,
  si no `NONE`; `simulated` = el dato de PedidosYa viene de un adaptador `MOCK`. **`simulated=true` jamás autoriza operaciones reales**: F20 debe
  rechazar solicitud real a PedidosYa si `integrationStatus ≠ LIVE`. PedidosYa deshabilitado no entra en `confirmed` ni `pending`.
- **D21 Caché**: catálogos públicos (D10); cobertura y admin `no-store`; nada de caché de resultados externos. La respuesta de cobertura es
  orientativa: F20 vuelve a validar en servidor al crear el pedido con `DeliveryCoverageService.check`. Abuso: el endpoint público toca BD (y
  en F29 un proveedor externo); hoy solo rige el throttler global. **Recomendación (security-reviewer)**: límite por IP más estricto en esta ruta antes
  de habilitar F29 (no hay patrón `@Throttle` por ruta en el repo; no se inventa aquí).
- **D22 Módulos API**: `src/locations/` (catálogos, sin dependencias salvo base de datos) y `src/delivery-coverage/` (zonas admin, settings,
  servicios, puerto y adaptadores; depende de `BranchesQueryService` F07, `AuthorizationService` F03, `AuditService`). No depende de
  `branch-schedule`. F19/F20 importan `DeliveryCoverageModule`.

### Escenarios de elegibilidad (A–G), `PEDIDOSYA.enabled = true`

| #   | PEDIDOSYA   | OWN (enabled, status) | `confirmedProviders` | `pendingProviders` | `eligibility.status` | Lectura                                         |
| --- | ----------- | --------------------- | -------------------- | ------------------ | -------------------- | ----------------------------------------------- |
| A   | AVAILABLE   | off                   | `[PEDIDOSYA]`        | `[]`               | `CONFIRMED`          | Solo PedidosYa                                  |
| B   | AVAILABLE   | on, AVAILABLE         | `[PEDIDOSYA, OWN]`   | `[]`               | `CONFIRMED`          | Ambos                                           |
| C   | UNAVAILABLE | on, AVAILABLE         | `[OWN]`              | `[]`               | `CONFIRMED`          | Solo propios                                    |
| D   | UNAVAILABLE | off                   | `[]`                 | `[]`               | `NONE`               | Ninguno confirmado                              |
| E   | UNKNOWN     | off                   | `[]`                 | `[PEDIDOSYA]`      | `PENDING`            | Ninguno confirmado (hoy, sucursal con defaults) |
| F   | UNKNOWN     | on, AVAILABLE         | `[OWN]`              | `[PEDIDOSYA]`      | `CONFIRMED`          | Propios confirmados; PedidosYa pendiente        |
| G   | UNKNOWN     | on, UNAVAILABLE       | `[]`                 | `[PEDIDOSYA]`      | `PENDING`            | Ninguno confirmado                              |

A, B y C solo pueden ocurrir con `PEDIDOSYA = AVAILABLE/UNAVAILABLE` si el adaptador es mock (`simulated=true`) o, en el futuro, `LIVE` (F29).
Con la integración bloqueada solo existen E, F y G (y los equivalentes con PedidosYa deshabilitado: `pending = []`). Qué hace checkout con
`PENDING`/`NONE` (bloquear domicilio, ofrecer recogida…) es decisión de F19; F09 solo entrega el hecho.

## Modelo de datos (propuesta para `database-engineer`, migración `0007_delivery_geography_coverage`)

```
app.departments        (id uuid pk default gen_random_uuid(), name text not null unique)             -- DBML tal cual
app.municipalities     (id uuid pk, department_id uuid not null FK departments RESTRICT, name text not null,
                        UNIQUE (department_id, name))                                                -- DBML tal cual
app.delivery_zones     (id uuid pk, branch_id uuid not null FK branches RESTRICT,
                        municipality_id uuid not null FK municipalities RESTRICT,
                        zone_label text null, zone_key text not null default '',
                        base_fee numeric(12,2) not null default 0, active boolean not null default true,
                        version integer not null default 1, created_at timestamptz not null default now(),
                        updated_at timestamptz not null default now(),
                        CONSTRAINT delivery_zones_branch_municipality_zone_key UNIQUE (branch_id, municipality_id, zone_key),
                        CHECK base_fee >= 0 AND base_fee <= 99999.99, CHECK version >= 1,
                        CHECK (zone_label IS NULL AND zone_key = '') OR (zone_label IS NOT NULL AND zone_key <> ''),
                        CHECK zone_label NULL o (zone_label = btrim(zone_label) AND char_length BETWEEN 1 AND 60),
                        CHECK zone_key = lower(zone_key) AND zone_key = btrim(zone_key) AND zone_key !~ '\s{2,}')
app.branch_delivery_settings (branch_id uuid pk FK branches RESTRICT, own_delivery_zones_enabled boolean not null default false,
                        pedidosya_enabled boolean not null default true, created_at timestamptz not null default now(),
                        updated_at timestamptz not null default now())
```

- Índices: el UNIQUE de zonas cubre lecturas por `(branch, municipality[, zone_key])` y por sucursal; añadir `delivery_zones_municipality_idx
(municipality_id)` (FK y filtro `municipalityId`). Municipios: el UNIQUE `(department_id, name)` cubre FK y consulta por departamento. Sin índice
  trigram: `q` filtra `zone_key LIKE` dentro de un conjunto acotado por sucursal.
- `ON DELETE RESTRICT` en todas las FK (la configuración y el historial no se borran en cascada; la sucursal no se elimina, F07).
- RLS: `ENABLE ROW LEVEL SECURITY` sin políticas y `REVOKE ALL … FROM PUBLIC` (y `anon`/`authenticated` si existen), igual que 0006.
- `updated_at`/`version`: los mantiene la API en el `UPDATE` (sin triggers). `zone_key` lo calcula la API (D6); la BD solo valida coherencia (no
  hay `unaccent` inmutable).
- Seed D9 dentro de la migración con `INSERT … ON CONFLICT DO NOTHING` (municipios por `SELECT id FROM departments WHERE name = 'Guatemala'`).
- No toca `customer_addresses` (F05), RBAC (0005) ni `audit_events`. Prisma: modelos `Department`, `Municipality`, `DeliveryZone`,
  `BranchDeliverySettings`; leer/escribir `base_fee` con `::text`/`Decimal`. Pruebas: PGlite aplicando 0001..0007 + `test/migration-0007.int-spec.ts`.
- Reversión manual: `DROP TABLE` de las cuatro (sin dependientes hasta F05); describirla en el encabezado del SQL.

## Errores

Cuerpo base `ErrorResponse` + `code` + `violations` (F08).

| HTTP | `code`                           | Operación                    | Cuándo                                                                                                                                                |
| ---- | -------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 400  | —                                | todas                        | Forma (UUID, `baseFee` no decimal/negativo/>99999.99/número JSON, `zoneLabel` >60 o con control, `expectedVersion` ausente, propiedades desconocidas) |
| 404  | `DEPARTMENT_NOT_FOUND`           | `listLocationMunicipalities` | UUID válido de departamento inexistente                                                                                                               |
| 404  | —                                | admin                        | Zona/sucursal inexistente o fuera de alcance                                                                                                          |
| 409  | `DELIVERY_ZONE_DUPLICATE`        | create, update               | Ya existe (activa o inactiva) la misma clave; `violations[0] = {path:'deliveryZones/<id>', code:'DUPLICATE_ZONE'}`; también por carrera (`23505`)     |
| 409  | `DELIVERY_ZONE_VERSION_CONFLICT` | update                       | `expectedVersion` ≠ `version` vigente                                                                                                                 |
| 422  | `MUNICIPALITY_NOT_FOUND`         | create, check                | `municipalityId` inexistente; `violations[0].path = 'municipalityId'`                                                                                 |
| 422  | `BRANCH_NOT_AVAILABLE`           | check                        | `branchId` inexistente o inactiva (no se distingue); `violations[0].path = 'branchId'`                                                                |

Adicionales (ronda de seguridad): 429 `RATE_LIMITED` en `checkDeliveryCoverage` (30/min por IP) y `listLocation*` (60/min por IP), `no-store`, con
`Retry-After`; requiere `TRUST_PROXY_HOPS >= 1` tras un proxy (bloqueante de despliegue, ver `docs/security/README.md`). El mock de PedidosYa solo
arranca con `NODE_ENV` explícito `development|test`. `reason` de `PATCH …/status` es texto libre de operador y NO debe contener datos personales. La
búsqueda `q` del listado es literal (`%`, `_`, `\` no son comodines).

El `ErrorResponse.error` sigue siendo el nombre HTTP. Los 5xx nunca incluyen `code`/`violations` (filtro central, F08).

## Contrato (resumen)

| `operationId`                       | Método y ruta                                     | Permiso                          | Caché                                             |
| ----------------------------------- | ------------------------------------------------- | -------------------------------- | ------------------------------------------------- |
| `listLocationDepartments`           | GET `/v1/locations/departments`                   | público                          | `public, max-age=3600, s-maxage=86400, swr=86400` |
| `listLocationMunicipalities`        | GET `/v1/locations/municipalities?departmentId=`  | público                          | ídem                                              |
| `listAdminDeliveryZones`            | GET `/v1/admin/delivery-zones`                    | `branches.read`                  | `no-store`                                        |
| `createAdminDeliveryZone`           | POST `/v1/admin/delivery-zones`                   | `branches.manage_delivery_zones` | `no-store`                                        |
| `getAdminDeliveryZone`              | GET `/v1/admin/delivery-zones/{id}`               | `branches.read`                  | `no-store`                                        |
| `updateAdminDeliveryZone`           | PATCH `/v1/admin/delivery-zones/{id}`             | `branches.manage_delivery_zones` | `no-store`                                        |
| `updateAdminDeliveryZoneStatus`     | PATCH `/v1/admin/delivery-zones/{id}/status`      | `branches.manage_delivery_zones` | `no-store`                                        |
| `getAdminBranchDeliverySettings`    | GET `/v1/admin/branches/{id}/delivery-settings`   | `branches.read`                  | `no-store`                                        |
| `updateAdminBranchDeliverySettings` | PATCH `/v1/admin/branches/{id}/delivery-settings` | `branches.manage_delivery_zones` | `no-store`                                        |
| `checkDeliveryCoverage`             | POST `/v1/delivery-coverage/check`                | público                          | `no-store`                                        |

Listado de zonas: filtros `branchId`, `departmentId`, `municipalityId`, `active`, `q` (etiqueta; contiene, case/acento-insensible vía `zone_key`),
`sort` (`municipality|baseFee|createdAt`, default `municipality`), `order`, `page` (≤ 10 000), `pageSize` (≤ 100, default 20); misma forma
`items/page/pageSize/total` que `AdminBranchPage`. Orden por municipio en BD: departamento, municipio, zona general primero, `zone_key`, `id`
(la colación de BD en el panel es aceptable; los catálogos públicos se ordenan en la API).

## Contrato con F19/F20 (otro desarrollador): qué consumen

- **Servicio**: `DeliveryCoverageService.check({ branchId, municipalityId, zone?, tx? })` (token `DELIVERY_COVERAGE_PORT`) para validar cobertura y
  tarifa **en servidor** al crear el pedido; de `providers.OWN` toman `deliveryZoneId` y `baseFee` (string GTQ) para el **snapshot**; nunca
  confían en un monto del cliente. Si `OWN.coverageStatus ≠ AVAILABLE` o `enabled=false`, no se puede asignar entrega propia.
- `OwnDeliveryCoverageService.evaluate(...)` solo si necesitan únicamente cobertura propia.
- `eligibility.simulated = true` o `integrationStatus ≠ LIVE` ⇒ no iniciar solicitud real a PedidosYa (F29 define la solicitud real).
- Horarios: combinar con `BranchAvailabilityPort` (F08) **en F19**; F09 no lo hace. Recogida: no llama a cobertura.
- Contrato HTTP público para la tienda: `checkDeliveryCoverage` y los catálogos `locations`; el `zone` se envía con la misma etiqueta que
  el backoffice (D6).
- No consumen: `deliveryQuote` (ETA y tiers del mock) — F09 no define ETA ni tarifa de PedidosYa; el `GET /v1/delivery/quote` planificado se
  redefine en F19 sobre estos servicios.

## Web (alcance; sin implementar en F09 contrato)

Reutiliza y extiende; no rediseña. Backoffice solo en español; tienda es/en, claro/oscuro, responsive, accesible por teclado.

- **Backoffice** — `bo-admin/components/BranchesScreen.tsx` (+ modal de la sucursal): sección «Entrega» con (a) switches `ownDeliveryZonesEnabled`
  y `pedidosyaEnabled` (`can(grants, 'branches.manage_delivery_zones', branchId)`; lectura con `branches.read`; hoy solo `admin`), (b) bloque
  PedidosYa con la leyenda «Integración pendiente» (`BLOCKED_EXTERNAL`) o «Simulación» (`MOCK`) y **sin ningún indicador de conexión exitosa**
  (la insignia «Simulación» ya existe en `bo-deliveries/DispatchModal`), (c) tabla de zonas propias (departamento, municipio, zona, tarifa GTQ,
  estado) con filtros, alta/edición (municipio dependiente del departamento), activar/desactivar con confirmación y recarga ante
  `DELIVERY_ZONE_VERSION_CONFLICT`/`DELIVERY_ZONE_DUPLICATE`. `bo-deliveries/DeliveryRiders` no cambia (motoristas: F27/F28). Retirar `radiusKm`/
  `coverageLabels` como fuente de cobertura (el mock `coverage`/tiers deja de usarse para decidir).
- **Tienda** — `features/checkout/components/AddressFields.tsx` y `DeliveryStep`: selectores departamento → municipio (`locations.*`) → zona
  (campo/selector con etiquetas `Zona N`; helper compartido con el backoffice para la etiqueta, D6/D19); la comprobación se dispara **al
  completar la selección** (cambio de municipio/zona confirmado, con `enabled` y sin pulsación por tecla; debounce no necesario al ser selects)
  llamando `checkDeliveryCoverage`. Mensajes: `NONE` ⇒ «sin cobertura a domicilio»; `PENDING` (PedidosYa `UNKNOWN`) ⇒ «no podemos confirmar el envío
  a domicilio en este momento» (nunca «sin cobertura» ni «cubierto»); `CONFIRMED` ⇒ tarifa de `OWN.baseFee` si aplica. **Recoger en sucursal nunca se
  bloquea.** No se muestran `integrationStatus`/`reason` crudos al cliente. Los tiers y ETA del mock (`DELIVERY_TIER_SEEDS`) y
  `StoreConfig.departments` son borradores (`MOCK_ONLY`) que F19/F17 reemplazan; en F09 solo cambia la fuente de cobertura.
- **Claves TanStack** (jerárquicas, en `features/query-keys.ts`): `locations.departments()`, `locations.municipalities(departmentId)`,
  `deliveryZones.admin(filters)` / `deliveryZones.detail(id)`, `deliverySettings.branch(branchId)`, `deliveryCoverage.check(branchId,
municipalityId, zone)`. Catálogos: `staleTime` largo (≥ 1 h). Cobertura: `staleTime` corto (≤ 30 s), `gcTime` bajo, sin refetch por foco.
  Invalidación quirúrgica: al guardar una zona invalida `deliveryZones.admin(*)` y `deliveryZones.detail(id)`; al cambiar settings
  `deliverySettings.branch(branchId)` y `deliveryCoverage.check(branchId, …)` de esa sucursal; nunca los catálogos.
- **Mock/http**: handlers mock con las mismas reglas (400/404/409/422, normalización D6, prioridad D8, escenarios A–G, PedidosYa `UNKNOWN` por
  defecto con selector de escenario solo en modo mock rotulado «Simulación»). Contrato idéntico bajo `DATA_SOURCE=http`.

## Pruebas exigidas

- Unitarias puras: normalización D6 (acentos, mayúsculas, espacios, NFC/NFD, vacío, 60 caracteres), prioridad D8 (específica / general / ninguna /
  inactiva ignorada / sin `zone`), derivación de `eligibility` (A–G, PedidosYa deshabilitado, `simulated`), aritmética de `baseFee`
  (`"15"`→`"15.00"`, `"0.1"`, rechazo de `15.001`, `-1`, número JSON), mapeo de errores y de timeout/excepción ⇒ `UNKNOWN`.
- Adaptadores: mock por escenario (6); `UnavailableIntegrationAdapter` ⇒ `UNKNOWN`; env: `mock` + `production` ⇒ error, `mock` sin escenario válido ⇒ error;
  **ningún test hace llamadas de red**.
- Integración (PGlite/BD de prueba): unicidad `(branch, municipality, key)` con NULL (dos generales ⇒ 409), carrera de duplicados, conflicto de
  versión, alcance (otra sucursal ⇒ 404), settings upsert/defaults, auditoría en la misma transacción, caché headers (públicos y `no-store`),
  seed idempotente (dos ejecuciones = mismas filas: 22 + 17), orden alfabético con acentos.
- Web: formulario de zonas, mensajes `NONE/PENDING/CONFIRMED`, recogida nunca bloqueada, claves/invalidaciones; e2e + axe.

## Tareas por dueño

1. **database-engineer**: migración `0007` (tablas, CHECK, UNIQUE, índices, seed idempotente, RLS/REVOKE, reversión), `schema.prisma`,
   `test/migration-0007.int-spec.ts`, actualizar `docs/database/README.md` (hecho como nota en este paso).
2. **api-engineer**: módulos `locations` y `delivery-coverage`; normalización D6; DTOs; repositorio con SQL acotado; servicios D16; puerto y 2
   adaptadores; `validateEnv` D17; auditoría; mapeo `23505`; `AllExceptionsFilter` ya propaga `code`/`violations`; `pnpm contracts:check` verde.
3. **web-engineer**: servicios y hooks de las 10 operaciones; handlers mock; migrar fuera de `DraftDepartment`/`DraftMunicipality`; pantallas de
   backoffice y tienda (sección anterior); i18n es/en.
4. **security-reviewer**: alcance 404, `no-store`, abuso del endpoint público, mock imposible en producción, no exposición de datos del proveedor.
5. **qa-engineer / performance-reviewer**: matriz de pruebas, presupuesto de consultas del check, caché de catálogos.
6. **ui-ux-reviewer**: mensajes PENDING/NONE, sin falso «conectado», es/en, claro/oscuro.

## Preguntas abiertas y asunciones

Asunciones (marcadas; no bloquean F09):

- **A1** Los defaults `ownDeliveryZonesEnabled=false`, `pedidosyaEnabled=true` y la lista de 17 municipios provienen del usuario/negocio; la lista debe cotejarse con INE.
- **A2** `base_fee` máximo 99999.99 y `PEDIDOSYA_COVERAGE_TIMEOUT_MS=3000` son topes técnicos, no reglas de negocio.
- **A3** Una zona inactiva no excluye; no existe «zona excluida» (D8).
- **A4** `zone` del cliente es texto libre (F05 `customer_addresses.zone`); la coincidencia exige la misma etiqueta normalizada (D6). La tienda
  usa un helper con el mismo formato que el backoffice.
- **A5** F09 no ofrece endpoint que liste las etiquetas de zona cubiertas por municipio (la tienda no puede sugerir solo zonas cubiertas); es una
  adición no destructiva posible en F19 si el negocio la quiere.
- **A6** No hay ETA ni tarifa de PedidosYa ni ETA de entrega propia en F09 (el DBML no las modela; PedidosYa no está documentado).

Decisiones de negocio pendientes (no bloquean el contrato):

1. ¿`manager` recibe `branches.manage_delivery_zones` (limitado a su sucursal)? Hoy solo `admin` gestiona zonas y flags (RBAC F03; no se toca).
2. Carga de municipios de los 21 departamentos restantes desde INE (migración posterior, verificación humana).
3. Qué permite F19 con `eligibility.status = PENDING` (p. ej. domicilio no confirmable): decisión de checkout.
4. ¿Se requiere «zona excluida» dentro de un municipio con cobertura general? (D8).
5. Modelo de ETA de reparto propio (no existe en el DBML).

Bloqueado externamente: documentación, sandbox y credenciales de PedidosYa (F29).
