# F06 — Favoritos de clientes

**Rama**: `feature/F06-customer-favorites` (desde `develop` con F00–F09 y F04)
**Prioridad**: P1 · **Dependencias**: F01 (JWT Supabase), F04 (perfil de cliente) · **Bloqueada parcialmente por**: F11 (catálogo real; no existe en ninguna rama)
**Relacionadas (solo contratos reutilizables)**: F11 (catálogo), F13 (precio/disponibilidad por sucursal), F17 (`GET /v1/me/storefront`), F18 (carrito), F23 (reordenar)
**Estado global**: `CONTRACT_DEFINED` (contrato + spec + ADR-0014; sin API, web ni migración). Objetivo de F06: `API_IMPLEMENTED` con el
catálogo `BLOCKED` por F11 (dependencia interna, no proveedor externo). **El flujo real de extremo a extremo NO existe hasta F11**: sin catálogo
no se puede marcar un favorito (503), y la web solo funciona en modo mock (`MOCK_ONLY`).

## Alcance

Que un cliente autenticado marque, quite y liste productos favoritos (`GET /v1/me/favorites`, `PUT|DELETE /v1/me/favorites/{productId}`), con el
estado de los corazones de todas las tarjetas sin N peticiones, y la pantalla Mis favoritos. Fuera: CRUD de productos/categorías, precios por
sucursal (F13), modificadores, carrito (F18), checkout, pedidos, reordenar (F23), recomendaciones, F17 completa, PedidosYa, favoritos de invitado.

## Estados por componente

| Componente                                                                        | Estado                                                | Nota                                                                                                  |
| --------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Contrato OpenAPI (3 operaciones) + tipos generados                                | `CONTRACT_DEFINED`                                    | `pnpm contracts:check` en rojo hasta implementar la API (igual que F08/F09)                           |
| Migración `0009_customer_favorites` + modelo Prisma                               | propuesta (`CONTRACT_DEFINED`)                        | Sin aplicar; requiere aprobación humana. SIN FK a `products` (no existe)                              |
| API (`src/favorites/`): GET/PUT/DELETE, tope, throttle, `CustomerFavoritesReader` | `CONTRACT_DEFINED` → `API_IMPLEMENTED` al implementar | Real; probada con un fake del puerto de catálogo                                                      |
| Puerto `CatalogProductsPort` + `UnavailableCatalogAdapter`                        | `CONTRACT_DEFINED` → READY al implementar             | Adaptador por defecto: siempre "no disponible". El adaptador real es de F11                           |
| Validación y resumen REAL de productos                                            | **`BLOCKED` por F11**                                 | PUT => 503 `CATALOG_UNAVAILABLE`; GET degrada a `UNKNOWN`. Hoy no se puede crear ningún favorito real |
| Web: `FavoriteButton`, Mis favoritos, claves TanStack, handlers mock              | `MOCK_ONLY` (alineada al contrato)                    | Pasar a `http` requiere catálogo `http` (F11): hoy `DATA_SOURCE=http` rompería también menú/carrito   |
| FK `customer_favorites.product_id → products` + huérfanos                         | pendiente (F11)                                       | Ver D3                                                                                                |
| Contador `favoritesCount` en el contexto de F04/F17                               | pendiente (F17)                                       | Ver D11                                                                                               |

## Hechos verificados del repo

- DBML (`docs/references/monsushi_dbdiagram.dbml:199-206, 473-474`): `app.customer_favorites (customer_id, product_id)`, PK compuesta, FK a
  `customers` `ON DELETE CASCADE`, FK a `products` sin acción. **No hay `created_at`** (se añade aquí).
- `products`/`categories` NO existen en migraciones (0001–0007) ni en `schema.prisma`; F10/F11 no existen en ninguna rama. Migraciones vigentes:
  0001–0007 (la última, `0007_delivery_geography_coverage`, F09). La `0008` está reservada por otra rama en curso (decisión del usuario, 2026-11-14), así que esta feature usa **0009**; el orden de aplicación lo fija el número, no la fecha de merge.
- Cliente autenticado (F04): `IdentityService.ensureCustomer(principal)` (`sushimon-api/src/identity/identity.service.ts:35`) busca por
  `auth_user_id` (UNIQUE) y crea idempotente si falta (resuelve la carrera `P2002`). `CustomerProfileService` lo usa en `GET /v1/me` y `PATCH /v1/me`; la
  identidad sale SIEMPRE del `Principal` del JWT. Es global desde `AuthModule`: F06 lo reutiliza; **no se crea otro servicio de clientes**.
