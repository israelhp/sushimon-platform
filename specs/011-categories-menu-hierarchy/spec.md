# F10 — Categorías y jerarquía del menú

**Rama**: `feature/F10-categories-menu-hierarchy` (desde `develop` 353eb24)
**Prioridad**: P0 (backlog oficial) · **Dependencias**: F00, F03 (RBAC/seguridad admin) · **Integración posterior**: F11 (productos), F17 (agregados de tienda)
**Decisiones**: `docs/adr/0016-categorias-jerarquia-menu.md`
**Estado global**: `IN_PROGRESS` (partida). Contrato `CONTRACT_DEFINED`; API/BD/web se implementan en la misma rama y se reportan por componente.

## Alcance

Jerarquía padre/hijo del menú (máx. 3 niveles), orden estable, slug, visibilidad, lectura pública del árbol de categorías visibles y administración
(listar, crear, editar, mover, activar/desactivar, reordenar y, desde ADR-0034, eliminar una categoría sin uso) con auditoría. Fuera: productos (F11), imágenes de categoría, precios/disponibilidad por
sucursal (F13), localización por idioma de nombres (los textos son los del restaurante).

## Borrado (ADR-0034)

Revierte parcialmente la decisión original de «sin borrado físico». `DELETE /v1/admin/categories/{id}` (`deleteAdminCategory`): `catalog.update` global + `aal2`, 204 sin cuerpo, borrado
físico, sin `expectedVersion` (no hay columna de versión). Solo si la categoría no está en uso: sin subcategorías, sin productos (activos o inactivos) y sin banners residuales
(`banners.cta_category_id`). En uso => 409 `CATEGORY_IN_USE` con `usage {children, products, banners}`; nunca cascada ni reasignación. Mismo bloqueo de jerarquía (advisory 1100110);
las FK RESTRICT (23503) son la red de seguridad. Audita `category.deleted`. Desactivar (`active=false`) sigue siendo la alternativa reversible. Estado: `CONTRACT_DEFINED` (API y web pendientes).
La desaparición del menú público sigue los tiempos de caché de D7 (hasta ~6 min).

## Estados por componente

| Componente                                                         | Estado             | Nota                                                                     |
| ------------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------ |
| Contrato OpenAPI (5 operaciones) + tipos                           | `CONTRACT_DEFINED` | `pnpm contracts:check` en rojo hasta implementar la API (patrón F08/F09) |
| Migración `0011_categories` + modelo Prisma                        | propuesta          | Sin aplicar a bases reales; requiere aprobación humana                   |
| API `src/categories/` (admin + público + `CategoriesQueryService`) | pendiente          | `CONTRACT_DEFINED` → `API_IMPLEMENTED`                                   |
| Web: navegación del menú y pantalla admin de categorías            | pendiente          | La tienda sigue en mock hasta integrar; pasar a `http` solo tras la API  |
| FK `products.category_id → categories` y filtro por categoría      | pendiente (F11)    | F11 la declara en su migración                                           |
| Agregado de tienda con árbol (`/v1/me/storefront`)                 | pendiente (F17)    | F17 consume `CategoriesQueryService`                                     |

## Hechos verificados del repo

- DBML (`docs/references/monsushi_dbdiagram.dbml:135-143`): `app.categories (id, parent_id, slug unique, name, description, sort_order default 0, active default true)`.
  Sin marcas de tiempo (se añaden `created_at`/`updated_at`).
- `categories` no existe en migraciones (0001–0010) ni en `schema.prisma`. La siguiente migración libre es **0011**.
- Permisos existentes (ADR-0010): `catalog.read`, `catalog.create`, `catalog.update` (`catalog.manage_availability` queda para F13). No se crean permisos.
- Filtro de errores: `code` se propaga solo con `status < 500`; todo error lleva `Cache-Control: no-store`.
- No hay `ETag` en la API actual; las rutas públicas (F07) usan solo `Cache-Control`. F10 sigue ese patrón.

## Criterios de aceptación del backlog

| Criterio                        | Cómo se cumple                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Ciclos imposibles               | Servicio bajo bloqueo (D5) + `CHECK parent_id <> id` y trigger de BD anti-ciclo/profundidad (defensa en profundidad) |
| Orden estable                   | `sort_order`, luego `name`, luego `id` en todas las lecturas; reorder asigna 0..n-1 (D6)                             |
| Inactivas ocultas al público    | Visible solo si ella y todos sus ancestros están activos (D3)                                                        |
| Administración solo autorizados | JWT + personal activo + aal2 + permiso `catalog.*`; escrituras con alcance global (D8)                               |

## Decisiones (resumen; razones en ADR-0016)

