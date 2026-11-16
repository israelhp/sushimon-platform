# F16 — Banners, contenido editorial y campañas

**Rama**: `feature/F16-banners-campaigns` (desde `develop` 344af63)
**Prioridad**: P1 (backlog oficial) · **Dependencias**: F14 (medios en R2), F15 (promociones, solo lectura), F07 (sucursales), F10/F11 (destinos de catálogo), F03 (RBAC) · **Integración posterior**: F17 (agregados de tienda: consume `PublicBannersReader`), F38 (configuración de contenido)
**Decisiones**: `docs/adr/0022-banners-campanas.md` · **Pendientes de negocio**: P18–P22 en `docs/business-rules/decisiones-pendientes.md`
**Estado global**: `IN_PROGRESS` — contrato `CONTRACT_DEFINED`; API `API_IMPLEMENTED` (probada con repositorio en memoria, **SQL real sin verificar**); migración `0017_banners` escrita pero **sin aplicar**; web en paralelo (otro ingeniero). Se reporta por componente. Ninguna otra feature se toca.

## Alcance

Gestionar los banners del carrusel del Inicio de la tienda (imagen, texto es/en, destino estructurado, vigencia, sucursales, prioridad y, opcionalmente, una promoción de F15 a la que acompañan) y publicarlos con una lectura
pública cacheable. «Campaña» = un banner con vigencia y, si procede, vinculado a una promoción: **no hay entidad de campaña ni editor de campañas**.

Fuera de alcance (no se hace en F16): agregado `GET home` y búsqueda (F17; F16 solo deja `PublicBannersReader`), motor de promociones, cálculo de precios o descuentos, cotización, editor de campañas complejo (plantillas, segmentación, A/B, métricas de clics), páginas editoriales, nuevo sistema de i18n (se reutilizan es/en de ADR-0005),
Image Resizing, variantes responsive, procesamiento de imagen en servidor, enlaces externos (P19), imagen móvil (P20), varias ubicaciones (P21), borrado físico de banners.

## Estados por componente

| Componente                                                                                | Estado                   | Nota                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contrato OpenAPI (7 operaciones nuevas, 28 esquemas nuevos, `MediaKind` ampliado) + tipos | `CONTRACT_DEFINED`       | `pnpm contracts:generate` OK; `contracts:check` lista las 7 operaciones «sin implementar» (esperado)                                                                                                                                                                                                                                               |
| Migración `0017_banners` + Prisma                                                         | escrita, **sin aplicar** | La escribió el `database-engineer` (`prisma/migrations/0017_banners/migration.sql`); requiere aprobación humana antes de aplicarse a una base real                                                                                                                                                                                                 |
| API `src/banners/` (`BannersReadModule` con `PublicBannersReader`, `BannersModule` admin) | `API_IMPLEMENTED`        | Implementada y probada con repositorio en memoria (unit + e2e supertest). SQL real verificado el 2026-11-16 con `test/banners.int-spec.ts` (14 pasan, 2 omitidas a propósito en BD compartida: reorden global y llenado del tope de 100) contra la BD de pruebas con la 0017 aplicada por el propietario; `migration-0017.int-spec` corre en el CI |
| Cambios en F14 (`kind`, clave, 1 MiB, uso por banners) y en el módulo de permisos         | `API_IMPLEMENTED`        | `BANNER_IMAGE` en `src/media`; pruebas «43» -> «46» actualizadas (`staff.e2e-spec`, `staff.int-spec`, `staff-context`); la 0017 siembra los permisos                                                                                                                                                                                               |
| Web: carrusel del Inicio con datos reales, pantalla de backoffice «Banners»               | `MOCK_ONLY`              | El carrusel hoy tiene 4 diapositivas fijas con ilustraciones. No hay pantalla de banners en el prototipo de backoffice (ver «Impacto en la web»)                                                                                                                                                                                                   |
| Imagen real en R2 (subida y entrega)                                                      | `BLOCKED_EXTERNAL`       | Hereda el bloqueo de F14 (sin bucket, dominio ni credenciales verificados)                                                                                                                                                                                                                                                                         |
| Enlaces externos, imagen móvil, varias ubicaciones, métricas                              | fuera de alcance         | P19, P20, P21; contrato extensible                                                                                                                                                                                                                                                                                                                 |

## Hechos verificados del repo

- **El DBML no contempla banners** (no hay tabla ni referencia; `docs/BACKLOG.md` ficha F16: «DBML no contempla tabla; solo si se aprueba migración»). La tabla es nueva; el DBML no se edita (regla de `CLAUDE.md`), la desviación se justifica en ADR-0022.
- Última migración en `origin/develop` (referencia local, sin `fetch`): `0016_promotions` (`git ls-tree origin/develop`). La siguiente es **0017**; el `database-engineer` debe volver a comprobarlo antes de numerarla.
- `media_assets.kind` hoy es solo `'PRODUCT_IMAGE'` (`sushimon-api/prisma/migrations/0015_media_assets/migration.sql:49`, `media_assets_kind_chk`; el comentario de la línea 12 prevé que F16 lo amplíe con una migración). Tope de tamaño genérico 5 MiB (`:58`). La clave de objeto se construye con el prefijo fijo `products/` (`sushimon-api/src/media/media-policy.ts:157-160`); `MediaUrlService.publicUrl/tryPublicUrl` entrega la URL pública permanente (`sushimon-api/src/media/media-url.service.ts:33-40`), sin URL firmada. `MediaModule` exporta `MediaUrlService` para F16/F17 (spec 015 D12).
- F14 borra assets con comprobación de uso solo sobre `product_media` y FK `RESTRICT` como respaldo (`23503` => 409 `MEDIA_IN_USE`; `sushimon-api/src/media/media-db-errors.ts:20`, `admin-media.service.ts:272`); `usageCount` cuenta `product_media` (`sushimon-api/src/media/media.repository.ts:47`) y `findUsages` lista productos (`:189`). Hay que ampliarlos (ver «Cambios en F14»).
- Permisos: el catálogo sembrado en `0005_staff_rbac` (`:82-124`) tiene 43 permisos y **ninguno de banners, contenido ni marketing**; `settings.read|update` existe pero es de ajustes de plataforma (F38). `admin` debe contener todo el catálogo (invariante de `0005`). Pruebas que fijan «43»: `sushimon-api/test/staff.e2e-spec.ts:349`, `staff.int-spec.ts:521`, `identity.int-spec.ts:118`, `database.int-spec.ts:78`, `test/support/staff-context.ts:3`; web: `src/mocks/fixtures/rbac.ts:4`, `src/mocks/handlers/staff.test.ts:83,500`.
- Alcance por sucursal: `AuthorizationService.scopeFor/canAccess` (`sushimon-api/src/auth/authorization.service.ts:43-49`). Patrón F15: `ALL` exige alcance global; `SELECTED` exige cubrir todas; fuera de alcance 404; cubierta parcialmente 403 (spec 016 D10).
- F15 ya expone lo necesario sin duplicar: funciones puras `isLive`, `analyzeTiming`, `livePeriods`, `HORIZON_DAYS = 14` (`sushimon-api/src/promotions/promotion-schedule.ts:23,74,152,164`), el `Cache-Control` acotado por `nextChangeAt` (`sushimon-api/src/promotions/promotions-cache.ts`; interceptor de ruta que suprime el `ETag` débil) y `PROMOTIONS_BUSY` en `PUBLIC_5XX_CODES` (`sushimon-api/src/common/filters/http-exception.filter.ts:29-41`).
- Orden y concurrencia en el repo: `PUT /v1/admin/categories/reorder` con conjunto exacto + `pg_advisory_xact_lock` (`sushimon-api/src/categories/admin-categories.service.ts:169-215`, `categories.repository.ts:47`); `PUT .../media/order` sobre `UNIQUE (product_id, sort_order)` diferible (spec 015 D10); bloqueo por hash en `media.repository.ts:95` y `staff.repository.ts:114`.
- Web hoy: `PromoCarousel` (`sushimon-web/src/features/home/components/promo-carousel.tsx`) tiene 4 diapositivas fijas (`SLIDES`, `:51`), textos de `home.slides.*` (es/en en `src/i18n/messages/*.json`), ilustración `FoodArt`, avance cada 6 s (`CAROUSEL_INTERVAL_MS`, `:23`), pausa manual, pausa por foco/puntero (`hold`), `prefers-reduced-motion` (`:25`), `inert` en las no activas, alturas fijas por punto de corte (`h-[176px] … lg:h-[240px]`, `:218`), y el eyebrow de «calientito» usa el precio de `useProducts()` (`:124`). La página `src/app/(public)/page.tsx` lo monta tal cual. `STORE_ROUTES` define las rutas públicas (`features/store-shell/nav.ts:4-14`: `/menu`, `/promociones`, `/consultar`, `/incidencias`, `/trabaja-con-nosotros`). `menu-screen.tsx:41` resuelve `?cat=` contra el árbol de categorías.
- `docs/ui/prototype-inventory.md:36`: «Inicio: Banners rotativos…». **No hay pantalla de gestión de banners en `backoffice-prototype.html`** (el inventario del backoffice no la lista): la pantalla nueva no tiene prototipo y debe seguir los patrones de F11/F15 (`PromotionsScreen`, `PromotionModal`).
- El idioma ya se negocia por cookie (`NEXT_LOCALE`, ADR-0005); ninguna API pública actual recibe `locale`. F16 añade el parámetro explícito `locale` (la URL define la caché).