- Auth (`JwtAuthGuard` global, denegar por defecto): una ruta sin `@Public()` ni `@RequireStaff` exige solo JWT válido; sin MFA/aal2
  (`CustomerProfileController` es el patrón: `@ApiBearerAuth()` + `@CurrentUser()`).
- Filtro de errores (`src/common/filters/http-exception.filter.ts:76-77`): `code` y `violations` **solo se propagan con `status < 500`**, y
  todo error lleva `Cache-Control: no-store`. El 503 `CATALOG_UNAVAILABLE` exige una excepción acotada (ver D9).
- Throttle por ruta: patrón `@Throttle(...)` + constantes en `src/common/throttle/app-throttler.guard.ts` (F09); `AppThrottlerGuard` rastrea por IP
  y responde 429 `RATE_LIMITED` (requiere `TRUST_PROXY_HOPS >= 1` tras un proxy).
- Web (hoy): `FavoriteButton` (`features/catalog/components/favorite-button.tsx`) usa `useFavorites/useToggleFavorite` (`features/account/hooks.ts`),
  `string[]` bajo la clave **no aislada por identidad** `['account','favorites']`; sin sesión abre el modal de login. `FavoritesPage` une ids con
  `useProducts()` (catálogo mock). Mock `mocks/handlers/account.ts`: `GET` devuelve `string[]`, `PUT/DELETE` devuelven la lista. Los ids de producto
  del mock son **slugs** (`platanito-roll`), no UUID. Usos: `product-card`, `product-list-item`, `product-sheet-host`, `AccountHub`, `MorePage`.
  `home/favorites-section.tsx` ("Favoritos 人気") es una **selección editorial** (`featured`), NO los favoritos del cliente: no se toca.
- Texto web obsoleto: `fav.guestNote` ("Tus favoritos se guardan en este dispositivo…") describe favoritos locales de invitado; D13 los descarta.
- Colisión de nombres: ninguna (no existían esquemas `Favorite*`); `models.ts` solo gana alias (`CustomerFavorites`, `FavoriteItem`,
  `FavoriteProductSummary`, `FavoriteProductStatus`). `pnpm --filter sushimon-web typecheck` verde.

## Decisiones

- **D1 Propietario desde el JWT**. Ninguna ruta, consulta ni cuerpo lleva `customerId`; PUT/DELETE sin cuerpo. Cualquier propiedad/parámetro
  desconocido ⇒ 400 (ValidationPipe global). Solo JWT de cliente (Google OAuth, F01): **sin `@RequireStaff` ni MFA**; un empleado usa SUS
  favoritos como cliente y no se mezclan permisos (el personal no interviene). Sin IDOR posible: el id de producto es el único parámetro y el
  alcance siempre es `customer_id = <cliente del JWT>`.
- **D2 Cliente sin perfil** (revisada tras revisión de seguridad M1): solo **PUT** usa `IdentityService.ensureCustomer(principal)` (crea de forma
  idempotente, regla de F04). **GET y DELETE NO crean filas en `app.customers`**: usan `IdentityService.findCustomer(principal)` (lectura por `auth_user_id`, sin
  efectos; adición mínima que no cambia la semántica de F04). Sin fila de cliente: GET responde 200 vacío (`favoriteProductIds=[]`, `total=0`, `items=[]`,
  `catalogStatus=AVAILABLE`, sin consultar el catálogo) y DELETE 204. Evita que un token válido cualquiera cree perfiles con solo leer o borrar.
- **D3 Modelo sin FK a productos** (migración `0009_customer_favorites`, propuesta): ver "Modelo de datos". `product_id` no tiene FK porque
  `products` no existe; el id solo se persiste tras validarse con el puerto de catálogo (D6), por lo que, mientras `CATALOG_UNAVAILABLE`, **la tabla
  permanece vacía en entornos reales** y la FK de F11 es trivialmente segura (F11 igualmente debe verificar huérfanos antes de validar la FK).
  Cuando F11 añada la FK: `ON DELETE CASCADE` (desviación consciente del DBML, que dice sin acción = `NO ACTION`): los productos son soft-delete por
  `active` y la baja normal NO borra favoritos (D8); un borrado físico es una limpieza administrativa y un favorito (tabla de conveniencia, sin
  historial) no debe bloquearla. Los pedidos no dependen de favoritos (snapshots). F11 añade también `customer_favorites_product_idx (product_id)`.
