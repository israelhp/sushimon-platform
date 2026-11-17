# F17 — Agregados públicos de tienda y búsqueda

**Rama**: `feature/F17-store-aggregates` (desde `develop` con F00–F16) · **Dueño**: B · **Prioridad**: P0 · **Tipo**: API + WEB
**Dependencias**: F07, F08, F10, F11, F13 (mínimo); enriquecen F12, F14, F15, F16 · **Decisiones**: `docs/adr/0023-agregados-tienda-busqueda-cache.md` · **Pendientes**: P23–P29 en `docs/business-rules/decisiones-pendientes.md`
**Estado global**: `IN_PROGRESS` — API `API_IMPLEMENTED` (probada con dobles en memoria; SQL real **sin verificar**); contrato `CONTRACT_DEFINED`; web en curso por otro ingeniero; migración `0018` **no se escribe** (P23 sin columna).

## Alcance y fuera de alcance

Dentro: `getStoreBootstrap`, `searchStoreProducts`, ampliación aditiva de `getStoreBranchMenu` y `getStoreProduct`, caché pública, claves TanStack, reemplazo de hooks de Home/menú/búsqueda/ficha.
Fuera: F18 carrito, F19 cotización/checkout/envío, F29 PedidosYa (el bootstrap no lo consulta), motores de búsqueda externos, Redis, rediseño del Home, favoritos/direcciones en respuestas públicas, `GET /v1/store/config` (sigue sin API; ver línea base).

## Estados por componente

| Componente                                                                       | Estado                                                                                                                                                             |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contrato OpenAPI (2 operaciones nuevas, 2 ampliadas, 8 esquemas) + `schema.d.ts` | `CONTRACT_DEFINED` (`contracts:generate` OK; `contracts:check` lista bootstrap/search sin implementar y que menu debe declarar 429/503)                            |
| API `src/store/`                                                                 | `API_IMPLEMENTED` (ver «Implementación F17 (API)»); SQL real sin verificar                                                                                         |
| Migración `0018` (destacados)                                                    | **no se escribe**: decisión provisional P23-sin-columna (`featured: []`)                                                                                           |
| Web (Home, menú, búsqueda, ficha)                                                | `MOCK_ONLY`: implementada con el mock fiel (sin API real ni CDN); typecheck, lint y pruebas de la web pasan; ver «Antes/Después» y `docs/ui/mock-data-strategy.md` |
| Invalidación activa de CDN                                                       | no soportada / no verificada (hosting ADR-0006 pendiente)                                                                                                          |

## Línea base (derivada por lectura; modo `http`, visitante anónimo, sucursal elegida, caché fría, catálogo ≤ 100)

### Solicitudes HTTP por pantalla

| Pantalla     | Solicitudes                                                                                                                                                                                                                  | Origen (hook → componente)                                                                                                                                                                                                                                                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inicio `/`   | **6**: `GET /v1/branches`; `GET /v1/branches/{id}/availability`; `GET /v1/store/products?page=1&pageSize=100`; `GET /v1/store/menu?branchId`; `GET /v1/store/config` (**404: no existe en la API**); `GET /v1/store/banners` | `usePublicBranches` (BranchSelectionGuard, CartDrawer); `useBranchAvailability` (CartDrawer); `useProducts` = `loadCatalog`+`useStoreBranchMenu` (ProductSheetHost, CartDrawer, FavoritesSection, HomeFootnote, LastOrderCard); `useStoreConfig` (ActionCards, OrderModeButton, StoreFooter); `useStoreBanners` (PromoCarousel). Sin sucursal: 4. |
| Menú `/menu` | **8**: las anteriores sin banners + `GET /v1/store/categories` + `GET /v1/store/promotions` ×2 (`live`, `upcoming`)                                                                                                          | `useStoreCategories`; `useHappyHour` (MenuHappyBanner, solo en «Todo» y con sucursal)                                                                                                                                                                                                                                                             |
| Búsqueda     | +1 por texto con debounce (300 ms) y +1 por «Ver más»: `GET /v1/store/products?q&page&pageSize=20`                                                                                                                           | `useStoreProductSearch`                                                                                                                                                                                                                                                                                                                           |
| Ficha (hoja) | +1: `GET /v1/store/products/{slug}`, **en cascada** tras el catálogo (necesita el slug)                                                                                                                                      | `useStoreProduct` en `ProductSheet`                                                                                                                                                                                                                                                                                                               |

Hallazgos con evidencia:

- `ProductSheetHost` (`features/catalog/components/product-sheet-host.tsx:35`) y `CartDrawer` (`CartDrawer.tsx:41`) llaman a `useProducts()` sin condición y están montados en TODA página `(public)` (`StoreShell.tsx` `StoreOverlays`): cada página carga el catálogo completo + overlay.
- `listAllStoreProducts` (`services/products.ts`) pide páginas de 100 de forma **secuencial** (> 100 productos = más solicitudes en cascada).
- El Inicio usa el catálogo entero para 4 tarjetas (`pickFavorites`), el contador del pie y el reorden; `HOME_FAVORITE_IDS` son ids del mock: en `http` no coinciden con UUID y `featured` es siempre `false` (`toCatalogProduct`), por lo que la sección sale vacía.
- `useStoreConfig` apunta a `/v1/store/config`, inexistente (`docs/contracts/planned-endpoints.md`): 404 en cada carga.
- `http-client.ts` fuerza `cache: 'no-store'` y adjunta `Authorization` si hay sesión en TODA lectura: la caché HTTP del navegador no se usa y un CDN recibiría `Cache-Control: no-cache` en la petición (efecto en Vercel: **no verificado**).
- `queryFn` del catálogo y la búsqueda no reenvían `signal` (sí lo hacen favoritos); las respuestas obsoletas se descartan por clave, pero la petición no se cancela.
- El comentario de `useStoreProductSearch` dice «nombre, descripción o SKU»; la API pública NO busca por SKU.

### Consultas a BD por solicitud (lectura de repositorios)

| Operación                                       | Consultas                                                                    | Observación                   |
| ----------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------- |
| `listStoreProducts`                             | 4 (categorías, página, total, media)                                         | total en consulta aparte      |
| `getStoreProduct`                               | 4 (categorías ∥ producto; media ∥ modificadores)                             | sin N+1                       |
| `getStoreBranchMenu`                            | 3 (sucursal ∥ categorías; overlay)                                           | todo el catálogo, sin nombres |
| `listStorePromotions`                           | 2–5 (sucursal, candidatas; con `items`: básicos ∥ categorías, `resolveMany`) |                               |
| `listStoreBanners`                              | 2–3 (sucursal, candidatos, promos vinculadas)                                |                               |
| `listStoreCategories` / `getBranchAvailability` | 1 / 1                                                                        |                               |

Inicio ≈ 1+1+4+3+3 = **~12 consultas en 6 solicitudes**; la sucursal se valida 3–4 veces. N+1: no se detectó ninguno (todas por lotes).

### Payload (estimación por esquema, NO medida)

`PublicProduct` ≈ 0,5–1,5 KB (descripción ≤ 2000, hasta 8 imágenes, categoría); 30–100 productos ≈ 15–150 KB sin comprimir para pintar 4 tarjetas. Overlay ≈ 130 B/producto. Tarjeta nueva (1 imagen, resumen ≤ 160) ≈ 0,4 KB.

### Capas de caché hoy

TanStack: `staleTime` 30 s por defecto, `gcTime` por defecto (5 min), sin refetch por foco salvo overlay/banners/promos (15 s). HTTP API: categorías/productos `public, max-age=60, swr=300`; sucursales `public, max-age=60, s-maxage=300, swr=600`; disponibilidad ≤ 10 s; menú `public, max-age=15`; promociones/banners acotados a ≤ 30 s. Next: sin `revalidate`, `use cache`, `HydrationBoundary` ni `prefetchQuery` (búsqueda en `src`); sin `vercel.json`.

### Procedimiento reproducible Antes/Después

1. **Solicitudes**: Playwright con `page.on('request')` filtrando `/v1/` (patrón de `e2e/no-external-requests.spec.ts`) contra web `DATA_SOURCE=http` + API local + BD de pruebas; o DevTools > Network. Medible localmente.
2. **Consultas Prisma**: en `*.int-spec.ts` contar operaciones con `prisma.$extends({ query: { $allOperations } })` (o `log_statement=all` en la BD desechable `DATABASE_URL_TEST`) con 10 y con 100 productos: el número debe ser constante (ausencia de N+1). Medible localmente; el soporte de `$allOperations` sobre `$queryRaw` con el adaptador `pg`: no verificado.
3. **Payload**: `curl -s -H 'Accept-Encoding: gzip' -o /dev/null -w '%{size_download}\n' URL` y sin gzip.
4. **Tiempos y `EXPLAIN (ANALYZE, BUFFERS)`** de menú/búsqueda en BD con volumen (100/1.000 productos) sembrado.
5. **No medible localmente**: aciertos de CDN (`x-vercel-cache`), latencia real Supabase/serverless, comportamiento de `Cache-Control: no-cache` de la petición en la CDN.