## Decisiones (razones y alternativas en ADR-0022)

### D1 Modelo mínimo (migración `0017_banners`)

Tres tablas y un cambio en `media_assets`. Estados (`inactivo`, `programado`, `publicado`, `vencido`) **derivados**, nunca columnas.

- **`app.banners`**: `id`, `code` (único, inmutable), `image_asset_id` (FK `media_assets` RESTRICT, NOT NULL), CTA estructurado (`cta_type`, `cta_category_id`, `cta_product_id`, `cta_page`), `promotion_id` (FK `promotions` RESTRICT, NULL), `starts_at`/`ends_at` (NULL permitido), `active`, `sort_order`, `version`, `created_at`, `updated_at`.
- **`app.banner_translations`** (`banner_id`, `locale`, `title`, `subtitle`, `cta_label`, `image_alt`) con PK `(banner_id, locale)`: tabla de traducciones, no columnas `*_es/*_en` ni un banner por idioma (D6).
- **`app.banner_branches`** (`banner_id`, `branch_id`): ausencia de filas = todas las sucursales, igual que F15; el contrato exige declarar `branchScope` (`ALL | SELECTED`).
- **`media_assets`**: `kind` admite `'BANNER_IMAGE'` (D2).
- **Ubicación (`placement`)**: **no se crea**. Hoy el Inicio tiene UN carrusel. Añadir una columna con un único valor sería un campo muerto; un segundo lugar (p. ej. banda del menú) es P21 y se resolverá con una migración que añada la columna con `DEFAULT 'HOME'` (aditiva, sin tocar filas ni contrato público: `GET /v1/store/banners` ganará un parámetro opcional).
- **Imagen móvil**: **no se crea** (P20). Justificación: una sola imagen con `object-fit: cover` y zona segura central basta para v1 y evita doble gestión y doble subida; el contrato la deja extensible (`StoreBanner.image` es un objeto; una imagen móvil sería un campo opcional nuevo y `mobile_image_asset_id` una columna nueva NULL). Riesgo conocido: la altura del carrusel varía por punto de corte (176 px móvil a 240 px escritorio) y el recorte puede cortar texto incrustado; se mitiga prohibiendo texto dentro de la imagen (el texto es estructurado) y recomendando una zona segura.

### D2 Ampliación de F14: `BANNER_IMAGE`

- `media_assets_kind_chk` pasa a `kind IN ('PRODUCT_IMAGE','BANNER_IMAGE')` (la migración lo reemplaza).
- Clave de objeto `banners/<yyyy>/<uuid>.<ext>` (`buildObjectKey` recibe el tipo; el prefijo lo decide el tipo, nunca el cliente). Un CHECK nuevo `media_assets_key_prefix_chk` fija la coherencia tipo/prefijo (`PRODUCT_IMAGE` con `products/`, `BANNER_IMAGE` con `banners/`).
- Límites del tipo: MIME de la lista blanca de F14 (`image/jpeg|png|webp|avif`; SVG y GIF siguen rechazados); **tamaño máximo 1 MiB** (`media_assets_banner_size_chk`: `kind <> 'BANNER_IMAGE' OR size_bytes <= 1048576`; el tope genérico de 5 MiB no cambia); si no => 422 `MEDIA_TOO_LARGE`. Es un tope duro razonable para una imagen de portada ya optimizada en el cliente; subirlo exige migración, como en F14.
- **Proporción y dimensiones**: **no se validan en el servidor** (no hay decodificación ni procesamiento en servidor; F14 solo verifica MIME, tamaño, checksum y firma). El cliente reutiliza el optimizador de F14 con un perfil de banner (WebP ~0.82, **lado largo máx. 1920 px**, proporción recomendada **3:1**, p. ej. 1920 x 640, composición con zona segura central) y rechaza lo que supere 1 MiB tras optimizar. Es una recomendación de calidad, no una garantía de seguridad.
- Sin Image Resizing, sin segundo cliente S3, sin variantes: se reutilizan puerto, adaptadores, intents, `complete`, dedupe `(kind, checksum)` y purga perezosa de F14 sin cambios de flujo.
- **Validación en F16** (servicio de escritura de banners, dentro de la transacción): `image_asset_id` debe existir, estar `READY` y ser `BANNER_IMAGE`; si no => 422 `BANNER_IMAGE_INVALID` con `violations` `ASSET_UNKNOWN | ASSET_NOT_READY | ASSET_KIND_MISMATCH` (path `imageAssetId`). La lectura pública vuelve a exigir `status='READY'` (defensa en profundidad).
- **Reemplazar o quitar la imagen**: el banner solo cambia de `image_asset_id` (no puede quedar sin imagen; `NOT NULL`). El asset anterior **no se borra**: queda sin referencias en la biblioteca (`unreferenced=true`) y lo elimina un administrador con `DELETE /v1/admin/media/{id}` (F14). Desactivar o vencer un banner tampoco toca el asset (la purga perezosa de F14 solo trata PENDING caducados). El FK `RESTRICT` impide borrar un asset en uso (`MEDIA_IN_USE`).
- **Fallo de R2**: (a) sin base pública configurada (`unavailable`) `tryPublicUrl` devuelve `null`: el banner no se publica (`IMAGE_UNAVAILABLE` en el admin) y la lista pública sale vacía o recortada, **nunca 5xx por eso**; (b) la subida sin R2 sigue respondiendo 503 `MEDIA_STORAGE_UNAVAILABLE` (F14) y el formulario conserva los textos; (c) si R2/CDN falla al cargar la imagen en el navegador, la web usa un fondo de marca y conserva texto y CTA (D12); la API no puede saberlo. La URL pública es permanente (`MediaUrlService`), nunca firmada ni persistida.

### D3 CTA estructurado

Tipos: `NONE`, `MENU`, `PROMOTIONS`, `CATEGORY` (`cta_category_id`), `PRODUCT` (`cta_product_id`), `PAGE` (`cta_page`).

- Un campo de referencia por tipo, con FK real a `categories`/`products` (`RESTRICT`) y CHECKs «uno y solo uno»: el destino no es texto libre, no hay forma de guardar una ruta arbitraria. `PAGE` usa lista blanca cerrada en CHECK: `CAREERS`, `TRACK_ORDER`, `INCIDENTS` (las tres rutas públicas de `STORE_ROUTES`; añadir una = migración + contrato). Las rutas (`/menu`, `/promociones`, `/menu?cat=<slug>`, …) las **resuelve la web** con una función tipada y cerrada; la API devuelve ids/slug/página, no URLs.
- Validación al escribir: `CATEGORY`/`PRODUCT` deben existir y estar activos (`active=true`) => si no, 422 `BANNER_CTA_INVALID` (violations `TARGET_UNKNOWN | TARGET_INACTIVE | FIELD_MISMATCH`). Al leer (público) un destino que dejó de estar activo **oculta el banner** (`CTA_TARGET_INACTIVE` en el admin): un CTA a un callejón sin salida es peor que no mostrar el banner. La visibilidad completa de la cadena de categorías padre no se recalcula (solo el `active` directo); la web ya tolera un producto/categoría no disponible.
- **EXTERNAL: NO se permite en v1.** No existe el tipo ni la columna `cta_url`. Motivo: superficie de phishing/redirección abierta/`javascript:` sin necesidad comprobada (el prototipo y el carrusel actual solo enlazan dentro de la tienda). Si negocio lo pide (P19): migración (tipo + `cta_url` con CHECK `^https://`), ADR y política: solo `https`, host exacto en lista blanca de configuración del servidor (`BANNER_EXTERNAL_ALLOWED_HOSTS`, sin comodines), sin credenciales ni puertos distintos, prohibidos `javascript:`, `data:`, `//host` y cualquier `/r?url=` propio, apertura con `rel="noopener noreferrer"` y aviso de salida. Nada de eso se implementa ahora.
- `ctaLabel` es opcional por idioma; si falta la web usa su etiqueta genérica localizada (`home.banner.cta`, texto de interfaz, no contenido).