- **D4 Contrato de lectura único** (`listMyFavorites`): `GET /v1/me/favorites?page&pageSize` devuelve `{ items, page, pageSize, total,
favoriteProductIds, limit, catalogStatus }`. `favoriteProductIds` = TODOS los ids (≤ `limit`), recientes primero: es la fuente del estado de
  todos los corazones (un `Set` en el cliente). `items` = página (default 20, máx 50). **`pageSize=0`** ⇒ sin `items` ni consulta al catálogo
  (respuesta barata para los corazones; elegido sobre un parámetro `view` por no introducir otro modo). Orden: `created_at DESC, product_id ASC`
  (determinista; PUT repetido no cambia `addedAt`). Paginación por `page` (offset): con ≤ 200 filas por cliente no justifica cursor.
- **D5 Items sin precios ni copia del catálogo**: `{ productId, addedAt, status, product }`. `product` = resumen público mínimo
  `{ id, name, nameEn|null, imageUrl|null, categoryId|null }`. Sin precio, disponibilidad por sucursal, descripción ni datos internos; la relación no
  copia nada del catálogo. El precio y la disponibilidad los resuelve el catálogo/F13 con la sucursal elegida (la UI nunca muestra el precio de
  otra sucursal). `status` ∈ `ACTIVE | INACTIVE | UNAVAILABLE | REMOVED | UNKNOWN` (enum abierto; clientes toleran valores futuros).
- **D6 Puerto `CatalogProductsPort`** (token `CATALOG_PRODUCTS_PORT`, módulo `src/favorites/`; F11 aporta el adaptador real sin cambiar el contrato):
  `findPublicSummaries(productIds: readonly string[]): Promise<ReadonlyMap<string, CatalogProductSummary>>` **en lote** (una llamada por solicitud,
  sin N+1). Un id ausente del mapa = no existe. `CatalogProductSummary = { id, name, nameEn|null, imageUrl|null, categoryId|null, status }`. Si el
  catálogo no puede responder lanza `CatalogUnavailableError`. El servicio envuelve la llamada con un plazo técnico de 3 s (constante, sin env nueva) y
  trata timeout o cualquier excepción como no disponible. **Defecto y único adaptador mientras no exista F11: `UnavailableCatalogAdapter`** (siempre
  `CatalogUnavailableError`, sin red). Los tests usan un fake del puerto. El API proyecta el resumen y descarta cualquier campo extra (lista blanca).
- **D7 PUT** (`addMyFavorite`): orden de operaciones: (1) UUID válido (400) → (2) `ensureCustomer` (solo PUT) → (3) puerto de catálogo FUERA de la transacción: no
  disponible ⇒ **503 `CATALOG_UNAVAILABLE`** (sin escribir; nunca se guarda un id no validado); ausente o `status ∉ {ACTIVE, UNAVAILABLE}` ⇒ **404
  `PRODUCT_NOT_FOUND`** (despublicado/retirado no se distingue de inexistente: no se revela catálogo no publicado) → (4) transacción de inserción (D10)
  → **204** (recién creado o ya existente; sin 409 por doble clic; sin 201). Si el producto ya era favorito y el catálogo está caído también responde
  503 (se prioriza un solo camino simple; la UI no puede alcanzar ese caso porque el corazón ya está activo y se desmarca con DELETE).
- **D8 DELETE** (`removeMyFavorite`): idempotente: `DELETE … WHERE customer_id = <jwt> AND product_id = $1` ⇒ **204** exista o no (también si el producto ya no
  existe en el catálogo). No consulta el catálogo: funciona sin él. Productos retirados o despublicados **no se borran automáticamente** de los
  favoritos: se listan con `status` `INACTIVE|REMOVED` y `product = null` para que el cliente los quite.
- **D9 Errores con `code`** (ver "Errores") y 503: el filtro central hoy descarta `code` en 5xx. Cambio mínimo y acotado (api-engineer + prueba en
  `http-exception.filter.spec.ts`): una **lista blanca** `PUBLIC_5XX_CODES = {'CATALOG_UNAVAILABLE', 'FAVORITES_BUSY'}` cuyo `code` sí se propaga (nunca `violations`
  ni mensajes de causa). El resto de 5xx sigue sin `code` y con mensaje fijo `Error interno del servidor` (también las `HttpException` 5xx). El detalle (qué falló en el catálogo) solo en el log técnico con `requestId`.