| Métrica                                                 | Antes (derivado, modo http)      | Después (medido: mock fiel, build de producción local)                                                                                                                                            |
| ------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Solicitudes Inicio con sucursal (visitante)             | 6 (1 inútil: `config`)           | **2**: `GET /v1/branches` (compartida por `BranchSelectionGuard` y `CartDrawer`) + `GET /v1/store/bootstrap?branchId`. `store/config` ya no se emite en http                                      |
| Solicitudes Inicio sin sucursal                         | 4                                | **2**: sucursales + bootstrap sin `branchId`                                                                                                                                                      |
| Solicitudes Inicio con sucursal y cliente con favoritos | 6 (+ las del cliente)            | **6**: las 2 anteriores + `/me/orders` + 2 lecturas de `/me/favorites` (ids y lista) + el menú de la sucursal (solo para pintar sus favoritos)                                                    |
| Solicitudes Menú                                        | 8                                | **5**: sucursales, categorías, menú, promociones `live` y `upcoming` en modo `compact`; **+1** (`availability`) al abrir el carrito                                                               |
| Solicitudes por búsqueda de 3 caracteres tecleados      | 1 (pág. 20, catálogo ya cargado) | **1** (`GET /v1/store/search?q&branchId`, tras el debounce de 300 ms; la anterior se cancela con `AbortSignal`)                                                                                   |
| Solicitudes ficha                                       | 1 en cascada tras el catálogo    | **1** (`GET /v1/store/products/{slug}?branchId`), sin cascada ni catálogo; abierta desde una tarjeta con slug                                                                                     |
| Consultas BD Inicio                                     | ~12                              | pendiente de la API (api-engineer / qa-engineer)                                                                                                                                                  |
| Consultas BD menú / búsqueda / ficha                    | 3+4 / 4 / 4                      | pendiente de la API                                                                                                                                                                               |
| Payload Inicio                                          | ~15–150 KB estimado (no medido)  | no medido (mock en memoria)                                                                                                                                                                       |
| Catálogo completo en páginas sin relación               | sí (toda página pública)         | **no**: `ProductSheetHost` y `CartDrawer` consultan solo bajo demanda; el menú completo (≤ 100 productos = 1 solicitud) solo en menú, checkout, favoritos, reorden, promociones y carrito abierto |

Cómo se midió (web): `e2e/store-aggregates.spec.ts`. El adaptador mock no emite solicitudes de red, así que no se pueden contar con `page.on('request')`; el adaptador anota cada solicitud en `window.__sushimonMockRequests` (instrumentación solo de pruebas) y `page.on('request')` comprueba que no hay ninguna `/v1/` real. Se excluyen `GET /v1/store/config` (solo existe en el mock) y `/v1/demo/*`. Contra `next start` (producción): en `next dev`, StrictMode repite una vez las consultas que reciben `signal` (artefacto de desarrollo). **Corrección**: la cifra «Inicio 6→1» NO se cumple; el Inicio hace 2 (sucursales + bootstrap) porque `BranchSelectionGuard` necesita la lista pública de sucursales (otra clave, otro TTL: 5–15 min). Un solo cambio barato hizo falta para llegar a 2: no consultar los agregados por sucursal hasta que el cliente lea la sucursal de localStorage (`useClientReady`); sin él, cada carga emitía una solicitud «sin sucursal» que se descartaba al hidratar.

Defectos del contrato detectados por la web (no corregidos aquí): (1) `StoreBranchMenuItem` solo marca `required` `productId`, `slug`, `price` y `available`, aunque la descripción dice que el servidor SIEMPRE envía `name`, `summary`, `image`, `category` y `promo`: los tipos generados los vuelven opcionales y la web tolera su ausencia; (2) `available=false` no está definido (¿solo agotados o sin filtro?): el mock lo trata como sin filtro; (3) `schema.d.ts` no refleja `compact` de `listStorePromotions` (está en `openapi.yaml`; falta `contracts:generate`); (4) no se define qué error gana en la ficha si el producto y la sucursal no existen (el mock devuelve `PRODUCT_NOT_FOUND`); (5) el orden de desempate entre promociones iguales no está en el contrato (el mock usa mayor ahorro, vence antes, `id`).

## Decisiones

### D1 Qué se reutiliza, amplía y crea

| Operación                                                                                              | Decisión                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `listStoreCategories`, `listStoreProducts`, `listStorePromotions`, `listStoreBanners`, `/v1/branches*` | Sin cambios. `listStoreProducts` queda para favoritos/administración y como lectura sin sucursal heredada; deja de usarse en menú e Inicio.                                                                                                                                                  |
| `getStoreBootstrap`                                                                                    | **Nuevo**.                                                                                                                                                                                                                                                                                   |
| `searchStoreProducts`                                                                                  | **Nuevo**.                                                                                                                                                                                                                                                                                   |
| `getStoreBranchMenu`                                                                                   | **Ampliado** (aditivo + 2 relajaciones): tarjetas, `branchId` opcional, `categorySlug`, `available`, `sort`, `order`, `page`, `pageSize` (≤ 100, por defecto 100), `total`, `generatedAt`, `nextChangeAt`. Cubre «menú con filtros» salvo búsqueda de texto (eso es `search`, sin duplicar). |
| `getStoreProduct`                                                                                      | **Ampliado**: `?branchId` añade `offer`, `promotions`, `generatedAt`, `nextChangeAt`; sin él, idéntico a hoy. Ya traía categoría, imágenes F14 y grupos F12. Sin totales (F19) ni carrito (F18).                                                                                             |