### D4 Orden y prioridad

- `sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 9999)`, **no único**. Orden público y de lista admin: `sort_order ASC, created_at ASC, id ASC` (determinista; el empate no depende del orden de inserción de la BD).
- **Decisión: prioridad NO única con desempate**, en vez de `UNIQUE DEFERRABLE (sort_order)` como en `product_media`. Razones: (1) el orden es **global** y los banners vencidos/inactivos se acumulan; un `UNIQUE` exigiría renumerarlos o excluirlos con un índice parcial y obligaría a reordenar el conjunto completo ante cada alta; (2) un alta concurrente asignaría el mismo «último + 1» y fallaría con `23505` que habría que reintentar: aquí el empate es legal y el desempate lo resuelve; (3) no hay riesgo de huecos o colisiones que bloqueen una escritura. Costo: dos banners pueden tener la misma prioridad (documentado en la UI como «empate: el más antiguo primero»).
- Alta: `sortOrder` omitido => `max(sort_order) + 1` entre los no vencidos (consulta en la transacción; sin bloqueo: un empate por carrera es válido).
- **Reordenado atómico**: `PUT /v1/admin/banners/order` con `orderedIds` = **exactamente** los banners no vencidos (activos o no, programados o publicados). Se prefiere sobre un `PATCH` de prioridad individual como único mecanismo porque arrastrar y soltar en la UI mueve varios a la vez y un solo `PATCH` con empates obligaría a recalcular en el cliente; el `PATCH {sortOrder}` individual se mantiene para ajustes puntuales y para actores con alcance acotado.
  - Exige `banners.update` con **alcance global** (el orden afecta a todas las sucursales) => 403 `BANNER_SCOPE_FORBIDDEN` si no.
  - Transacción corta bajo `pg_advisory_xact_lock(hashtextextended('app:banners-order', 0))` (patrón de `staff.repository.ts:114`; clave nueva, distinta de 1100110 de categorías), `SET LOCAL lock_timeout='3s'`, lectura del conjunto, comparación exacta (422 `BANNER_REORDER_MISMATCH` sin escribir), asignación `0..n-1`, `version + 1` solo en los banners cuyo `sort_order` cambia (un editor concurrente con `expectedVersion` recibirá 409), una auditoría `banner.reordered`. Idempotente (mismo orden: 200 sin escribir ni auditar). Resultado concurrente = uno de los dos órdenes enviados, nunca mezclado.
  - Los vencidos no participan: conservan su `sort_order` y, si se reactivan ampliando `endsAt`, se ordenan por el desempate.
  - Tope: **100 banners no vencidos** (422 `BANNER_LIMIT_REACHED` al crear o al reactivar/ampliar que lo supere); acota el cuerpo del reordenado.
- La tienda devuelve **como máximo 10** banners (un carrusel de más de 10 diapositivas no es accesible ni útil); si hay más elegibles se recortan por el orden anterior.

### D5 Vigencia

- `starts_at` y `ends_at` **nullable** (publicación sin fin permitida: banners permanentes como «Trabaja con nosotros»; sin inicio = vigente desde el alta). Instantes `timestamptz`, intervalo `[starts_at, ends_at)` (fin exclusivo), CHECK `starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at` (si no, 422 `BANNER_PERIOD_INVALID`). La API acepta y devuelve ISO 8601 con zona; sin zona => 400. `America/Guatemala` (UTC−6, sin horario de verano; helpers de F08) solo interviene al **mostrar** fechas en la UI y en los casos de prueba: no hay horario semanal en un banner.
- **Vigencia de banner ≠ horario de apertura (F08) ≠ vigencia de promoción (F15)**: son tres conceptos independientes. El banner no consulta F08 (se muestra con la sucursal cerrada) y su vigencia no cambia la de la promoción vinculada (y viceversa: la promoción vigente no publica un banner inactivo o fuera de su propia vigencia).
- Estados derivados (`BannerLifecycle`): `INACTIVE` (`active=false`) > `EXPIRED` (`ends_at <= ahora`) > `SCHEDULED` (`starts_at > ahora`) > `PUBLISHED`. `visibleNow` = `PUBLISHED` y sin motivo de ocultación (D7, D3, D2).
- `nextChangeAt` público = menor instante futuro (<= 14 días, `HORIZON_DAYS` de F15) entre: `starts_at`/`ends_at` de los banners activos candidatos y el `nextChangeAt` de la promoción de cada banner candidato vinculado a una (D7). `null` si no hay.

### D6 i18n es/en

- **Tabla `banner_translations`** (no columnas ni banner duplicado por idioma). Razones: el banner es UNA entidad con una sola imagen, vigencia, prioridad y auditoría; el idioma es una dimensión del texto. Una tabla permite añadir un idioma sin migrar columnas y establece el patrón de contenido localizado que F17/F38 y los textos en inglés pendientes de F15 podrán reutilizar. Alternativa descartada: `title_es/title_en…` (más simple y con `NOT NULL` declarativo para `es`, pero 8 columnas, ceremonia por idioma y sin patrón reusable). Costo aceptado: la obligatoriedad de la fila `es` la impone el servicio dentro de la transacción (no hay forma declarativa sin trigger) y la lectura pública exige `INNER JOIN` con la fila `es`.
- Idioma de respaldo: **`es`**. `locale` solo admite `es|en` (otro => 400). Cada texto se recorta y una cadena en blanco **se guarda como ausente** (`NULL`; CHECK `btrim <> ''`).
- **Respaldo por campo**: para cada uno de `title`, `subtitle`, `ctaLabel`, `imageAlt` se usa el valor del idioma pedido si existe y no está vacío; si no, el de `es`. `fallbackFields` en la respuesta lista los campos que vinieron en español para que la web marque `lang="es"` en ese texto (accesibilidad y pronunciación del lector de pantalla).
- **Mínimos**: `es.title` (1..80) y `es.imageAlt` (1..200) obligatorios (CHECK en BD para la fila `es` y 422 `BANNER_TRANSLATION_INVALID` en la API); `subtitle` (<= 160) y `ctaLabel` (<= 40) opcionales; en `en` todo es opcional. Si, por datos corruptos, no hubiera fila `es` válida, **el banner no se publica** (el `INNER JOIN` lo excluye). El texto alternativo existe por idioma; no hay indicador de «imagen decorativa» en v1 (el alt es obligatorio).
- Texto plano: sin HTML ni Markdown; se rechazan NUL y controles bidireccionales como en F15 (`name/description`); la web escapa por defecto (React).
- Caché: el idioma va en la URL (`?locale=`), no en cookie ni cabecera, de modo que la caché compartida lo distingue sin `Vary`.

### D7 Banner enlazado a una promoción (F15)

**Política (recomendada y adoptada): el banner enlazado a una promoción solo se publica mientras la promoción esté VIGENTE; si no lo está, se oculta (no hay error ni edición automática).** «Vigente» es exactamente lo que F15 ya llama `live`: `active` Y `starts_at <= t < ends_at` Y dentro del horario semanal, y además la promoción debe **aplicar a la sucursal consultada** (si la promoción es `SELECTED` y el banner `ALL`, el banner no se muestra para sucursales que la promoción no cubre; sin `branchId`, solo si la promoción es `ALL`).

- Razones: evita anunciar una promoción vencida, futura, desactivada o fuera de su Happy Hour (promesa que el cliente no podrá cumplir); no obliga al administrador a coordinar dos fechas; la fuente de verdad sigue siendo F15.
- **Sin duplicar el motor**: el lector de banners carga, en una consulta acotada a los `promotion_id` de los banners candidatos (≤ 100), las columnas de tiempo de esas promociones, sus tramos semanales y sus sucursales, y llama a las funciones **puras** ya exportadas por `promotion-schedule.ts` (`isLive`, `analyzeTiming`). No usa `PromotionEvaluator` (no calcula descuentos) ni `PromotionCandidatesService`. F16 no copia reglas: si F15 cambia su definición de vigencia, el banner la sigue.
- `nextChangeAt` (caché): para cada banner candidato vinculado se incorpora el `nextChangeAt` de su promoción (inicio/fin de vigencia o de tramo, con tramos contiguos fusionados, horizonte 14 días) además de sus propias fechas, de modo que un banner nunca sobrevive en caché al fin de su promoción ni tarda en aparecer al empezar.
- **Cupones**: una promoción con código (`code IS NOT NULL`) puede vincularse, pero **el banner nunca revela código, descuento, productos ni `kind`**: la respuesta pública no incluye ningún dato de la promoción y no hay `promotionId` público. El texto del banner lo redacta el administrador: la UI advierte «no escribas el código del cupón en el texto si no quieres divulgarlo» (relacionado con P17).
- F16 **no calcula precios ni descuentos**; cualquier precio indicativo sigue en `GET /v1/store/promotions` y el total lo fija F19 en el servidor.
- Coherencia al escribir: la promoción debe existir y su alcance de sucursales debe **cubrir** el del banner (banner `ALL` exige promoción `ALL`; banner `SELECTED` exige promoción `ALL` o que contenga todas sus sucursales); si no, 422 `BANNER_PROMOTION_INVALID` (violations `PROMOTION_UNKNOWN | BRANCH_SCOPE_MISMATCH`). Se puede vincular una promoción inactiva o futura (se publica cuando rija). Si después se edita la promoción (F15) y se rompe la cobertura, el banner simplemente deja de salir donde la promoción no aplica (`PROMOTION_NOT_LIVE` en el admin). `promotion_id` es `ON DELETE RESTRICT` (F15 no borra).
- Cambiar la política (p. ej. mostrar banners de promociones próximas como «Próximamente») es P22 y solo toca el lector de banners.