- **D1 Modelo**: columnas del DBML + `created_at`/`updated_at`. `slug` único (índice único), `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 80. `name` 1–80 normalizado (NFC, recorte,
  colapso de espacios, sin caracteres de control); `description` ≤ 500 opcional; `sort_order >= 0` (`CHECK`). FK `parent_id` `ON DELETE RESTRICT`. ~~Sin DELETE~~
  (reemplazado por ADR-0034, ver «Borrado (ADR-0034)»): sin permiso nuevo.
- **D2 Profundidad**: máximo 3 niveles (raíz = 1). Al mover se valida `depth(destino) + altura(subárbol movido) <= 3`.
- **D3 Visibilidad efectiva**: `effectivelyVisible = active AND todos los ancestros active`. Desactivar un padre no toca a los hijos; el admin ve ambos valores.
  Un hijo activo bajo un padre inactivo no aparece al público ni puede recibir hijos nuevos (padre inactivo => `CATEGORY_PARENT_INVALID`).
- **D4 Slug**: opcional al crear (se genera desde el nombre: minúsculas, sin acentos, kebab, ≤ 80; desambigua con `-2`, `-3`…); explícito y existente => 409
  `CATEGORY_SLUG_TAKEN`. Editable por PATCH (cambiar el slug rompe URLs públicas: lo asume quien edita; no hay historial de slugs en F10). Unicidad también ante concurrencia
  (índice único + captura de `P2002` => 409).
- **D5 Concurrencia**: toda escritura que cambia la estructura (crear con padre, mover, activar/desactivar, reordenar) toma un `pg_advisory_xact_lock` único de
  jerarquía de categorías dentro de la transacción (escrituras poco frecuentes; la tabla es pequeña, ≤ 500). Evita ciclos y excesos de profundidad por carreras.
  El trigger de BD repite las comprobaciones como red de seguridad.
- **D6 Orden**: hermanos por `sort_order, name, id`. Crear/mover coloca al final (`max+1`). `PUT reorder` exige EXACTAMENTE los hermanos actuales del padre
  (incluye inactivos), sin duplicados ni ajenos; si no => 422 `CATEGORY_REORDER_MISMATCH` sin escribir. Asigna 0..n-1, **200** con la lista de hermanos ordenada
  (la UI repinta sin otra petición; 204 se descartó). Idempotente: mismo orden => 200 sin escribir ni auditar.
- **D7 Lecturas**: público `GET /v1/store/categories` => `{items: PublicCategory[]}` anidado, ligero (id, slug, name, description, children), `Cache-Control: public,
max-age=60, stale-while-revalidate=300`, sin `ETag`. Admin `GET /v1/admin/categories` => lista plana `{items,total}` con todas (tope 500; crear la 501 =>
  422 `CATEGORY_LIMIT_REACHED`), orden depth-first, filtros `active`, `parentId` (hijos directos), `q` (nombre/slug); `Cache-Control: no-store`.
- **D8 Autorización**: rutas admin con `@RequireStaff()` (aal2). Lectura: `catalog.read` con cualquier alcance. Escrituras: `catalog.create` (POST) y `catalog.update`
  (PATCH, reorder) y alcance GLOBAL (`authorization.scopeFor(staff, perm).allBranches`); un alcance solo por sucursal => 403 (las categorías son globales, no de una sucursal).
  Autorización solo en el servidor.
- **D9 Auditoría** (misma transacción, sin PII): `category.created`, `category.updated` (old/new solo de lo cambiado), `category.activated`, `category.deactivated`,
  `category.reordered` (parentId + ids antes/después). Sin cambios reales => no se audita.
- **D5b Tiempos**: las escrituras ejecutan `SET LOCAL lock_timeout = '3s'` antes de `pg_advisory_xact_lock(1100110)` y abren la transacción con `timeout 15000` /
  `maxWait 5000`; `55P03`/`P2028` => 503 `CATEGORIES_BUSY` (mensaje fijo; `code` en la lista pública de 5xx). Un UNIQUE solo es 409 si el objetivo es `slug`.
- **D7b Seguridad de contenido y caché**: `description` es **texto plano** (la web no debe usar `dangerouslySetInnerHTML`). Con la caché pública
  (`max-age=60` + `stale-while-revalidate=300`) una categoría desactivada puede seguir visible hasta ~6 minutos: decisión aceptada.
- **D10 Puerto para F11/F17**: `CategoriesQueryService` exportado por `CategoriesModule` con `findVisibleTree()`, `findVisibleBySlug(slug)` (categoría visible + ancestros
  - hijas visibles, o `null`) y `getVisibleIds(rootId?)` (ids visibles, p. ej. para filtrar productos por subárbol). Solo lectura; F10 los implementa y prueba
    pero no construye productos ni agregados.
- **D11 Módulos**: nuevo `src/categories/` (`CategoriesModule`, `PublicCategoriesController`, `AdminCategoriesController`, `AdminCategoriesService`,
  `CategoriesQueryService`, repositorio). `AppModule` solo lo compone. Web: `features/catalog` (navegación) y `features/backoffice/categories`.

## Modelo de datos (propuesta para `database-engineer`, migración `0011_categories`)

```
app.categories (
  id uuid pk default gen_random_uuid(),
  parent_id uuid null REFERENCES app.categories(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  slug text not null UNIQUE, name text not null, description text null,
  sort_order integer not null default 0, active boolean not null default true,
  created_at timestamptz(6) not null default now(), updated_at timestamptz(6) not null default now(),
  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 80),
  CHECK (char_length(name) BETWEEN 1 AND 80), CHECK (description IS NULL OR char_length(description) <= 500),
  CHECK (sort_order >= 0), CHECK (parent_id IS NULL OR parent_id <> id) )