Impacto en consumidores: solo la web (sin otros clientes; API sin publicar). `available` pasa a `boolean | null` y `branchId` de `StoreBranchMenu` a nullable: **un error de TS** en `catalog-product.ts:81` (`applyBranchMenu`), que desaparece al retirar `applyBranchMenu`. Mock y `parity.test.ts` deben emular las mismas semánticas. Riesgo: catálogo visible > 100 deja de llegar completo si el consumidor no pagina; la web usa un `listAllStoreMenu` que sigue `total`.

### D2 Bootstrap

Parámetros `branchId?`, `locale?`. Secciones: `branch`, `availability` (F08), `categories` (raíces, ≤ 30), `featured` (≤ 8, tarjeta del menú), `promotions` (vigentes ahora, ≤ 5, sin `items`, sin código), `banners` (≤ 10, `PublicBannersReader`), `productCount`, `degraded`. Reglas: sin `branchId` → `branch`/`availability` `null`, `promotions` vacío, banners solo `ALL`, `available=null`. `branchId` inexistente → 404 `BRANCH_NOT_FOUND` (la web reintenta sin sucursal, patrón de `useStoreBanners`). Secciones no críticas independientes (`Promise.allSettled`); críticas: sucursal, categorías, `productCount` (fallo → 503 `STORE_BUSY`). Sin tabla nueva ni migración para el resto.
Opcionalidad según features integradas: si F15/F16 aún no tienen su migración aplicada la sección falla → `degraded` y `no-store` (nunca 500 de toda la página). **Home no añade UI**: consume `banners`, `featured` y `productCount`; `promotions`/`availability` quedan disponibles (Happy Hour y estado de apertura) sin rediseño — «no verificado» contra el prototipo si se desea mostrarlas.
**Composición sin ciclos**: `StoreModule` → `{CategoriesModule, ProductsModule, BranchProductsModule(BranchOffersService), PromotionsModule(lector público), BannersReadModule(PublicBannersReader), BranchScheduleModule(BRANCH_AVAILABILITY_PORT), BranchesModule(BranchesQueryService), MediaModule(MediaUrlService)}`; ninguno importa `StoreModule`. Cada lector se llama con datos precargados (ids de categorías visibles, sucursal ya validada) para no repetir lecturas. Cambios en F15 (aditivos): exportar el lector público, modo sin `items` y `findIndicativeForProducts(branchId, productIds)` reutilizando `computeLineDiscount`; en F16: ninguno.
**`nextChangeAt` combinado** = mínimo no nulo de `promotions.nextChangeAt`, `banners.nextChangeAt`, `availability.nextTransitionAt` (todos ya ≤ 14 días). Cache-Control según ADR-0023.

### D3 Menú (tarjeta)

`productId, slug, price, available, name, summary (≤ 160, texto plano recortado sin partir palabras), image (principal o null), category (id, slug, name), promo (F15 indicativa, la de mayor ahorro, o null)`. Sin modificadores, galería, SKU ni descripción completa. Orden `menu` = orden del árbol (`array_position` sobre ids ordenados depth-first) luego `name`, `id`. SQL: una consulta con `count(*) OVER()` (+ una de conteo solo si la página queda vacía y `page > 1`), `LEFT JOIN branch_products` por `(branch_id, product_id)`, imagen principal con `product_media` `sort_order = 0` en lote, promociones con una lectura por ids de la página. Consultas esperadas: ≤ 6, constantes.

### D4 Búsqueda

`q` 2–80 (tras recortar; control chars fuera; comodines literales), `branchId?`, `categorySlug?`, `available?` (`true` exige sucursal → 400), `page` ≤ 20, `pageSize` ≤ 50 (por defecto 20). Busca en nombre, descripción y NOMBRE de categoría (ids de categorías visibles cuyo nombre contiene `q`, calculados en memoria con el mismo plegado que SQL). Orden estable: coincide por prefijo de nombre (0), por contenido en nombre (1), solo descripción/categoría (2); luego `name`, `id`. Ocultos/inactivos nunca (filtro por ids de categorías visibles + `p.active`). Sin resultados = 200 vacío. 60/min por IP (contador propio). Sin `locale` (P26).
**Técnica PostgreSQL (recomendación mínima suficiente)**: `lower(translate(col, …)) LIKE` ya usado en F11 (`folded()` en `products.repository.ts`); sin extensión ni índice. Razones: decenas/cientos de filas (el mock siembra ~30 productos); un B-tree no sirve con `%q%`; `unaccent` no es IMMUTABLE (no indexable sin envoltorio); `tsvector 'simple'` busca por palabra, no por subcadena («sal» ≠ «salmón») y exige columna generada o trigger. `pg_trgm`/`unaccent` en Supabase: **no verificado en esta sesión** (sin acceso a documentación ni BD); comprobar con `SELECT name FROM pg_available_extensions WHERE name IN ('pg_trgm','unaccent')`. Disparador de reevaluación: > 2.000 productos activos o p95 de búsqueda > 50 ms con `EXPLAIN ANALYZE`; entonces migración propia con `pg_trgm` + GIN sobre función IMMUTABLE de plegado.