### D8 Contrato (7 operaciones)

Tag `banners`. Ya está en `packages/contracts/openapi/openapi.yaml` (generado `src/schema.d.ts`).

| operationId               | Método y ruta                         | Permiso (aal2 salvo público) | Resumen                                                                                            |
| ------------------------- | ------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `listStoreBanners`        | `GET /v1/store/banners`               | público                      | Banners elegibles ahora; `branchId?`, `locale=es\|en`; `Cache-Control` acotado; lista vacía válida |
| `listAdminBanners`        | `GET /v1/admin/banners`               | `banners.read`               | Página; filtros `branchId`, `lifecycle`, `q`; `sort` (`priority` por defecto), `order`             |
| `createAdminBanner`       | `POST /v1/admin/banners`              | `banners.create`             | 201; `code` inmutable                                                                              |
| `getAdminBanner`          | `GET /v1/admin/banners/{id}`          | `banners.read`               | Detalle con ambas traducciones sin respaldo                                                        |
| `updateAdminBanner`       | `PATCH /v1/admin/banners/{id}`        | `banners.update`             | `expectedVersion` obligatorio; parcial; no acepta `code` ni `active`                               |
| `updateAdminBannerStatus` | `PATCH /v1/admin/banners/{id}/status` | `banners.update`             | Idempotente, sin versión                                                                           |
| `reorderAdminBanners`     | `PUT /v1/admin/banners/order`         | `banners.update` global      | Conjunto exacto de no vencidos; atómico                                                            |

- **PATCH parcial**: los campos omitidos **no se reemplazan**. Texto por idioma y por campo (omitir = sin cambio; `null` en un opcional lo borra; `translations.en: null` elimina el inglés; `es.title`/`es.imageAlt` no pueden quedar vacíos). `branchScope`/`branchIds` y `cta` reemplazan su bloque completo. `promotionId: null` desvincula. Si el resultado no cambia nada: 200 sin escribir, sin subir `version` y sin auditar.
- Códigos de error propios (forma = 400; regla de negocio = 422; como F11–F15): 404 `BANNER_NOT_FOUND`, `BRANCH_NOT_FOUND`; 403 `BANNER_SCOPE_FORBIDDEN`; 409 `BANNER_CODE_TAKEN`, `BANNER_VERSION_CONFLICT`; 422 `BANNER_IMAGE_INVALID`, `BANNER_TRANSLATION_INVALID`, `BANNER_CTA_INVALID`, `BANNER_PERIOD_INVALID`, `BANNER_SCOPE_INVALID`, `BANNER_PROMOTION_INVALID`, `BANNER_REORDER_MISMATCH`, `BANNER_LIMIT_REACHED`; 429 `RATE_LIMITED`; 503 `BANNERS_BUSY` (añadir a `PUBLIC_5XX_CODES`; reintentable). Imagen inexistente/no READY/otro tipo y promoción inexistente son 422 con `violations`, no 404.
- Sin `DELETE`: se desactiva (`active=false`) o se deja vencer (sin borrado físico, como F15). Es una decisión de v1: un borrado habría que auditarlo y no hay requisito; F15 estableció el precedente.
- Búsqueda `q`: título (cualquier idioma) y código; contiene, sin distinguir mayúsculas ni acentos; comodines literales (mismo escape que F11/F15). Sin índice (cientos de filas como máximo).
- Compatibilidad F14 (aditiva): `MediaKind` gana `BANNER_IMAGE`; `AdminMediaAssetDetail.bannerUsages` (opcional) y `usageCount` pasa a contar también banners. No hay cambios incompatibles.

### D9 Autorización y seguridad

- **Permisos nuevos mínimos (cambio de permisos, requiere migración y decisión P18)**: `banners.read`, `banners.create`, `banners.update` (convención `modulo.accion`, ADR-0010; mismo reparto que `promotions.*`). La migración 0017 los siembra (`ON CONFLICT DO NOTHING`) y los asigna **solo a `admin`** (mantiene el invariante «admin tiene todo el catálogo»). No hay RBAC paralelo ni rol nuevo. Se descartó reutilizar `promotions.*` (mezclaría marketing editorial con descuentos y atraería P16) y `settings.*` (reservado a F38). Efecto colateral que el api/web-engineer debe absorber: el catálogo pasa de **43 a 46** permisos (pruebas listadas en «Hechos verificados») y la web añade el slug `banners` a `SCREEN_PERMISSION` (`banners.read`) y a la navegación.
- **Alcance** (patrón F15/F13): lectura con alcance global = todos; acotado = los que aplican a alguna de sus sucursales (incluidos `ALL`), con `branches` recortado y `editable=false` si no cubre todas. Escritura: `branchScope=ALL` exige alcance **global** (403 `BANNER_SCOPE_FORBIDDEN`); `SELECTED` exige cubrir **todas** las sucursales del banner (actuales y nuevas en un PATCH); sucursal inexistente o fuera de alcance => 404 `BRANCH_NOT_FOUND`; un banner que no toca su alcance => 404 `BANNER_NOT_FOUND`; que lo toca pero no lo cubre entero => 403. Reordenar exige global.
- **Imágenes (F14) en v1**: la subida (`POST /v1/admin/media/upload-intents`, `complete`) conserva `catalog.update` **global** también para `BANNER_IMAGE`, y la biblioteca `catalog.read`. **Consecuencia**: en v1 solo quien tenga también `catalog.update` global (hoy solo `admin`) puede subir la imagen de un banner. Si P18 concede `banners.*` a otro rol sin `catalog.update`, habrá que añadir autorización por tipo en los endpoints de medios (F14) antes de otorgarlos; no se hace ahora para no ampliar F14 sin necesidad.
- `aal2` en todo `/v1/admin`; `Cache-Control: no-store` en admin y en errores; límites de tasa: público 60/min por IP (`PRODUCTS_PUBLIC_THROTTLE`), escrituras 30/min por actor.
- Entradas con `__proto__`/`constructor` rechazadas (middleware existente); SQL parametrizado; el público nunca devuelve `code`, ids de promoción, `version`, auditoría ni datos de otros idiomas distintos al pedido (salvo el respaldo `es`).
- **Auditoría** en la misma transacción, sin PII (`audit_events`): `banner.created` (id, code, `imageAssetId`, tipo de CTA y referencia, `branchScope`, ids de sucursal, fechas, `promotionId`, `sortOrder`, `active`, claves de texto presentes por idioma, **no** los textos completos si superan un tope razonable: se registran títulos, que son contenido de negocio y no PII), `banner.updated` (`old/new` solo de lo cambiado: **`imageAssetId`, CTA, `startsAt/endsAt`, ids de sucursal, `sortOrder`, `promotionId`** y los campos de texto modificados), `banner.status_changed` (`oldActive`, `newActive`, `reason`), `banner.reordered` (orden antes/después como ids). Sin cambio real no se audita. Nunca URLs firmadas ni claves de objeto en la auditoría.
- **Concurrencia**: `FOR NO KEY UPDATE` sobre la fila del banner y, tras bloquear, re-verificación de alcance y de `version` (patrón de la corrección de F15); `SET LOCAL lock_timeout`; `P2028/55P03/40P01/40001/timeout` => 503 `BANNERS_BUSY`; `23505` de `banners_code_key` => 409 `BANNER_CODE_TAKEN` (objetivo exacto); `23503` por FK (asset/promoción/destino desaparecido por carrera) => 422 del código correspondiente.

### D10 Lector público reutilizable (`PublicBannersReader`)

