# ADR-0016 Categorías: jerarquía de 3 niveles, visibilidad efectiva y administración global

**Estado**: **propuesta** (2026-11-15, F10). Se acepta al fusionar `specs/011-categories-menu-hierarchy`.

**Contexto**: el DBML define `app.categories (id, parent_id, slug, name, description, sort_order, active)` sin FK declarada ni restricciones. F10 debe ofrecer
jerarquía, orden estable, visibilidad y administración, y dejar a F11 (productos) y F17 (agregados) un punto de lectura estable. Las categorías son del menú global
del restaurante, no de una sucursal (la disponibilidad por sucursal es de F13).

## Decisión

1. **Tabla** `app.categories` (migración `0011_categories`): columnas del DBML + `created_at`/`updated_at`; slug único kebab (≤ 80); `name` 1–80; `description` ≤ 500;
   `sort_order >= 0`; FK `parent_id` **`ON DELETE RESTRICT`**; RLS sin políticas + `REVOKE` (como 0006/0007). **Sin borrado físico**: ni endpoint ni permiso; se
   desactiva con `active=false` (los productos de F11 referenciarán la categoría y el histórico no debe romperse).
2. **Profundidad máxima 3** (raíz = 1): suficiente para menú de restaurante (p. ej. Rolls > Fríos > Veganos), acota consultas y la UI.
3. **Ciclos imposibles por capas**: (a) servicio dentro de una transacción con `pg_advisory_xact_lock` de jerarquía (las escrituras son raras y la tabla ≤ 500;
   serializa mover/crear/reordenar), (b) `CHECK parent_id <> id` y trigger `BEFORE INSERT/UPDATE OF parent_id` que recorre ancestros y rechaza ciclo o profundidad > 3.
   Se descartó solo trigger (mensajes de error pobres) y solo servicio (sin red de seguridad ante accesos directos/migraciones).
4. **Visibilidad efectiva** = ella y todos sus ancestros activos. Desactivar un padre **no modifica** a los hijos (reversible sin perder su estado propio);
   el público solo ve el árbol efectivo y el admin ve `active` y `effectivelyVisible`. Se descartó la cascada de escritura (pierde el estado previo de cada hijo).
5. **Orden**: `sort_order, name, id` siempre. `PUT reorder` exige el conjunto exacto de hermanos (422 `CATEGORY_REORDER_MISMATCH` si no) para que dos editores
   concurrentes no pisen categorías ajenas; renumera 0..n-1; responde **200** con los hermanos (la UI no necesita otra lectura); idempotente.
6. **Lecturas**: público = árbol anidado ligero con `Cache-Control: public, max-age=60, stale-while-revalidate=300`; sin `ETag` (la API no tiene el patrón y el
   payload es pequeño). Admin = lista plana (tope 500, `no-store`) con `effectivelyVisible` y `depth`; evita paginar un conjunto pequeño y deja a la UI armar el árbol.
7. **Autorización** sin permisos nuevos: lectura `catalog.read` (cualquier alcance), POST `catalog.create`, PATCH/reorder `catalog.update`; las **escrituras exigen
   alcance global** porque una categoría afecta a todas las sucursales (un gerente de una sola sucursal podría alterar el menú de las demás). Todas con aal2.
8. **Auditoría** en la misma transacción: `category.created|updated|activated|deactivated|reordered`; sin cambios reales no se audita.
9. **Puerto para consumidores**: `CategoriesQueryService` (`findVisibleTree`, `findVisibleBySlug`, `getVisibleIds`) exportado por `CategoriesModule`; F11/F17 dependen
   de él y no de tablas ni repositorios. F11 añade la FK `products.category_id` en su migración.
10. **Errores** estables con `code` (409/422): `CATEGORY_SLUG_TAKEN`, `CATEGORY_CYCLE`, `CATEGORY_DEPTH_EXCEEDED`, `CATEGORY_PARENT_INVALID`, `CATEGORY_REORDER_MISMATCH`,
    `CATEGORY_LIMIT_REACHED`. Los clientes ramifican por `code`.

## Detalles operativos (revisión de seguridad/rendimiento)

- **Bloqueo de jerarquía**: `SELECT pg_advisory_xact_lock(1100110)` (clave bigint única, la misma que usa el trigger de la migración 0011). La API lo toma
  PRIMERO en cada alta, PATCH y reorder, en READ COMMITTED, y solo después lee y valida. Antes ejecuta `SET LOCAL lock_timeout = '3s'`; la transacción se abre
  con `timeout: 15000` y `maxWait: 5000`. Un lock_timeout (SQLSTATE `55P03`) o un timeout de transacción de Prisma (`P2028`) se responden **503 `CATEGORIES_BUSY`**
  (mensaje fijo, reintentable; `code` público en 5xx).
- **Trigger de BD (red de seguridad)**: `ERRCODE 23514` con mensaje `categories_parent_cycle` (=> 422 `CATEGORY_CYCLE`) o `categories_max_depth`
  (=> 422 `CATEGORY_DEPTH_EXCEEDED`); otro CHECK => 400 genérico sin nombre de restricción.
- **UNIQUE**: solo la violación del índice único de `slug` (`categories_slug_key`) se traduce a 409 `CATEGORY_SLUG_TAKEN`; cualquier otra o de objetivo
  desconocido sigue siendo 500 genérico (no se disfraza).
- **`description` es texto plano**: la API solo normaliza (NFC, recorte, sin caracteres de control) y NO sanea HTML. Los clientes (web) deben renderizarla como texto
  y nunca con `dangerouslySetInnerHTML`.
- **Caché pública (SWR)**: con `max-age=60` + `stale-while-revalidate=300`, tras desactivar una categoría puede seguir visible hasta ~6 minutos en cachés
  compartidas/navegadores. Es una decisión aceptada (D7); la API no puede purgar CDN.

## Consecuencias

- Un único bloqueo global de jerarquía serializa escrituras de categorías: aceptable (backoffice, pocas escrituras), simple y sin Redis ni colas.
- Cambiar un slug rompe URLs públicas previas (sin historial en F10).
- El tope de 500 categorías es una restricción del contrato; si se supera hará falta paginar (cambio de contrato).
- Sin DELETE, las categorías obsoletas permanecen inactivas; F11 decide cómo tratar productos asociados.
- El DBML de `docs/references` no se edita; la evolución queda en la migración y este ADR.

## Alternativas descartadas

`ltree`/closure table (sobreingeniería para 3 niveles y ≤ 500 filas); cascada de `active` a hijos; borrado físico con reasignación; `ETag` débil; 204 en reorder.