### D5 Migración `0018` (condicionada a P23; **aún no existe el SQL**)

Para `database-engineer`: `ALTER TABLE app.products ADD COLUMN IF NOT EXISTS featured_rank smallint NULL`; CHECK `featured_rank IS NULL OR featured_rank BETWEEN 1 AND 99` (guardado con `DO $$ … IF NOT EXISTS`); índice parcial `products_featured_idx (featured_rank, name, id) WHERE featured_rank IS NOT NULL AND active`. Incremental, no destructiva, relanzable; reversión: quitar índice, CHECK y columna (se pierde el orden). Sin triggers. Requiere además (tras P23) añadir `featuredRank` a `CreateProductRequest/UpdateProductRequest/AdminProduct` y un campo en el formulario de producto del backoffice: NO incluido en este contrato. Numerar a continuación de la última de `develop` (verificar antes). Sin P23 aprobado: `featured: []` y la sección del Inicio se oculta.

### D6 Caché e invalidación

(a) **HTTP/CDN**: ver ADR-0023. Clave de CDN = URL completa: la web debe construir la query en orden fijo, omitir valores por defecto y enviar `q` recortado y en minúsculas. Lecturas públicas sin `Authorization`. No se asume CDN ni memoria compartida de funciones serverless; con o sin CDN la política es correcta.
(b) **Backend**: ninguna caché.
(c) **Consistencia por recurso** (peor caso en la caché compartida; + ≤ 15 s de TanStack): F07 sucursal en bootstrap ≤ 15 s (`/v1/branches` sigue en 5–15 min); F10 categorías, F11 productos, F13 precio/disponibilidad, F14 imágenes ≤ 15 s en menú/búsqueda/bootstrap/ficha con sucursal (ficha sin sucursal: hasta 6 min, heredado); F12 modificadores igual que la ficha; F15 promociones y F16 banners ≤ 15 s en agregados (≤ 30 s en sus endpoints propios; puede haber una discrepancia breve entre Inicio y Promociones); F08 horarios ≤ 15 s. Selectiva por sucursal: la URL ya incluye la sucursal. Cierre de P28 pendiente.
(d) **TanStack**: claves `['store','bootstrap',branchId|'none',locale]`, `['store','menu',branchId|'none',{categorySlug,available,sort,order,page,pageSize}]`, `['store','search',branchId|'none',q,{categorySlug,available}]` (infinita), `['products','store','detail',slug,branchId|'none']`. `staleTime`: bootstrap/menú/ficha 15 s, búsqueda 15 s con `gcTime` 2 min, categorías 60 s. Bootstrap, menú y ficha refetch en `nextChangeAt` (reutilizar `msUntilNextChange`) y al volver al foco. Cada mutación de backoffice (productos, categorías, branch-products, medios, modificadores, promociones, banners, sucursales) invalida los prefijos `['store','bootstrap']`, `['store','menu']`, `['store','search']` mediante un helper único. Cambiar de sucursal cambia la clave (no se mezclan). Sin `HydrationBoundary` ni prefetch SSR: la sucursal vive en localStorage y el servidor no la conoce (doble solicitud) y ADR-0004 mantiene `cacheComponents` apagado.

### D7 Datos del usuario

Nada privado en respuestas públicas. La web compone aparte `GET /v1/me/favorites` (ids, F06) y el resto de `/v1/me/...`. Para evitar parpadeo: las tarjetas se pintan de inmediato; el corazón de un cliente con sesión permanece neutro/deshabilitado hasta que `favorites.ids` resuelve y el de un visitante abre el inicio de sesión sin esperar. Cómo se comporta hoy: **no verificado**.

### D8 Web (renderizado y archivos)

Estrategia: páginas `(public)` siguen siendo cascarones de servidor con hijos de cliente; datos por TanStack; sin SSR indiscriminado.
Reemplazos: Inicio → `useStoreBootstrap` (carrusel, destacados, pie); menú → `useProducts` reimplementado sobre `getStoreBranchMenu` (1 solicitud en lugar de N+1) y sin `useStoreBranchMenu`; búsqueda → `searchStoreProducts` con debounce, mínimo 2 caracteres, `signal` reenviado y `placeholderData` previo; ficha → `getStoreProduct(slug, branchId)`; `ProductSheetHost` y `CartDrawer` dejan de cargar el catálogo en cada página (carga bajo demanda; coordinar con el dueño A por F18); `LastOrderCard` carga el catálogo solo al abrir el reorden. `http-client`: opción `public: true` (sin `Authorization`, sin `cache: 'no-store'`).
Archivos afectados: `lib/data-access/{paths,models,types,http-client}.ts`; `services/{store,products,branch-products}.ts`; `mocks/handlers/{branch-products,products,index}.ts` + nuevo `mocks/handlers/store-aggregates.ts` (mismas semánticas: topes, 404, orden, plegado); `lib/data-access/{parity,paths}.test.ts`; `features/query-keys.ts`; `features/store/hooks.ts`; `features/catalog/{hooks,catalog-product}.ts` (+ `components/product-sheet-host.tsx`, `product-sheet-context.tsx`); `features/branch-products/hooks.ts`; `features/banners/hooks.ts`; `features/home/components/{favorites-section,promo-carousel,orders-section}.tsx`; `features/menu/components/{menu-screen,menu-search-results}.tsx`; `features/store-shell/components/CartDrawer.tsx`; `features/order-mode/branch-selection.tsx` (claves); hooks `useInvalidate` de los módulos de backoffice; `i18n/messages/{es,en}.json` (aviso «escribe al menos 2 caracteres», error de límite 429). Estados carga/error/vacío: esqueletos existentes; error con `ErrorNotice`; vacío de búsqueda existente; `degraded` se trata como sección vacía.