- `BannersModule` (`sushimon-api/src/banners/`) se divide en dos partes dentro del mismo módulo para respetar los límites: **lectura** (`PublicBannersReader`, `PublicBannersController`, `BannersReadRepository`) y **administración** (`AdminBannersController`, `AdminBannersService`, `BannersWriteRepository`, políticas puras). `PublicBannersReader.findActiveBanners({ branchId?, locale })` devuelve `{ items, nextChangeAt, generatedAt }` y **no** conoce nada administrativo; F17 lo consumirá importando solo el proveedor exportado. Para evitar dependencias circulares el módulo se importa en una sola dirección: `banners -> media (MediaUrlService) -> audit`, `banners -> auth`, y `banners -> promotions` únicamente por las **funciones puras** de `promotion-schedule.ts` (sin importar `PromotionsModule`). `MediaModule` y `PromotionsModule` **no** importan `BannersModule`.
- El uso de banners por assets (F14: `usageCount`, `bannerUsages`, comprobación previa al borrado) se resuelve con una consulta en `MediaRepository` sobre la tabla `banners` (relación Prisma), sin que `media` importe `banners`.
- Caché: `Cache-Control` de F15 (`max-age=min(N,5)`, `s-maxage=N`, `N = clamp(segundos hasta nextChangeAt, 1, 30)`, `no-store` si ya pasó, sin `ETag` en esta ruta, sin SWR). El api-engineer puede generalizar `promotions-cache.ts` a un utilitario común sin cambiar el comportamiento de F15. **Query keys de la web**: `queryKeys.catalog.banners(branchId|null, locale)` = `['catalog','banners', branchId ?? 'all', locale]` (prefijo `['catalog','banners']`) para la tienda y `queryKeys.backoffice.banners` (prefijo `['catalog','backoffice','banners']`: listas con filtros y detalle) para el admin. Toda mutación del backoffice invalida ambos prefijos; la tienda usa `staleTime <= 30 s`, `refetchOnWindowFocus` y programa un `setTimeout` acotado a `nextChangeAt` para refetch (mismo patrón que Happy Hour en F15). La verdad de qué banner se publica es del servidor; la web no filtra por fechas.

### D11 Concurrencia de lectura y rendimiento

Una consulta para banners elegibles por tiempo/sucursal/imagen/traducción/destino (un `JOIN` a `banner_translations`, `media_assets`, y `LEFT JOIN` a `categories`/`products`), una para las promociones vinculadas (con tramos y sucursales) y cómputo en memoria: dos consultas, sin N+1. Índices por acceso real: `banners_active_order_idx (sort_order, created_at, id) WHERE active` (lectura pública y lista admin), `banner_branches_branch_idx (branch_id, banner_id)` (banners de una sucursal), `banners_image_asset_idx (image_asset_id)` (FK y «usos del asset»); PK y UNIQUE los crean sus restricciones. Tabla de decenas de filas: el planificador puede preferir un scan; se conservan por claridad y bajo coste (como F15).

### D12 Impacto en la web (`sushimon-web`; lo implementa el `web-engineer`)

**Reutilizar el carrusel existente** (`features/home/components/promo-carousel.tsx` y su prueba); no se crea otro. Cambios:

- **Datos**: `SLIDES` fijas y los textos `home.slides.*` desaparecen del flujo real; el carrusel recibe `StoreBanner[]` de un hook nuevo `useStoreBanners(branchId, locale)` (`features/home/hooks.ts` o `features/catalog/hooks.ts`, junto a `usePromotions`). La sucursal activa y el idioma ya existen en el contexto de la tienda. Los slides actuales pasan a ser **semillas del mock** (banners `favoritos`, `happy-hour`, `calientito`, `equipo`) con CTA `CATEGORY`, `PROMOTIONS`, `PRODUCT`, `PAGE(CAREERS)` respectivamente. Se pierde: el `jp` decorativo, el `eyebrow` con precio del producto (`useProducts()` deja de usarse; F16 no muestra precios) y el `FoodArt`; es una desviación respecto al prototipo, que se documenta en la PR (ADR-0007: la ilustración del prototipo era provisional; sustituirla por imagen real es justamente el objeto de F16).
- **Ruta del CTA**: función cerrada `bannerHref(cta)` en `features/home`: `MENU -> STORE_ROUTES.menu`, `PROMOTIONS -> STORE_ROUTES.promos`, `CATEGORY -> /menu?cat=<categorySlug>`, `PAGE(CAREERS|TRACK_ORDER|INCIDENTS) -> STORE_ROUTES.*`, `PRODUCT -> openProduct(productId)` (hoja de producto existente), `NONE -> sin enlace`; un tipo desconocido no se renderiza como enlace.
- **data-access**: rutas nuevas en `lib/data-access/paths.ts` (`storeBanners` = `/v1/store/banners`; `adminBanners`, `adminBanner(id)`, `adminBannerStatus(id)`, `adminBannersOrder` = `/v1/admin/banners…`), `services/banners.ts` con las 7 operaciones, tipos desde `@sushimon/contracts` (`StoreBanner*`, `AdminBanner*`, `CreateBannerRequest`…), handlers mock en `src/mocks/handlers/banners.ts` con la forma del contrato (códigos `BANNER_*`, `version`, alcance, caché simulada con `nextChangeAt`), fixtures en `src/mocks/fixtures/banners.ts`, escenarios (`banners-empty`, `banner-promotion-expired`), paridad mock/http en `parity.test.ts`. Permisos: `StaffPermission` es un patrón (sin cambio de tipo); `mocks/fixtures/rbac.ts` añade los 3 permisos (43 -> 46).
- **Backoffice** (pantalla nueva `features/bo-banners/`, **sin prototipo**): ruta `/backoffice/banners` con permiso `banners.read`, entrada de menú y `BackofficeScreen = 'banners'`. Reutiliza `PromotionsScreen`/`PromotionModal` como patrón (listado paginado con filtros de sucursal, estado derivado y búsqueda; modal de alta/edición; manejo de 409/422 por `code`; acciones ocultas si `editable=false` o falta el permiso). **Imagen**: reutiliza el gestor de medios de F14 (optimización cliente con perfil de banner, intent -> PUT -> complete, `MEDIA_STORAGE_UNAVAILABLE` conserva la edición de textos). **Previsualización** desktop/móvil sin publicar: el modal muestra el banner con la misma pieza de presentación que la tienda (componente `BannerSlide` extraído del carrusel) en las dos alturas, con el idioma elegido (es/en) y resaltando qué campos usan respaldo. Reordenar con arrastrar y soltar **y** botones subir/bajar accesibles (teclado) que llaman a `PUT /order`. Estados derivados con etiquetas y `hiddenReason` explicado. Aviso sobre cupones (D7).
- **Accesibilidad**: se conserva lo existente (teclas con flechas en los controles, pausa/reanudar visible, pausa por foco y puntero, `prefers-reduced-motion` sin avance automático, `inert` en las no activas, regiones y `aria-roledescription` localizados). Se añade: un solo banner => sin controles ni avance; `alt` de la imagen por idioma y `lang="es"` en los campos de respaldo; contraste >= 4.5:1 del texto sobre imagen (degradado oscuro bajo el texto; revisión de `ui-ux-reviewer`); CTA como `<a>` o `<button>` con nombre accesible (`ctaLabel` o etiqueta genérica); `aria-live="off"` mientras avanza solo (ya existe).
- **CLS y carga**: se reservan las alturas fijas actuales del carrusel (176/156/132/220/240 px) también en el estado de carga (esqueleto del mismo alto) para no desplazar el Inicio; imagen con `object-fit: cover`, `width/height` implícitos por el contenedor, `decoding="async"`; **la primera imagen con prioridad de carga** (`fetchpriority="high"`, sin `lazy`: es candidata a LCP) y las demás `loading="lazy"`; sin `next/image` optimizado ni `remotePatterns` (como F14: `<img>`/`unoptimized`). Si la lista llega vacía o falla (503/429/red), la sección se colapsa sin romper el Inicio (único desplazamiento posible; F17 lo evitará entregando el dato con el agregado del Inicio). Fallback de imagen: si `onError`, fondo de marca (`seigaiha`) con texto y CTA intactos, sin reintentos en bucle.
- i18n `src/i18n/messages/{es,en}.json`: `home.banner.cta`, `home.banner.fallbackAria`, textos del backoffice (`backoffice.banners.*`), estados derivados y `hiddenReason`; el contenido del banner (título, subtítulo, alt) NO va en los archivos de mensajes: viene de la API.
- Pruebas web: carrusel con datos de la API (orden, 1 banner sin controles, vacío, error de imagen, `fallbackFields` con `lang`), pausa/teclas/reducción de movimiento (las existentes), refetch en `nextChangeAt`, invalidación por query key, `bannerHref` cerrada (sin rutas de texto libre), pantalla de backoffice (permisos, `editable`, 409/422 por `code`, reordenar con teclado, previsualización), `parity.test.ts`.