- **D10 Concurrencia y tope**. Tope **`MAX_FAVORITES_PER_CUSTOMER = 200`** (constante de código, no env; cambiarlo requiere ADR). Justificación: el menú
  actual tiene ~30 productos y crecerá con 5 sucursales; 200 cubre un catálogo holgado, acota `favoriteProductIds` (≈ 8 KB), el costo del lote al
  catálogo y el abuso de escritura. Es un tope técnico revisable (no una regla de negocio de Sushi Mon). Inserción **exacta** bajo concurrencia, en UNA
  transacción: (a) `SELECT 1 FROM app.customers WHERE id = $cliente FOR NO KEY UPDATE` (serializa las altas del mismo cliente; NO bloquea la FK de
  otros inserts, que toma `FOR KEY SHARE`; el cliente concurrente en PATCH `/me` solo espera microsegundos); (b) contar; (c) si `count < 200`,
  `INSERT … ON CONFLICT (customer_id, product_id) DO NOTHING` (equivalente: `createMany({ skipDuplicates: true })`); (d) si no se insertó fila: si el
  par ya existe ⇒ 204 (idempotente, aunque esté al tope); si no existe y `count >= 200` ⇒ **422 `FAVORITES_LIMIT_REACHED`**. Dos PUT simultáneos del
  MISMO producto ⇒ uno inserta, el otro `DO NOTHING`, ambos 204. N PUT simultáneos de productos distintos al borde ⇒ exactamente `200` filas. Sin
  advisory locks ni índices extra. La transacción fija `SET LOCAL lock_timeout = '2s'` (como `branch-schedule`) con `maxWait` 2 s y `timeout` 5 s; si el candado o el tiempo se agotan (`55P03`/`P2028`) responde **503 `FAVORITES_BUSY`** (reintentable, sin escribir). El `GET` NO cuenta: `total` = filas leídas (≤ 200, tope impuesto en PUT); si el tope se bajara habría que reintroducir el conteo. Si se baja el tope en el futuro, las filas ya existentes no se borran (la lectura devuelve todas con `LIMIT` defensivo
  = tope y `total` real). El lote del catálogo (D6) se resuelve **antes** de la transacción para no retener el candado durante una llamada externa.
- **D11 F17 y `favoritesCount`**: se exporta `CustomerFavoritesReader` (token `CUSTOMER_FAVORITES_READER`) con
  `getFavoriteProductIds(customerId: string): Promise<string[]>` (≤ 200, recientes primero; recibe el id de `customers`, no el de Auth; sin catálogo,
  una consulta por el índice de listado). F06 **no** modifica `GET /v1/me/storefront` ni `CustomerStorefrontContext` ni `pendingSections` (contrato de F04
  estable): añadir `favoritesCount` agrega un `COUNT` a un endpoint pensado como lectura mínima y obliga a retirar `favorites` de `pendingSections`
  (mock + prueba de F04); no es trivial ni necesario hoy (la web usa `total`/`favoriteProductIds` de `listMyFavorites`). **Decisión: lo hace F17**, con el
  `Reader` (`favoritesCount` + opcionalmente `favoriteProductIds`) y retirando `favorites` de `pendingSections` en ese momento.
- **D12 Caché y privacidad**. Éxitos `Cache-Control: private, no-store`; los errores ya salen `no-store` (filtro central). Nunca en CDN ni caché compartida;
  sin `use cache`/ISR para estos datos en la web (ADR-0004: nada específico de un usuario en el servidor de render). Sin auditoría por clic (no es una
  operación monetaria ni de personal; evita ruido y datos de preferencias en `audit_events`). Logs técnicos mínimos y **sin PII**: solo conteos y
  resultado (`limit reached`, `catalog unavailable`) sin ids de cliente ni de producto. Borrado del cliente ⇒ `ON DELETE CASCADE` (derecho al olvido).
- **D13 Throttle por ruta** (`src/common/throttle/app-throttler.guard.ts`, mismo patrón que F09; por IP; requiere `TRUST_PROXY_HOPS >= 1` tras un
  proxy): `listMyFavorites` **120/min**, `addMyFavorite` **60/min**, `removeMyFavorite` **60/min** (cada handler su propio contador). Márgenes amplios: la
  web cachea `favoriteProductIds` (D15) y un humano no alcanza 60 clics por minuto; el IP compartido (NAT móvil) no debe bloquear a clientes reales.
  Limitación conocida (M3, **pendiente**, no se implementa en F06): por IP, no por usuario (el guard global corre antes de poblar el `Principal`); un límite por cliente es posterior y no se inventa aquí.
  429 con `code RATE_LIMITED`, `Retry-After`, `no-store`.