INDEX categories_parent_sort_idx ON app.categories (parent_id, sort_order, name, id)
TRIGGER anti-ciclo y profundidad <= 3 (BEFORE INSERT OR UPDATE OF parent_id)
```

RLS: `ENABLE ROW LEVEL SECURITY` sin políticas + `REVOKE` como 0006/0007 (la API usa la conexión privilegiada). El DBML de `docs/references` no se edita.

## Errores

| HTTP | `code`                      | Cuándo                                                                               |
| ---- | --------------------------- | ------------------------------------------------------------------------------------ |
| 400  | (validación)                | Forma/UUID inválidos, cuerpo vacío en PATCH, propiedades desconocidas                |
| 401  | —                           | Sin JWT válido                                                                       |
| 403  | —                           | No es personal activo, falta permiso, no aal2, o alcance no global en escritura      |
| 404  | —                           | Categoría (PATCH) o `parentId` (reorder) inexistente                                 |
| 409  | `CATEGORY_SLUG_TAKEN`       | Slug ya usado (explícito o en carrera)                                               |
| 422  | `CATEGORY_CYCLE`            | Mover a sí misma o a un descendiente                                                 |
| 422  | `CATEGORY_DEPTH_EXCEEDED`   | El árbol resultante superaría 3 niveles                                              |
| 422  | `CATEGORY_PARENT_INVALID`   | Padre inexistente o inactivo al crear/mover                                          |
| 422  | `CATEGORY_REORDER_MISMATCH` | `orderedIds` no es exactamente el conjunto de hermanos                               |
| 422  | `CATEGORY_LIMIT_REACHED`    | Ya existen 500 categorías                                                            |
| 503  | `CATEGORIES_BUSY`           | Lock de jerarquía (`lock_timeout` 3 s) o timeout de transacción (15 s); reintentable |

## Contrato (resumen)

`listStoreCategories` (público) · `listAdminCategories` · `createAdminCategory` · `updateAdminCategory` · `reorderAdminCategories`. Esquemas: `PublicCategory`,
`PublicCategoryTree`, `AdminCategory`, `AdminCategoryList`, `CreateCategoryRequest`, `UpdateCategoryRequest`, `ReorderCategoriesRequest`; parámetro `CategoryId`; tag `categories`.
`contracts:check` exige que la API declare exactamente los códigos 200/201/400/401/403/404/409/422 listados por operación.

## Contrato con F11 / F17

- F11: `products.category_id` FK a `app.categories(id)` (`ON DELETE RESTRICT`) en su migración; consume `getVisibleIds`/`findVisibleBySlug`. Un producto en categoría
  no visible no se publica. No hay productos en F10.
- F17: `GET /v1/me/storefront` reutiliza `findVisibleTree()`; F10 no modifica ese endpoint.

## Pruebas exigidas

Unitarias/servicio: ciclo (a sí misma, a descendiente), profundidad (crear y mover subárbol), padre inactivo/inexistente, slug generado y desambiguado, 409 explícito,
reorder exacto/idempotente/ajeno/duplicado, visibilidad efectiva con padre inactivo e hijo activo, orden estable con empates, tope 500. Autorización: sin JWT 401, no staff/sin aal2/sin
permiso 403, alcance por sucursal 403 en escrituras y lectura OK, público sin auth. Auditoría: una fila por operación real y ninguna si no hay cambios. Contrato: `contracts:check`.
Web: árbol público solo visibles; admin crea/edita/mueve/activa/reordena y mapea cada `code` a un mensaje (nunca por `message`). BD (con base real, pendiente de aprobación): trigger anti-ciclo.

## Tareas por dueño

1. `database-engineer`: migración `0011_categories` + modelo Prisma + trigger + RLS.
2. `api-engineer`: módulo `categories`, controladores, servicios, `CategoriesQueryService`, auditoría, pruebas; `contracts:check` verde.
3. `web-engineer`: navegación pública con `http` para categorías, pantalla admin (árbol, crear/editar/activar/reordenar), errores por `code`; mocks alineados al contrato.
4. `security-reviewer` / `qa-engineer`: revisión de alcance global, bloqueo y trigger; matriz de pruebas.

## Preguntas abiertas y asunciones

- El orden depth-first del listado admin la calcula el servidor; la UI no re-ordena.
- Cambiar el slug no deja redirecciones (sin historial); se evalúa con SEO/F17.
- `name` único por padre NO se exige (solo el slug es único), para no bloquear homónimos legítimos.
- Nombres y descripciones sin traducción es/en en F10 (los textos de menú son del restaurante); i18n de contenido queda fuera.