## Modelo de datos (propuesta para `database-engineer`, migración `0017_banners`)

**No existe SQL todavía.** Incremental y no destructiva (`CREATE` + reemplazo de dos CHECK de `media_assets` + datos de referencia de permisos), relanzable (`IF NOT EXISTS` / guardas por catálogo), numerada tras la última de `develop`. Requiere 0002/0005 (staff, permisos), 0003 (branches), 0011 (categories), 0012 (products), 0015 (media_assets) y 0016 (promotions). RLS sin políticas + `REVOKE ALL` a `PUBLIC`, `anon`, `authenticated` (guardado por existencia de rol), como 0011–0016. `updated_at`/`version` los mantiene la API (sin triggers).

```
app.banners (
  id uuid pk default gen_random_uuid(),
  code text not null UNIQUE,                       -- normalizado (minúsculas) por la API y por CHECK; inmutable por la API
  image_asset_id uuid not null REFERENCES app.media_assets(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  cta_type text not null default 'NONE',
  cta_category_id uuid null REFERENCES app.categories(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  cta_product_id  uuid null REFERENCES app.products(id)   ON DELETE RESTRICT ON UPDATE CASCADE,
  cta_page text null,
  promotion_id uuid null REFERENCES app.promotions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  starts_at timestamptz(6) null, ends_at timestamptz(6) null,
  active boolean not null default true,
  sort_order integer not null default 0,
  version integer not null default 1,
  created_at timestamptz(6) not null default now(), updated_at timestamptz(6) not null default now(),
  CHECK code_format  : code ~ '^[a-z0-9][a-z0-9-]{2,63}$'
  CHECK cta_type     : cta_type IN ('NONE','MENU','PROMOTIONS','CATEGORY','PRODUCT','PAGE')
  CHECK cta_refs     : (cta_type='CATEGORY') = (cta_category_id IS NOT NULL)
                       AND (cta_type='PRODUCT') = (cta_product_id IS NOT NULL)
                       AND (cta_type='PAGE') = (cta_page IS NOT NULL)
  CHECK cta_page     : cta_page IS NULL OR cta_page IN ('CAREERS','TRACK_ORDER','INCIDENTS')
  CHECK period       : starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at
  CHECK sort_order   : sort_order BETWEEN 0 AND 9999
  CHECK version      : version >= 1 )
INDEX banners_active_order_idx ON (sort_order, created_at, id) WHERE active
INDEX banners_image_asset_idx  ON (image_asset_id)

app.banner_translations (
  banner_id uuid not null REFERENCES app.banners(id) ON DELETE CASCADE,
  locale text not null,
  title text null, subtitle text null, cta_label text null, image_alt text null,
  PRIMARY KEY (banner_id, locale),
  CHECK locale        : locale IN ('es','en')
  CHECK title_len     : title     IS NULL OR char_length(btrim(title))     BETWEEN 1 AND 80
  CHECK subtitle_len  : subtitle  IS NULL OR char_length(btrim(subtitle))  BETWEEN 1 AND 160
  CHECK cta_label_len : cta_label IS NULL OR char_length(btrim(cta_label)) BETWEEN 1 AND 40
  CHECK image_alt_len : image_alt IS NULL OR char_length(btrim(image_alt)) BETWEEN 1 AND 200
  CHECK es_required   : locale <> 'es' OR (title IS NOT NULL AND image_alt IS NOT NULL) )

app.banner_branches (
  banner_id uuid not null REFERENCES app.banners(id) ON DELETE CASCADE,
  branch_id uuid not null REFERENCES app.branches(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  PRIMARY KEY (banner_id, branch_id) )
INDEX banner_branches_branch_idx ON (branch_id, banner_id)

-- media_assets (F14), reemplazo de restricciones, sin tocar filas:
ALTER TABLE app.media_assets DROP CONSTRAINT media_assets_kind_chk;       -- guardado por existencia
ADD CONSTRAINT media_assets_kind_chk        CHECK (kind IN ('PRODUCT_IMAGE','BANNER_IMAGE'));
ADD CONSTRAINT media_assets_banner_size_chk CHECK (kind <> 'BANNER_IMAGE' OR size_bytes <= 1048576);
ADD CONSTRAINT media_assets_key_prefix_chk  CHECK ((kind = 'PRODUCT_IMAGE' AND object_key LIKE 'products/%')
                                                OR (kind = 'BANNER_IMAGE'  AND object_key LIKE 'banners/%'));

-- permisos (ver D9): INSERT en app.permissions ('banners.read','banners.create','banners.update') ON CONFLICT DO NOTHING;
-- asignarlos a admin (invariante: admin tiene todo el catálogo) y a ningún otro rol.
```

Notas para el `database-engineer`: (1) `media_assets_key_prefix_chk` falla de forma clara si alguna fila existente no cumple (no reescribe datos); si hubiera datos de desarrollo anómalos, usar `NOT VALID` + `VALIDATE` y avisarlo. (2) La coherencia «`es` existe» y «`branchScope` coincide con las filas» no es declarativa: la impone el servicio en la transacción (se prueba en `.int-spec`). (3) Sin índices en `cta_category_id`, `cta_product_id` ni `promotion_id` (F10/F11/F15 no borran; consulta de «qué banners usan X» sobre decenas de filas). (4) `Prisma`: modelos `Banner`, `BannerTranslation`, `BannerBranch`; relación inversa `MediaAsset.banners` para `usageCount`; CHECK parciales solo en SQL. (5) Pruebas `migration-0017.int-spec.ts`: CHECK de código/CTA (una sola referencia)/periodo/prioridad/traducciones (`es` sin título o alt rechazada, en blanco rechazado), `media_assets` (`BANNER_IMAGE` > 1 MiB rechazado, prefijo cruzado rechazado, `PRODUCT_IMAGE` existente intacta), FK `RESTRICT` (asset, promoción, categoría, producto, sucursal), cascada de traducciones/sucursales, unicidad de `code`, reaplicación, y que `admin` tiene los 46 permisos. (6) Reversión manual (solo sin datos): `DROP TABLE banner_translations, banner_branches, banners`; restaurar `media_assets_kind_chk` a solo `PRODUCT_IMAGE` y quitar los dos CHECK nuevos (solo si no hay assets `BANNER_IMAGE`); borrar los 3 permisos. (7) **Orden de despliegue**: aplicar la 0017 ANTES de desplegar la API de F16 (sin ella `GET /v1/store/banners` responde 500).

## Semántica del banner público (casos de prueba obligatorios; reloj inyectado, `America/Guatemala`)

| #   | Escenario                                                                           | Esperado                                                                                                        |
| --- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| B1  | `starts_at` = ahora; `ends_at` = ahora + 1 s                                        | publicado; a `ends_at` exacto NO (fin exclusivo)                                                                |
| B2  | `starts_at` = ahora + 1 s                                                           | no publicado; `SCHEDULED`; `nextChangeAt` = `starts_at`                                                         |
| B3  | `ends_at` NULL                                                                      | publicado sin fin; `nextChangeAt` solo por otros banners o `null`                                               |
| B4  | `ends_at <= starts_at`                                                              | 422 `BANNER_PERIOD_INVALID`                                                                                     |
| B5  | `active=false` con fechas correctas                                                 | nunca publicado; `INACTIVE`                                                                                     |
| B6  | Sin `branchId`: banner `ALL` y banner `SELECTED`                                    | solo el `ALL`                                                                                                   |
| B7  | `branchId` de sucursal en `SELECTED` / fuera de él / inexistente o inactiva         | sale / no sale / 404 `BRANCH_NOT_FOUND`                                                                         |
| B8  | Promoción vinculada vigente / `active=false` / futura / vencida / fuera de tramo    | sale / oculto / oculto / oculto / oculto; `hiddenReason=PROMOTION_NOT_LIVE`                                     |
| B9  | Promoción `SELECTED` que no incluye la sucursal consultada                          | oculto para esa sucursal; sin `branchId` solo si es `ALL`                                                       |
| B10 | `nextChangeAt` con banner y promoción                                               | el menor entre fechas del banner y cambio de la promoción; `max-age`/`s-maxage` según D10; pasado => `no-store` |
| B11 | Cupón vinculado                                                                     | la respuesta no contiene `code`, `kind`, `value`, `productIds` ni `promotionId`                                 |
| B12 | `locale=en` sin traducción `en`; con `en` solo título; con `en` subtítulo en blanco | todo en `es` con `fallbackFields` completo; título `en` y resto `es`; subtítulo en `es` (campo en respaldo)     |
| B13 | Sin fila `es` válida (dato corrupto)                                                | no se publica                                                                                                   |
| B14 | Imagen PENDING, `kind` distinto o sin base pública                                  | no se publica; sin 5xx                                                                                          |
| B15 | CTA a producto/categoría desactivado                                                | oculto; `CTA_TARGET_INACTIVE`                                                                                   |
| B16 | 11 banners elegibles                                                                | 10, por `sort_order`, `created_at`, `id`                                                                        |
| B17 | Dos banners con el mismo `sort_order`                                               | orden por `created_at` y luego `id`; resultado independiente del orden de inserción                             |
| B18 | Lista vacía                                                                         | 200 con `items: []`                                                                                             |
| B19 | `expectedVersion` obsoleto; reordenado concurrente                                  | 409 `BANNER_VERSION_CONFLICT`; solo uno de los órdenes enviados prevalece                                       |
| B20 | Imagen con asset inexistente / PENDING / `PRODUCT_IMAGE`                            | 422 `BANNER_IMAGE_INVALID` (`ASSET_UNKNOWN`, `ASSET_NOT_READY`, `ASSET_KIND_MISMATCH`)                          |
| B21 | CTA `CATEGORY` con `productId`; tipo `PAGE` fuera de la lista; `type` `EXTERNAL`    | 422 `BANNER_CTA_INVALID`; `EXTERNAL` => 400 (no existe en el enum)                                              |
| B22 | Actor con alcance acotado: `ALL`; `SELECTED` parcial; banner ajeno; reordenar       | 403 `BANNER_SCOPE_FORBIDDEN`; 403; 404 `BANNER_NOT_FOUND`; 403                                                  |