- **D14 Web — visitante**: el corazón sin sesión **no crea nada**: abre el login existente (`useAuthModal`; en modo real Google + PKCE, destino de retorno =
  ruta actual con `safeNextPath`). No se recuerda una "intención pendiente": tras volver, el cliente vuelve a tocar el corazón (sin escrituras ocultas).
  **Favoritos locales de invitado NO se implementan ni se sincronizan** (`localStorage` no es fuente de verdad y mezclar dispositivos requiere reglas de
  fusión fuera de alcance); se corrige el texto `fav.guestNote` (es/en) para que deje de afirmar que se guardan en el dispositivo.
- **D15 Web — estado remoto único y aislado por identidad**: una sola fuente de datos remota, `GET /v1/me/favorites` (vía `services` → `DataClient`), con
  dos consultas: `ids` (`pageSize=0`; sirve a TODOS los corazones y al contador de AccountHub/MorePage; `staleTime` 60 s) y `list(page)` (página completa; `staleTime`
  30 s). Claves **jerárquicas con la identidad en la raíz**: `queryKeys.customer.favorites.ids(scope)` = `['customer', scope, 'favorites', 'ids']`,
  `…list(scope, page)`, `…all(scope)`, donde `scope` = `auth user id` (Supabase) o `demo:<correo>` (mock), nunca vacío (sin sesión: `enabled=false`). Un
  efecto único (`useCustomerCacheGuard`) hace `removeQueries({ queryKey: ['customer'] })` al cerrar sesión o cambiar de `scope`; aun sin él, otra cuenta no
  puede leer la caché ajena porque la clave incluye el `scope`. Se retira `queryKeys.account.favorites` (no aislada). Sin SSR de datos de usuario: el
  corazón se hidrata en el cliente.
- **D16 Web — mutación del corazón** (`useToggleFavorite`): `mutationKey` común; `onMutate`: `cancelQueries(ids)` y actualización optimista del `Set` de ids (alta al
  inicio, baja filtrando); **rollback solo del producto afectado** (no se restaura un snapshot completo, para no pisar cambios optimistas de otros
  productos en vuelo); `onSettled`: invalida `ids` y `list` solo cuando no queda otra mutación de favoritos en curso (`isMutating`). Sin doble envío: mientras hay una mutación en
  vuelo para ese `productId` el botón queda `aria-busy`/deshabilitado (esto fija también el orden: no hay dos solicitudes simultáneas del mismo producto).
  Errores por `code`: `FAVORITES_LIMIT_REACHED` ⇒ aviso del tope (200); `CATALOG_UNAVAILABLE` ⇒ "Favoritos no disponible por ahora"; `PRODUCT_NOT_FOUND` ⇒
  aviso y refetch; `401` ⇒ limpia la caché del cliente y abre el login; `RATE_LIMITED` ⇒ aviso con reintento. En todos, rollback. Nunca se ramifica por `message`.
- **D17 Web — `FavoriteButton` compartido**: un único componente (ya usado en tarjeta, fila de menú y hoja de producto) con `aria-pressed`, `aria-label`
  es/en ("Agregar/Quitar {nombre} de favoritos"), foco visible, objetivo ≥ 44 px (`md`), estado de carga (`aria-busy`), sin ruido de animación con
  `prefers-reduced-motion`, y toast de confirmación existente. Sin sesión: `aria-pressed=false` y abre el login.
- **D18 Web — Mis favoritos** (`/cuenta/favoritos`): lista paginada de `items` (orden por `addedAt`), con estados: cargando (esqueleto), vacío (CTA al menú), error
  con reintento, **no disponible** (`catalogStatus = UNAVAILABLE`: aviso "No podemos mostrar los detalles ahora" + ids sin datos, con opción de
  quitar), y por fila: producto activo (tarjeta), no disponible (`UNAVAILABLE`/`INACTIVE`/`REMOVED`/`UNKNOWN`: fila discreta "Ya no disponible", sin datos
  internos, con botón Quitar). **Unión con el catálogo sin duplicarlo**: la API trae el orden y el estado; para PINTAR la tarjeta se busca el
  `Product` completo (precio y disponibilidad de la sucursal elegida) en `useProducts()` por `productId`; si no está, se muestra la fila mínima con el
  resumen de la API (nombre, imagen, **sin precio**). La web nunca copia el catálogo ni el precio al estado de favoritos. "Agregar al carrito": **no se implementa**; se
  reutiliza `ProductCard`/hoja de producto tal como están (comportamiento mock actual); el carrito real queda **pendiente de F18**.