### D9 Seguridad y límites

Públicos, `security: []`; todas las salidas son listas blancas (sin SKU, código de cupón, costos ni datos administrativos). Rate limit 60/min por IP y por ruta. Errores `no-store`; 503 `STORE_BUSY` (añadir a `PUBLIC_5XX_CODES`). Parámetros validados con `class-validator`; SQL parametrizado, `ORDER BY` con lista blanca.

## Pruebas exigidas (mapeo)

Niveles: U = unit API (repos en memoria), E = e2e supertest, I = `.int-spec` PostgreSQL desechable, W = vitest web, P = Playwright (mock), M = medible/medición.

| #   | Caso                                                                                             | Nivel                                   |
| --- | ------------------------------------------------------------------------------------------------ | --------------------------------------- |
| 1   | bootstrap con y sin sucursal; topes por sección; `degraded` y `no-store`                         | U, E                                    |
| 2   | menú paginado: `total`, `page`, último parcial, `page` fuera de rango, `pageSize` > 100 → 400    | U, E, I                                 |
| 3   | búsqueda: nombre/descripción/categoría, plegado de acentos, comodines literales, orden por grupo | U, I                                    |
| 4   | detalle: con y sin `branchId`; `offer`, `promotions`, grupos F12, imágenes F14                   | U, E                                    |
| 5   | sucursal válida / inexistente / inactiva → 404 `BRANCH_NOT_FOUND` en las 4 operaciones           | E                                       |
| 6   | cambio de sucursal: otra clave, otra respuesta                                                   | E, W                                    |
| 7   | precio por sucursal = override, nunca el de otra                                                 | U, I                                    |
| 8   | no disponibles: `available=false`; `available=true` excluye; sin sucursal → 400                  | U, E                                    |
| 9   | categoría inactiva/ancestro inactivo oculta sus productos en todas las lecturas                  | U, I                                    |
| 10  | productos inactivos/ocultos nunca en menú/búsqueda/destacados                                    | U, I                                    |
| 11  | promociones vigentes/vencidas/próximas; `promo` solo vigente; cupón sin código                   | U, E                                    |
| 12  | banners activos/vencidos/programados en bootstrap                                                | U                                       |
| 13  | idioma es/en y respaldo por campo en banners; productos sin traducción                           | U, W                                    |
| 14  | `Cache-Control` y `nextChangeAt` combinado; `no-store` en error/`degraded`; sin `ETag`           | U, E                                    |
| 15  | cachés por sucursal/idioma: claves y URL canónica                                                | W                                       |
| 16  | invalidación: mutación de backoffice invalida prefijos de tienda                                 | W                                       |
| 17  | sin datos privados (sin SKU, código, favoritos, `Authorization` no afecta)                       | E, W                                    |
| 18  | límites: q corto/largo, `page` ≤ 20, `pageSize` ≤ 50                                             | E                                       |
| 19  | rate limit 429 con `Retry-After`                                                                 | E                                       |
| 20  | sin resultados → 200 vacío                                                                       | U, E, W                                 |
| 21  | búsquedas rápidas: debounce, cancelación, respuesta obsoleta ignorada                            | W, P                                    |
| 22  | ausencia de N+1: consultas constantes con 10 vs 100 productos                                    | I, M                                    |
| 23  | menos peticiones duplicadas: Inicio = 1 agregado + sucursales; sin catálogo completo             | P, M                                    |
| 24  | integración real Inicio/menú/búsqueda/ficha contra API+BD                                        | I + manual (no hay Playwright `http`)   |
| 25  | errores 400/404/429/503 y estados de error en UI                                                 | E, W                                    |
| 26  | paridad mock/http (`parity.test.ts`) de las 4 operaciones                                        | W                                       |
| 27  | EXPLAIN de menú/búsqueda con 100/1.000 filas                                                     | M (manual)                              |
| 28  | migración `0018` (si se aprueba): idempotente, CHECK                                             | I                                       |
| 29  | CDN `HIT` y consistencia ≤ 15 s                                                                  | solo desplegado (no medible localmente) |