## Criterios de aceptación del backlog

| Criterio (ficha F16)                                               | Cómo se cumple                                                                                                       |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Imágenes, CTA, prioridad, idioma, vigencia, sucursal y visibilidad | D1–D6; `active` + estados derivados                                                                                  |
| Se apoya en Cloudflare R2                                          | D2: `BANNER_IMAGE` reutiliza F14 sin segundo cliente ni Image Resizing; `BLOCKED_EXTERNAL` hasta credenciales reales |
| Esquema y migración solo tras aprobación                           | La 0017 queda como **propuesta**; no se aplica a ninguna base sin aprobación humana                                  |
| Home con banners reales es/en y backoffice con CTA, prioridad, R2  | D12 (web `MOCK_ONLY` hasta integrar)                                                                                 |
| Vigencia, idioma, orden, sucursal                                  | D4–D6 y casos B1–B22                                                                                                 |

## Pruebas exigidas

**API**: políticas puras (código, CTA, traducciones, período, alcance, límites); lector público (B1–B18 con repositorio en memoria y reloj inyectado); servicio admin (D8/D9: `expectedVersion`, idempotencia sin escritura ni auditoría, `PATCH` parcial que no reemplaza omitidos, `23505` de `code`, imagen inexistente/PENDING/otro tipo, promoción inexistente o con alcance menor, alcance e IDOR, reordenado exacto/idempotente/concurrente, tope de 100, auditoría sin PII con diffs de imagen/CTA/fechas/sucursales/prioridad en la misma transacción, `BANNERS_BUSY`); `Cache-Control` (`no-store` admin, acotado público, sin `ETag`); cambios en F14 (`BANNER_IMAGE`: clave `banners/…`, 1 MiB, `usageCount`/`bannerUsages`, borrado 409); permisos (46); `contracts:check` verde. **BD real** (pendiente de aprobación): `migration-0017.int-spec.ts` y un `banners.int-spec.ts` con el SQL del lector y del reordenado. **Web**: ver D12. **R2 real**: ninguna prueba sin credenciales (lista de `docs/integrations/cloudflare-r2.md`).

## Tareas por dueño

1. `database-engineer`: migración `0017_banners` (3 tablas, CHECK, índices, RLS, `media_assets`, permisos), `schema.prisma`, `migration-0017.int-spec.ts`, párrafo definitivo en `docs/database/README.md`.
2. `api-engineer`: `src/banners/` (lector público + admin), ampliaciones de `src/media/` (tipo, clave, 1 MiB, usos por banners), 3 permisos y actualización de las pruebas «43» -> «46», `BANNERS_BUSY` en `PUBLIC_5XX_CODES`, utilitario de caché común, `contracts:check` verde.
3. `web-engineer`: carrusel con datos reales, `bannerHref`, hook, mocks y paridad, pantalla de backoffice con gestor de imagen de F14, previsualización, i18n.
4. `security-reviewer`: alcance/IDOR, CTA (sin rutas libres), divulgación de cupones, caché pública, imagen (MIME/tamaño), auditoría sin PII. `ui-ux-reviewer`: contraste sobre imagen, teclado, reducción de movimiento, CLS. `qa-engineer`: matriz B1–B22.

## Verificado / No verificado

### Implementación de la API (api-engineer)

**Implementado** (`sushimon-api/src/banners/`, `src/media/`, `src/common/http/bounded-cache.ts`):

- `BannersReadModule` (lectura pública: `PublicBannersReader`, `PublicBannersController`, `BannersReadRepository`, `BannersTimeService`; solo depende de `MediaModule`) y `BannersModule` (administración: `AdminBannersController/Service`, `BannersRepository`, políticas y vistas puras). Registrado en `AppModule`. `media` y `promotions` no importan `banners`; `banners` no importa `PromotionsModule` (reutiliza `analyzeTiming`/`isLive`/`lifecycleOf`/`HORIZON_MS` de `promotion-schedule.ts`).
- 7 operaciones del contrato con los mismos `operationId`, códigos y esquemas. `@RequireStaff('banners.read|create|update')` (aal2), alcance por sucursal (ALL exige global; SELECTED cubre todas; ajeno 404; parcial 403), PATCH parcial que no pisa lo omitido, `expectedVersion`, estado idempotente, `code` normalizado e inmutable, reorden atómico con `pg_advisory_xact_lock(hashtextextended('app:banners-order',0))`, `FOR NO KEY UPDATE` con autorización SIN candado antes y re-verificación tras bloquear, auditoría `banner.created|updated|status_changed|reordered` en la misma transacción, `BANNERS_BUSY` en `PUBLIC_5XX_CODES`, throttle de escritura (30/min por actor, 60/min por IP) y público (60/min por IP).
- Caché pública: lógica movida a `common/http/bounded-cache.ts` (`boundedCacheControl`, `BoundedCacheInterceptor`); `promotions-cache.ts` la re-exporta sin cambiar el comportamiento de F15.
- F14: `MediaKind` `BANNER_IMAGE` (`buildObjectKey(..., kind)`, `maxBytesFor` 1 MiB, `usageCount` = productos + banners, `bannerUsages`, filtro `unreferenced` y borrado 409 `MEDIA_IN_USE` por banners; mensaje «productos o banners»).
- Permisos 43 -> 46 en las pruebas de API (`staff-context.ts` `ALL_PERMISSIONS`, `staff.e2e-spec`, `staff.int-spec`).

**Verificado** (comandos reales ejecutados en `sushimon-api`, ver el informe de la PR para las cifras): `pnpm typecheck`, `pnpm lint`, `pnpm test` (unit), `pnpm test:e2e`, `pnpm contracts:check` (OK: tipos al día y API conforme al contrato) y `pnpm secrets:scan`. Casos B1–B18 cubiertos por `public-banners.reader.spec.ts` y `banners.e2e-spec.ts`; B19–B22 por `admin-banners.service.spec.ts` y `banners.e2e-spec.ts`; ruta de reorden y guards por `admin-routes-guards.e2e-spec.ts`.

**No verificado / pendiente**:

- **Verificado (2026-11-16)** contra PostgreSQL real (BD de pruebas con la 0017 aplicada): `test/banners.int-spec.ts` 14 pasan (lector con `JOIN`/`json_agg`, listado con `folded`/`LIKE`, FK `RESTRICT`, candado de fila, promoción vinculada). **NO verificado**: las 2 pruebas omitidas por diseño en BD compartida (reorden del conjunto completo con `UPDATE ... FROM unnest` y llenado/concurrencia del tope de 100); `migration-0017.int-spec` (se omite contra Supabase; corre en el CI).
- Los dobles en memoria (`test/support/fake-banners-repo.ts`) reimplementan los filtros del SQL: una divergencia solo la detectaría el `int-spec`.
- R2 y el CDN reales (`BLOCKED_EXTERNAL`); no se subió ninguna imagen real.
- `GET /v1/store/banners` responde 500 hasta que se aplique la 0017 (orden de despliegue: migración antes que API).
- Rendimiento, `EXPLAIN` de los índices y el tope de 100 bajo concurrencia real no se midieron. El tope de 100 se serializa con el candado de orden (probado solo con dobles en memoria; el caso de `banners.int-spec.ts` se omite en una BD compartida con banners ajenos).
- Web: la implementa otro ingeniero; la integración Next.js (`INTEGRATED`) no se verificó.