- **D19 Mock web**: `mocks/handlers/account.ts` replica el contrato nuevo (`GET` → `CustomerFavorites`; `PUT/DELETE` → 204; 404/422/429-equivalentes con `code`;
  UUID inválido → 400 **excepto** que en `MOCK_ONLY` el id es el slug del fixture: el handler valida existencia contra el catálogo mock, no el formato
  UUID; desviación documentada y retirada cuando F11 aporte UUID). Un escenario de prueba "catálogo no disponible" cubre 503/`UNKNOWN`.
- **D20 Módulos API**: nuevo `src/favorites/` (`FavoritesModule`, controlador `me/favorites`, `CustomerFavoritesService`, repositorio acotado, puerto +
  adaptador, `CustomerFavoritesReader`), importa solo `IdentityService` (global), `PrismaService`. `AppModule` solo lo compone. No depende de
  `CustomersModule`/`CustomerProfileService`. Controlador: `@ApiBearerAuth()`, sin `@Public()`/`@RequireStaff`, `@Header('Cache-Control','private, no-store')`.

## Modelo de datos (propuesta para `database-engineer`, migración `0009_customer_favorites`)

```
app.customer_favorites (
  customer_id uuid        not null,
  product_id  uuid        not null,                       -- SIN FK a products (no existe; F11 la añade)
  created_at  timestamptz(6) not null default now(),      -- NUEVO respecto al DBML (orden y "agregado el")
  CONSTRAINT customer_favorites_pkey PRIMARY KEY (customer_id, product_id),
  CONSTRAINT customer_favorites_customer_id_fkey FOREIGN KEY (customer_id)
      REFERENCES app.customers(id) ON DELETE CASCADE ON UPDATE CASCADE )
INDEX customer_favorites_customer_created_idx ON app.customer_favorites (customer_id, created_at DESC, product_id)
```

- El PK sirve a `ON CONFLICT`, al `DELETE` y a la comprobación de pertenencia; el índice de listado sirve al orden paginado y a `getFavoriteProductIds`.
- RLS: `ENABLE ROW LEVEL SECURITY` sin políticas + `REVOKE ALL … FROM PUBLIC` y, solo si existen, `anon`/`authenticated` (igual que 0006/0007). La API usa la
  conexión privilegiada; el cliente nunca consulta la tabla directamente.
- No hay CHECK adicional (el tope vive en la transacción, D10). No toca `customers`, RBAC ni `audit_events`. Incremental y no destructiva (solo `CREATE`).
  Reversión manual: `DROP TABLE app.customer_favorites` (sin dependientes). Evolución del DBML (columna `created_at`, FK a productos diferida, índice) justificada aquí y en
  ADR-0014; el DBML de `docs/references` **no se edita**.
- Prisma: modelo `CustomerFavorite` (`@@id([customerId, productId])`, `@@index([customerId, createdAt(sort: Desc), productId])`, relación `onDelete: Cascade`) y
  `favorites CustomerFavorite[]` en `Customer`. Sin relación a `Product`.
- **F11 (futuro)**: `ADD CONSTRAINT customer_favorites_product_id_fkey FOREIGN KEY (product_id) REFERENCES app.products(id) ON DELETE CASCADE NOT VALID`, luego `VALIDATE CONSTRAINT`
  (previa comprobación de huérfanos) + `customer_favorites_product_idx (product_id)`.

## Matriz de comportamiento con y sin catálogo