## Verificado / No verificado

Verificado (lectura del repo y comandos): estructura de módulos y exports (`CategoriesQueryService`, `BranchOffersService`, `PublicBannersReader`, `BRANCH_AVAILABILITY_PORT`, `MediaUrlService`); `PublicPromotionsService` NO está exportado; BranchProducts no puede importar Promotions; `bounded-cache.ts` fija 30/5 s; cliente HTTP con `cache:'no-store'`; ausencia de Hydration/`revalidate`/`vercel.json`; `pnpm contracts:generate` OK; `pnpm contracts:check` falla solo por operaciones sin implementar (+ menú sin 429/503); `pnpm typecheck` web falla en `catalog-product.ts:81`.
No verificado: `pg_trgm`/`unaccent` en Supabase; comportamiento de Vercel/CDN con `Cache-Control` de petición y `s-maxage`; número real de productos; payload medido; `$allOperations` sobre raw con el adaptador `pg`; comportamiento actual de los corazones; código de error de `BranchesQueryService.getPublicById`; migraciones de `origin/develop` (no se hizo `fetch`).

## Tareas por dueño

database-engineer: `0018` tras P23. api-engineer: `StoreModule`, repositorio SQL, exports de F15, `bounded-cache` parametrizable, filtro `STORE_BUSY`, throttles, pruebas 1–14, 17–22, 25. web-engineer: D8. qa-engineer: 22–24, 26, 27. security-reviewer: 17, rate limit. performance-reviewer: medición y tabla Antes/Después.

## Preguntas abiertas

P23 destacados; P24 topes; P25 agotados visibles u ocultos; P26 catálogo en inglés; P27 sinónimos y ranking; P28 consistencia (TTL vs purga); P29 cambio del menú (paginación por defecto, `branchId` opcional). Además: ¿puede F17 tocar `CartDrawer` (F18, dueño A)? ¿Se aprueba `STORE_BUSY`?

## Implementación F17 (API) — 2026-11-16

**Estado**: implementado = `src/store/` (`StoreModule`), `bootstrap`, `search`, `menu` ampliado, ficha con `branchId`, `503 STORE_BUSY`, caché `public, max-age=min(N,5), s-maxage=N` (N 1..15), aditivos en F15 (`PublicPromotionsService` exportado, `list(..., {compact, limit, branchValidated, now})`, `findIndicativeForProducts`) y `bounded-cache` parametrizable. Simulado = pruebas con repositorios en memoria. Pendiente = SQL real (`test/store.int-spec.ts` escrito, NO ejecutado), web, destacados (P23), medición con volumen y CDN. Bloqueado = nada.

**Decisiones provisionales (orquestador, sin confirmar con negocio)**: P23 sin migración ni `featured_rank`: el bootstrap devuelve `featured: []` y NO lo marca `degraded` (no es un fallo); P24 topes 8/5/30/100, `q` 2–80, `pageSize` ≤ 50, ≤ 20 páginas; P25 agotados visibles con `available=false`; P29 menú paginado por defecto y `branchId` opcional; `STORE_BUSY` aprobado y añadido a `PUBLIC_5XX_CODES`.

**Desviaciones respecto del diseño (justificadas)**

