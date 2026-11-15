# ADR-0012 Perfil de cliente: identidad (Supabase Auth) frente a perfil comercial (Sushi Mon)

**Estado**: **propuesta** (F04). Complementa a ADR-0009 (identidad) y ADR-0010 (RBAC); no los reemplaza.

**Contexto**: F01 ya expone `GET /v1/me` y crea el perfil de forma idempotente (`IdentityService.ensureCustomer`,
restricción UNIQUE sobre `app.customers.auth_user_id`, reintento ante `P2002`). F04 necesita editar nombre y teléfono,
mostrar el correo de Google en solo lectura y dar un contrato agregado para Mi cuenta, sin duplicar identidades ni
tablas. El DBML de `app.customers` tiene `id`, `auth_user_id` (unique, FK a `auth.users`), `full_name`, `email`, `phone`
y `created_at`; no tiene fecha de actualización.

## Decisión

1. **Identidad y perfil son cosas distintas.** `auth.users` es la fuente del UUID, el correo, el proveedor y la sesión.
   `app.customers` guarda solo los datos comerciales (`full_name`, `phone`) más el correo como **copia de contacto**
   tomada al crear el perfil. Esa copia no decide nada de autorización. Los pedidos (F20) conservarán su propio
   correo de contacto.
2. **Sin cambios de esquema.** No se añade migración: la unicidad por identidad ya existe y el DBML no define
   `updated_at`. Añadirla requeriría ADR y migración coordinadas con la base compartida; no es necesaria para F04.
3. **Creación idempotente en el primer acceso** (sin trigger sobre `auth.users`). Un trigger en Supabase Auth podría
   bloquear el alta de usuarios ante un error de base de datos; por eso el perfil se crea desde la API, bajo demanda,
   con UNIQUE + reintento ante carrera. El `PATCH` también puede crearlo si falta (camino raro, un solo reintento).
4. **Edición acotada.** `PATCH /v1/me` acepta solo `fullName` y `phone` (`additionalProperties: false`, 400 para
   cualquier otro campo). El sujeto se toma siempre del JWT verificado; no hay identificadores en la ruta ni en el cuerpo.
   Omitido = sin cambios; `phone: null` borra el teléfono. Los campos de F05 (dirección predeterminada) no entran aquí.
5. **Normalización antes de persistir.** Nombre: se recortan y colapsan espacios, longitud 2–120, solo letras (con
   tildes y ñ), apóstrofos, guiones, puntos y al menos una letra. Teléfono: Guatemala `+502XXXXXXXX` (con o sin 502);
   internacional `+` y 8–15 dígitos. No se asume prefijo local, para no rechazar números válidos. Un código +502 con
   longitud incorrecta se rechaza.
6. **Nombre inicial de Google.** Solo se usa al crear el perfil. Nunca sobrescribe el nombre guardado. El
   `user_metadata` es editable por el usuario y no se usa para autorizar.
7. **Avatar.** Solo se expone la URL de la identidad si es `https` y del dominio `lh3.googleusercontent.com`. No se
   copia a almacenamiento propio (F14/R2 no entra en F04).
8. **Clientes que también son empleados.** Un UUID puede tener una fila en `customers` y otra en `staff_users`. No se
   crea un segundo usuario de Auth, y F04 no concede permisos: la autorización administrativa sigue en F03 y ADR-0010.
   `GET /v1/me/storefront` no exige `aal2`, porque es datos de cliente, no administración.
9. **Contrato agregado sin ficción.** `GET /v1/me/storefront` devuelve identidad, perfil, `isStaff` y
   `pendingSections: [addresses, favorites, orders]`. No lleva contadores de F05/F06/F23 para no mostrar un `0` que
   no se ha consultado.
10. **Caché y privacidad.** Respuestas privadas: sin caché pública (la ruta hereda el comportamiento por defecto y
    no se marca como cacheable). En la web, las consultas viven bajo `['account', …]` y se eliminan al cerrar sesión.
11. **Auditoría.** No se escriben eventos en `app.audit_events` para cambios de cliente: su `actor_id` referencia
    `staff_users`, así que un cliente no puede ser actor. Se registra solo un evento técnico sin datos personales.
    Coordinar con F36 si se requiere auditoría de datos personales.
12. **Eliminación y conservación.** F04 no borra clientes. Las solicitudes de eliminación o anonimización y la
    conservación de pedidos quedan para una política aprobada posterior; no se borran pedidos al editar el perfil.

## Consecuencias

- `GET /v1/me` (F01) y `PATCH /v1/me` (F04) comparten ruta y contrato `MeResponse`.
- Pendiente de F05: dirección predeterminada en el contrato, y la web la simula en `PUT /v1/demo/me/default-address`.
- Pendiente de F06/F23: secciones `addresses`, `favorites`, `orders` de `pendingSections`.
- Pendiente de F19: el checkout solo guarda nombre y teléfono en el perfil, y únicamente si el cliente marca la casilla.
- Riesgo residual: sin `updated_at` ni versión, dos ediciones simultáneas gana la última (aceptable para un perfil simple).
