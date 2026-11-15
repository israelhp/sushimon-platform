# ADR-0014 Direcciones guardadas del cliente (F05)

**Estado**: **propuesta** (F05, rama `feature/F05-customer-addresses`). Se acepta al fusionar la rama.

**Contexto**: el DBML define `app.customer_addresses` (sin `deleted_at`). F04 dejó `GET /v1/me/addresses` como
pendiente y la web simula la dirección predeterminada con `PUT /v1/demo/me/default-address`. F09 (ADR-0013) aporta
los catálogos `departments` y `municipalities`. F20 guardará un snapshot propio de la dirección del pedido
(`app.order_addresses`). PedidosYa sigue `BLOCKED_EXTERNAL`: guardar una dirección no implica cobertura.

## Decisiones

1. **Propiedad**: el dueño sale siempre de la identidad verificada (JWT → `app.customers.id` vía `IdentityService`).
   El cuerpo nunca elige propietario. Una dirección ajena responde **404** (`ADDRESS_NOT_FOUND`), igual que una
   inexistente, para no permitir enumeración (IDOR).
2. **Modelo**: se usa la tabla del DBML. Migración `0008_customer_addresses`, aditiva, con CHECKs de longitud y rango,
   FK `customer_id → customers` con `ON DELETE CASCADE` y `municipality_id → municipalities` con `RESTRICT`, y RLS
   activo sin políticas (acceso solo vía API), como en 0006 y 0007. No se duplica el departamento: se obtiene del
   municipio.
3. **Etiqueta**: `label` es texto libre de 1 a 40 caracteres (no un enum). La UI ofrece Casa, Trabajo y Otra como
   atajos. El DBML la define como `text`.
4. **Límite**: máximo **10** direcciones por cliente (`ADDRESS_LIMIT_REACHED`, 409), igual que el prototipo. Se
   comprueba bajo bloqueo (ver 7), así que es exacto también con solicitudes concurrentes.
5. **Duplicado**: misma línea normalizada (NFC, minúsculas, espacios colapsados), mismo municipio y misma zona
   (`ADDRESS_DUPLICATE`, 409). La etiqueta y la referencia **no** cuentan. Dos líneas iguales en municipios distintos
   no son duplicadas. No hay restricción única en SQL: sería demasiado estricta para el negocio.
6. **Predeterminada**: la primera dirección queda predeterminada. Después solo cambia con
   `PATCH /v1/me/addresses/{id}/default` (idempotente) o con `isDefault: true` al crear. El PATCH de edición no admite
   `isDefault`. Al borrar la predeterminada se reasigna la más antigua restante (`createdAt`, `id`); si no quedan
   direcciones, no hay predeterminada.
7. **Invariante de base**: índice **único parcial** `customer_addresses_one_default_key ON (customer_id) WHERE
is_default`. Las mutaciones toman `SELECT … FOR UPDATE` sobre la fila del cliente, así que límite, duplicado y
   predeterminada se comprueban y escriben de forma serializada por cliente. El índice es la última barrera.
8. **Sin cobertura ni tarifa**: crear o editar una dirección solo valida formato y que el municipio exista. No
   consulta PedidosYa, no calcula tarifas y no guarda ningún resultado de cobertura. F09/F19 evalúan la cobertura
   cuando el cliente elige la dirección para un pedido.
9. **Coordenadas**: opcionales, pero latitud y longitud van juntas o ambas nulas (`COORDINATES_PAIR`). Rangos
   −90…90 y −180…180, redondeo a 7 decimales (`numeric(10,7)`). Nunca se inventan coordenadas.
10. **Borrado físico**: `DELETE` borra la fila. No hay borrado lógico (sin necesidad justificada). No hay cascadas
    hacia pedidos: F20 conserva su snapshot.
11. **Auditoría**: `app.audit_events` con `actor_id = null` (el cliente no es personal de `staff_users`) y
    `entity_type = customer_address`. No registra contenido de la dirección (es PII): solo `customerId`, los
    campos que cambiaron por nombre y el valor de predeterminada.
12. **Errores**: `ADDRESS_NOT_FOUND` 404, `ADDRESS_LIMIT_REACHED` y `ADDRESS_DUPLICATE` 409,
    `MUNICIPALITY_NOT_FOUND` y `ADDRESS_INVALID` 400 (con `violations[]`). Ningún error incluye identificadores de
    otros clientes.
13. **F04**: `addresses` sale de `pendingSections` de `GET /v1/me/storefront`. Los contadores siguen sin existir.

## Consecuencias

- La web consume la API real para direcciones (`services/account.ts` mapea `CustomerAddressResponse` a la vista de
  UI). La etiqueta se guarda como texto (`Casa`, `Trabajo` o el nombre propio); la UI reconstruye el enum. La
  predeterminada se deriva del listado (`isDefault`), no de `/v1/me`. El selector de checkout guarda con el
  `municipalityId` del catálogo de F09.
- Las pruebas de integración contra PostgreSQL (`test/customer-addresses.int-spec.ts` y `customers.int-spec.ts`)
  pasan en la base de pruebas (10/10). Requieren `DATABASE_URL_TEST` y se omiten sin ella.
- Pendientes fuera de F05: cotización (F19), creación de pedidos y snapshot (F20), cobertura real de PedidosYa (F29).