- `StoreModule` NO importa `MediaModule`: las imágenes de producto están guardadas como URL completa (F11/F14) y las de banners las resuelve `PublicBannersReader`; no hay consumidor de `MediaUrlService`.
- La imagen principal va en la MISMA consulta de tarjetas (`LEFT JOIN product_media … sort_order = 0`, único por la UNIQUE de F11) en vez de una lectura en lote aparte: una consulta menos.
- `findIndicativeForProducts(branchId, products[{id, price, available?}], {now})` recibe el precio ya resuelto (el de la consulta de tarjetas) para no repetir la lectura de F13. Solo automáticas; ordena por mayor ahorro, vence antes, `id` (ADR-0021).
- `nextChangeAt` de menú/búsqueda/ficha = próximo cambio de las promociones automáticas que aplican a algún producto de la página, vigentes O PRÓXIMAS (superconjunto del «solo vigentes» del contrato: más conservador).
- Bootstrap en modo `compact`: sin `items` y sin `productIds` de las promociones (campo opcional del contrato) para acotar el payload del Inicio.
- F16: `PublicBannersReader.findActiveBanners` acepta `branchValidated` (aditivo, como en F15); el bootstrap lo usa y se ahorra 1 consulta.
- `q`: caracteres de control/bidi/invisibles/NUL se RECHAZAN con 400 (el texto del contrato decía «se ignoran»; corregido en `openapi.yaml`).
- `available=false` equivale a «sin filtro» (el contrato solo define `true`).
- `promotionId` va en `promo` (lo exige `StoreProductPromo`); nunca de un cupón.
- `getStoreProduct` no declara 429/503 en el contrato aunque pueden ocurrir (429 ya existía en F11): defecto menor del contrato, sin corregir.
- F13: se retiran `PublicBranchMenuController`, `BranchMenuQueryService`, `findOverlay` y sus DTO (sustituidos por `StoreModule`); `GET /v1/store/products/{slug}` pasa de `PublicProductsController` a `StoreProductController`.
- Concurrencia: semáforo COMPARTIDO por proceso (`StoreDbGate`, singleton del módulo) con cupo `max(1, DB_POOL_MAX-1)`, cola de 8 y espera máxima de 1,5 s; excedido => 503 `STORE_BUSY` inmediato (mensaje fijo); siempre libera el cupo. En serverless es POR INSTANCIA. Probado con 40 bootstraps simultáneos (200 o 503, nunca se cuelga); el efecto real sobre el pool/latencia NO se midió (sin BD).
- Búsqueda: límite propio de 30/min por IP (contrato actualizado; el 429 ya estaba declarado); `left(description, 500)` antes de plegar; el nombre plegado se calcula UNA vez por fila (`CROSS JOIN LATERAL`) y se reutiliza en filtro y rango. `SET LOCAL statement_timeout` NO se añadió: exige una transacción explícita con 3 viajes extra por lectura; queda PENDIENTE (el 57014 ya mapea a `STORE_BUSY` si se configura a nivel de rol/BD).
- `q`: además se rechazan selectores de variación (U+FE00–FE0F, U+E0100–E01EF), U+3164, U+2800, U+115F/U+1160/U+FFA0 y toda `q` sin al menos una letra o dígito Unicode (visualmente vacía => 400).
- `categorySlug` inexistente o no visible: se mantiene 200 con lista vacía (documentado en el contrato; no revela qué categorías existen).
- `degraded`: `Cache-Control: public, max-age=0, s-maxage=3` (en vez de `no-store`) para no anular la CDN ante una sección que falla de forma persistente; el resto de errores sigue `no-store`. La advertencia de log por sección degradada se limita a 1 por minuto por proceso.
- `branchId` se normaliza a minúsculas en los 4 DTOs (clave de caché única); el contrato no cambia.
- `GET /v1/store/promotions?compact=true` (nuevo parámetro aditivo del contrato y de la API, antes solo interno): sin `items` ni `productIds`, no lee productos. El Menú de la web debe usarlo para el banner de Happy Hour.

**Antes/Después (API; consultas por solicitud: cada llamada a un repositorio de los dobles = una consulta; MEDIDO solo con los dobles en `src/store/*.spec.ts`; el SQL real y la instrumentación `pg.Client.query` están en `test/store.int-spec.ts`, escrito y PENDIENTE de ejecución con BD real por el orquestador tras autorización del propietario)**

| Operación          | Antes (línea base, derivada por lectura) | Después (medido con dobles)                                                                                                                                     | 10 vs 100 productos                                                 |
| ------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Inicio (bootstrap) | ~12 consultas en 6 solicitudes           | con sucursal: 5 (sucursal, categorías, conteo, candidatas de promoción, candidatos de banners) + 1 de F08 simulada (no contada) en 1 solicitud; sin sucursal: 3 | constante (medido)                                                  |
| Menú               | 3 + 4 (catálogo + overlay)               | con sucursal: 4 (+1 solo si la página sale vacía y `page > 1`)                                                                                                  | constante (medido)                                                  |
| Búsqueda           | 4                                        | con sucursal: 4; sin sucursal: 3                                                                                                                                | constante (medido)                                                  |
| Ficha              | 4                                        | sin `branchId`: 4; con `branchId`: 7                                                                                                                            | no medido con volumen (la ficha no depende del tamaño del catálogo) |

No medido: consultas reales contra PostgreSQL, payload, tiempos, `EXPLAIN`, CDN, efecto del semáforo sobre el pool y la latencia.

**Verificado (comandos ejecutados)**: ver el reporte de la entrega (typecheck, lint, `vitest`, `test:e2e`, `contracts:check`, `secrets:scan`, prettier). **No verificado**: SQL en PostgreSQL real (`store.int-spec.ts`), efecto del limitador sobre el pool, `pg_trgm`/`unaccent`, CDN, web.

## Deuda técnica de accesibilidad detectada en F17

- Unas 20 pantallas (sobre todo del backoffice) usan el patrón `<div aria-busy="true" aria-label=...>` como esqueleto de carga **sin `role`**; axe lo marca (`aria-prohibited-attr`) cuando la carga dura lo bastante. F17 corrigió solo `FavoritesPage` y `ModifiersScreen` (`role="status"`), que son las que hacían fallar pruebas. El resto queda pendiente de una pasada transversal (no es de F17).
- `e2e/favorites.spec.ts:60` falla también en `develop` limpio (verificado el 2026-11-16); no es de F17.
- `e2e/account.spec.ts:30` mostró una intermitencia aislada bajo carga (pasó en el reintento y en `develop` limpio).