### Diseño original (spec)

**Verificado** (comandos ejecutados al escribir el contrato): lectura de los hechos citados con `archivo:línea`; `git ls-tree origin/develop sushimon-api/prisma/migrations/` (última = `0016_promotions`; sin `git fetch`, por lo que la referencia puede estar desactualizada); `pnpm contracts:generate` regenera `packages/contracts/src/schema.d.ts` sin error con las 7 operaciones y los 28 esquemas nuevos.
**No verificado**: el comportamiento de `ALTER TABLE ... ADD CONSTRAINT` con el prefijo de clave sobre datos reales; R2 y el CDN reales (`BLOCKED_EXTERNAL`); rendimiento y peso de imagen (el tope de 1 MiB y el lado de 1920 px son decisiones de diseño); la proporción 3:1 y la zona segura son recomendaciones sin validar con negocio ni con una imagen real; el contraste del texto sobre imagen real no se ha medido.

### Decisiones de implementación que concretan o se apartan de la spec

- **Destino `PAGE` fuera de la lista blanca**: `cta.page` es `string` en el DTO (no enum) para devolver 422 `BANNER_CTA_INVALID` (violation `TARGET_UNKNOWN`, B21) y no 400; el contrato lo declara enum `BannerPage`, lo que para un cliente tipado equivale a 400. `type` sí es enum cerrado (`EXTERNAL` => 400).
- **`BANNER_SCOPE_INVALID`** (422, no 400): `ALL` con `branchIds` o `SELECTED` vacío, como dice el contrato (F15 usa 400); se evalúa antes de la autorización por ser de forma.
- **Violaciones de imagen**: si el asset es de otro tipo y además está PENDING se informa `ASSET_KIND_MISMATCH` (una sola violación, el tipo manda).
- **Redacción del texto**: `normalizeText` rechaza NUL y controles bidi con `assertCleanText` de F15 (exportada) y colapsa espacios; en blanco = ausente. No se reutilizan `normalizeName/normalizeDescription` de F15 porque sus topes (120/500) y su obligatoriedad no encajan; mismo criterio de rechazo.
- **`fallbackFields`** solo lista los campos que vinieron en español **con texto** (un subtítulo ausente en ambos idiomas no es respaldo).
- **Tope de 100 no vencidos**: serializado con el candado de orden (ver M2). «No vencido» = `ends_at` nulo o futuro, activo o no.
- **Reorden idempotente** solo si todos los banners ya tienen `sort_order = índice`; si el orden relativo coincide pero hay empates/huecos, se renumera (versión+1 en los cambiados).
- **Validaciones de destino, imagen y promoción en PATCH** solo cuando ese bloque cambia (o cambian las sucursales, para la promoción): un destino que dejó de estar activo no impide editar otros campos (el banner queda oculto con `CTA_TARGET_INACTIVE`).
- **Subida de imagen**: sigue `catalog.update` global (P18), sin cambios en F14.
- **Fix de F14/F11 descubierto por F16 (M1, corregido en esta rama)**: `POST /v1/admin/products/{id}/media` y `PATCH /v1/admin/products/{id}` (enlace por URL) aceptaban un asset `BANNER_IMAGE`. Ahora `findAsset` selecciona `kind` y rechaza lo que no sea `PRODUCT_IMAGE` con 422 `PRODUCT_MEDIA_INVALID` (path `assetId`); `findReadyAssetsByKeys` filtra `kind='PRODUCT_IMAGE'`, así que una URL `banners/...` cae en «no corresponde a un medio confirmado» (mismo 422). Sin código nuevo ni cambio de contrato. Regresión en `product-media.service.spec.ts`. Es un cambio de F14/F11, no de F16: avisar en la PR.
- **Tope de 100 y candado (M2)**: `create` (no vencido) y `update` con `endsAt` futuro o nulo toman primero `lockOrder` (advisory `app:banners-order`) y después la fila (`FOR NO KEY UPDATE`); el reordenado ya toma orden -> filas. Mismo orden de candados siempre (sin ciclos). Prueba unitaria de altas/reaperturas concurrentes con 99 (solo una pasa) y caso en `banners.int-spec.ts` **sin ejecutar**. Sustituye la nota anterior de «carrera benigna».
- **Texto invisible (B2)**: `normalizeText` elimina U+200B, U+200C, U+200D, U+2060, U+00AD y U+FEFF antes de recortar; un título o alt solo con invisibles queda ausente (422 `BANNER_TRANSLATION_INVALID` en `es`). Efecto colateral aceptado: se pierden los ZWJ de secuencias de emoji compuestas. La web replica la regla por su cuenta (debe alinearse).
- **`reason` del estado (B1)**: pasa por `assertCleanText` (NUL/bidi => 400), una línea, recortado, máx. 200; en blanco => sin motivo.
- **Aceptados, sin cambios (B3/B4)**: `banners.read` ve el nombre de la promoción vinculada (nunca `code` ni descuento) y el `bannerCode` en los usos de un asset en la biblioteca de medios; las sucursales **inactivas** no se validan al escribir (se pueden asignar) y la tienda responde 404 `BRANCH_NOT_FOUND` para ellas.
- **`cta.page` y `BANNER_SCOPE_INVALID` (contrato)**: `BannerCtaInput.page` ahora es `string` (lista permitida en la descripción) para que una página fuera de lista sea 422 `BANNER_CTA_INVALID` y no 400 por enum; la respuesta `StoreBannerCta.page` conserva el enum. `BANNER_SCOPE_INVALID` es **422** en F16 (F15 usa 400 en la misma situación): diferencia consciente, la fija el contrato.
- **Precedencias fijadas**: `hiddenReason` = `PROMOTION_NOT_LIVE` > `CTA_TARGET_INACTIVE` > `IMAGE_UNAVAILABLE`. «Vencido» (tope de 100 y reordenado) = `endsAt <= ahora` por fecha, independiente de `active`. `order` por defecto `asc` también para `startsAt|endsAt|createdAt` (nulos al final). `unreferenced` de `listAdminMedia` cuenta productos y banners. `CreateBannerRequest.active` queda como está.
- **Pendiente de rendimiento (decisión futura, medir antes)**: la imagen es única, 3:1, de hasta 1920 px y 1 MiB, sin `srcset`. Una variante móvil o `srcset` exige imagen móvil (P20) o resizing; no se ha medido LCP ni peso real.
- **Rendimiento del lector**: `analyzeTiming` se memoiza por `promotion.id` dentro de `selectStoreBanners` (mismo resultado). No se hicieron más optimizaciones sin medir (sin `Promise.all` ni índices nuevos).

## Preguntas abiertas y asunciones

- **P18 (negocio)**: quién gestiona banners (hoy solo `admin`) y si el `manager` recibe `banners.read|update` para sus sucursales; ligado a P1/P16 y a la limitación de F14 (subida de imagen exige `catalog.update` global).
- **P19 (negocio)**: ¿se necesitan enlaces externos? Con qué dominios y política (D3).
- **P20 (negocio/diseño)**: ¿imagen móvil distinta? Hoy una sola imagen 3:1 recortada con `cover`.
- **P21 (negocio)**: ¿más ubicaciones además del carrusel del Inicio (p. ej. menú, promociones)?
- **P22 (negocio)**: si un banner de promoción no vigente debe ocultarse (adoptado) o mostrarse como «Próximamente»/«Terminó»; y si se necesita un banner sin imagen (solo texto).
- **Asunción**: máximo 10 banners publicados y 100 no vencidos; título <= 80, subtítulo <= 160, etiqueta <= 40, alt <= 200; `sort_order` 0..9999; 1 MiB para `BANNER_IMAGE`.
- **Asunción**: el `code` es inmutable (identificador estable para mocks, pruebas y F17); si negocio quiere renombrarlo se añade un `PATCH` con auditoría.
- **Asunción**: «campañas» se cubren con vigencia + vínculo a promoción; si negocio quiere agrupar varios banners en una campaña con nombre, será una entidad nueva (otra feature).
- **Riesgo**: texto de banner con el código de un cupón (divulgación): mitigado solo con aviso en la UI, auditoría y permisos (P17).
- **Riesgo**: la sección colapsa si la API falla o no hay banners (desplazamiento del Inicio) hasta que F17 entregue el dato con el agregado.
- **Riesgo**: `nextChangeAt` no ve cambios hechos por el backoffice; el desfase máximo es de 30 s por la caché compartida.