| Operación                                 | Catálogo disponible                                                                             | Catálogo no disponible (hoy, hasta F11; o caído/timeout)                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET` (`pageSize ≥ 1`)                    | 200; `catalogStatus=AVAILABLE`; `items[].status` real, `product` solo si `ACTIVE`/`UNAVAILABLE` | **200**; `catalogStatus=UNAVAILABLE`; cada item `status=UNKNOWN`, `product=null`; `productId`, `addedAt`, `total`, `favoriteProductIds` reales |
| `GET` (`pageSize=0`)                      | 200 sin `items`; no consulta el catálogo                                                        | idéntico (no depende del catálogo)                                                                                                             |
| `PUT` producto válido                     | 204 (inserta o ya existía)                                                                      | **503 `CATALOG_UNAVAILABLE`**, sin escribir                                                                                                    |
| `PUT` producto inexistente / despublicado | 404 `PRODUCT_NOT_FOUND`                                                                         | 503 (no se puede decidir)                                                                                                                      |
| `PUT` en el tope, producto nuevo          | 422 `FAVORITES_LIMIT_REACHED`                                                                   | 503 (el catálogo se evalúa primero)                                                                                                            |
| `PUT` en el tope, ya favorito             | 204                                                                                             | 503                                                                                                                                            |
| `DELETE`                                  | 204 (exista o no)                                                                               | 204 (no usa el catálogo)                                                                                                                       |

Sin sesión válida: 401 en las tres. `productId` no UUID: 400 en PUT/DELETE (antes de cualquier consulta).

## Errores

Cuerpo base `ErrorResponse` + `code`. Los 5xx no llevan `code` salvo `CATALOG_UNAVAILABLE` y `FAVORITES_BUSY` (D9).

| HTTP | `code`                    | Operación       | Cuándo                                                               |
| ---- | ------------------------- | --------------- | -------------------------------------------------------------------- |
| 400  | —                         | todas           | `productId` no UUID; `page`/`pageSize` fuera de rango o desconocidos |
| 401  | —                         | todas           | Token ausente, inválido o expirado                                   |
| 404  | `PRODUCT_NOT_FOUND`       | `addMyFavorite` | Producto inexistente o no publicado                                  |
| 422  | `FAVORITES_LIMIT_REACHED` | `addMyFavorite` | 200 favoritos y el producto es nuevo                                 |
| 429  | `RATE_LIMITED`            | todas           | Límite de D13 (`Retry-After`, `no-store`)                            |
| 503  | `CATALOG_UNAVAILABLE`     | `addMyFavorite` | El catálogo no puede validar el producto (nada se guarda)            |
| 503  | `FAVORITES_BUSY`          | `addMyFavorite` | Candado/tiempo de la transacción agotado (reintentable)              |

## Contrato (resumen)

| `operationId`      | Método y ruta                         | Auth    | Éxito | Caché               | Throttle |
| ------------------ | ------------------------------------- | ------- | ----- | ------------------- | -------- |
| `listMyFavorites`  | GET `/v1/me/favorites`                | cliente | 200   | `private, no-store` | 120/min  |
| `addMyFavorite`    | PUT `/v1/me/favorites/{productId}`    | cliente | 204   | `private, no-store` | 60/min   |
| `removeMyFavorite` | DELETE `/v1/me/favorites/{productId}` | cliente | 204   | `private, no-store` | 60/min   |

Esquemas nuevos: `CustomerFavorites`, `FavoriteItem`, `FavoriteProductSummary`, `FavoriteProductStatus`; parámetro `FavoriteProductId`. `pnpm contracts:check` queda **en
rojo** (solo estas 3 operaciones sin implementar) hasta que la API exista; `pnpm contracts:generate` ya actualizó `schema.d.ts`.

## Contrato con F17 / F11 / F13 / F18

- **F17**: importa `FavoritesModule` y usa `CustomerFavoritesReader.getFavoriteProductIds(customerId)`; añade `favoritesCount`/`favoriteProductIds` a su contexto.
- **F11**: implementa `CatalogProductsPort` (lote por ids; `status` según `active`/publicación; imagen y categoría públicas), lo registra en lugar de `UnavailableCatalogAdapter`, añade la FK
  (D3) y, si lo desea, mueve el puerto a su módulo. No debe devolver precios en el resumen.
- **F13**: precio y disponibilidad por sucursal; la web los pide al catálogo, no a favoritos.
- **F18**: "Agregar al carrito" desde favoritos usa el carrito real; hoy no existe.

## Pruebas exigidas

- **API unitarias** (servicio con fake del puerto y repositorio/PGlite): PUT feliz ⇒ 204 y fila; PUT repetido ⇒ 204 sin duplicar ni cambiar `created_at`; producto ausente /
  `INACTIVE` / `REMOVED` ⇒ 404; puerto con `CatalogUnavailableError`, excepción y timeout ⇒ 503 sin escribir (`UnavailableCatalogAdapter` incluido); tope: 200 ⇒ nuevo 422, ya favorito 204,
  404 antes que 422; `pageSize=0` no llama al puerto; GET con catálogo caído ⇒ 200 `UNKNOWN`, `product=null`; lista blanca del resumen (campos extra del puerto no salen); DELETE inexistente ⇒ 204 y sin
  llamar al puerto; GET/DELETE de un principal sin cliente no crean fila y PUT sí (`ensureCustomer`); `imageUrl` solo https (≤ 2048); orden (`created_at DESC`, desempate) y paginación; `CustomerFavoritesReader`.
- **API e2e** (supertest, sin red): sin token 401 en las tres; UUID inválido 400; propiedades/params desconocidos 400; `Cache-Control: private, no-store` en 200/204 y `no-store` en errores; **no hay
  IDOR** (dos usuarios: el B no ve ni borra lo del A); un empleado (staff, aal1) usa favoritos como cliente; 429 con `code RATE_LIMITED`; el 503 expone `code` y un 500 genérico no; sin `customerId` aceptado.
- **Integración con BD** (`test/migration-0009.int-spec.ts`, PostgreSQL desechable vía `DATABASE_URL_TEST`; PGlite para estructura): PK, `ON CONFLICT DO NOTHING`, cascada al borrar el cliente, índice presente, RLS/REVOKE;
  **carrera**: N (> 200) PUT concurrentes de productos distintos desde conexiones distintas ⇒ exactamente 200 filas y el resto 422 (requiere varias conexiones; se omite sin BD real); dos PUT simultáneos del mismo producto ⇒ 1 fila.
- **Filtro de errores**: `CATALOG_UNAVAILABLE` conserva `code`; cualquier otro 5xx no.
- **Web** (Vitest/RTL): `FavoriteButton` (`aria-pressed`, `aria-label` es/en, `aria-busy`, sin doble envío, visitante abre login y NO llama a la API, sin sesión no hay consulta); `useToggleFavorite` (optimista, rollback
  por producto, orden de respuestas, `cancelQueries`, invalidación única, errores por `code`); aislamiento por identidad (cambiar de cuenta/cerrar sesión no deja favoritos del anterior); `FavoritesPage` (cargando, vacío, error,
  `catalogStatus=UNAVAILABLE`, fila no disponible, quitar); paridad handler mock ↔ contrato (`parity.test.ts`); i18n es/en completa; e2e Playwright + axe en `/cuenta/favoritos`.

## Tareas por dueño

1. **database-engineer**: migración `0009_customer_favorites` (tabla, FK `ON DELETE CASCADE`, índice, RLS/REVOKE, encabezado con reversión), modelo Prisma, `test/migration-0009.int-spec.ts` (incluye la carrera), nota en `docs/database/README.md` (propuesta hecha).
2. **api-engineer**: `src/favorites/` (módulo, controlador `me/favorites`, servicio, repositorio, puerto + `UnavailableCatalogAdapter`, `CustomerFavoritesReader` exportado), tope exacto D10, throttles D13 (constantes junto a las de F09), lista blanca 5xx en el filtro D9, DTOs con `type:` explícito
   y `@Inject` explícito, logging sin PII, pruebas anteriores; `pnpm contracts:check` verde.
3. **web-engineer**: servicios/hooks/claves D15–D16, `FavoriteButton` D17, Mis favoritos D18, handlers mock D19, retirar `queryKeys.account.favorites`, contadores de AccountHub/MorePage desde `total`, i18n es/en (incluye nuevo `guestNote`, tope, no disponible), pruebas web.
4. **security-reviewer**: propietario siempre del JWT, IDOR, throttle por IP detrás de proxy, 503 `code` acotado, `private, no-store`, sin PII en logs, RLS/REVOKE, cascada de borrado.
5. **qa-engineer / performance-reviewer**: matriz anterior; presupuesto de consultas (GET con items: lectura de cliente + 1 página + 1 ids + 1 lote al catálogo; PUT: cliente + lote + 1 transacción); sin N+1.
6. **ui-ux-reviewer**: corazón accesible, estados de Mis favoritos, textos es/en, claro/oscuro, objetivo táctil, `prefers-reduced-motion`.

## Preguntas abiertas y asunciones

Asunciones (no bloquean):

- **A1** Tope 200, límites 120/60/60 por minuto y plazo de 3 s del catálogo son técnicos y revisables (no reglas de negocio).
- **A2** `ON DELETE CASCADE` hacia productos (F11) sustituye al "sin acción" del DBML; si el negocio prefiere `RESTRICT`, se decide en F11.
- **A3** Los ids de producto del mock son slugs; los reales serán UUID (F11). Hasta entonces, la web con `DATA_SOURCE=http` no es verificable (el catálogo `http` no existe).
- **A4** Un producto `UNAVAILABLE` (publicado, no pedible ahora) SÍ se puede marcar como favorito; uno `INACTIVE` (despublicado) no.

Decisiones de producto pendientes (no bloquean el contrato):

1. ¿Cuántos favoritos máximo desea el negocio realmente (200 es técnico)?
2. ¿"Intención pendiente" tras iniciar sesión (agregar el favorito automáticamente al volver)? Descartada en D14; se puede añadir sin cambiar la API.
3. ¿Límite por cliente (no por IP) en endpoints autenticados? Pendiente de una mejora transversal del throttler (F00).

Bloqueado por dependencia interna: **F11** (catálogo real: validación, resumen y FK). No hay bloqueo externo.
