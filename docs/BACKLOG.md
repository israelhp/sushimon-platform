# SushiMon Platform — Backlog maestro F00–F40

> **Versión de referencia para las dos computadoras.** Documento de alcance y dependencias, **no** autorización para desarrollar todas las features. Cada sesión de Claude Code puede implementar **solo la feature solicitada explícitamente**.
>
> **Fuentes de base:** _SushiMon_Plan_Maestro_Features_API_Trabajo_Paralelo.docx_ (ed. 12/11/2026), _monsushi_dbdiagram(1).dbml_, prototipos de tienda/backoffice y decisiones posteriores del proyecto. **Actualizaciones de negocio que prevalecen:** PedidosYa Courier como cobertura externa principal, integración real pendiente de API y sandbox, `ownDeliveryZonesEnabled=false` por sucursal para zonas propias, reparto propio independiente de PedidosYa. Los endpoints son **propuestos**, no una afirmación sobre código implementado.

## 0. Instrucciones que nunca deben olvidarse

- Repositorio monorepo: `sushimon-api` (NestJS + Express + Prisma + Supabase PostgreSQL), `sushimon-web` (Next.js, tienda y backoffice). **Inspeccionar nombres/rutas reales antes de editar.**
- **NO recrear** el orquestador, `.claude/agents`, `.claude/skills`, `.claude/rules`, hooks ni Spec Kit. Leer los `CLAUDE.md` vigentes.
- **NO empezar el siguiente FXX** tras completar el actual. Backlog completo = conocimiento; orden de ejecución lo define el usuario.
- Aplicar _UI First → Contract First → Vertical Slice_: cada feature incluye API y su integración Next.js **salvo las excepciones marcadas expresamente** (infraestructura o carrito local). No declarar READY una feature full-stack si su pantalla solo tiene Mock Data.
- La integración real de **PedidosYa Courier (F29) está BLOCKED_EXTERNAL**; sus coberturas/cotizaciones/solicitudes/tracking no pueden presumirse disponibles. F09 crea el contrato y las zonas propias; su proveedor PedidosYa real devuelve `UNKNOWN` cuando no se puede verificar. Adaptadores simulados nunca habilitan entregas reales.
- **Neonet F25** también necesita documentación/sandbox/homologación para operaciones reales. WhatsApp depende del canal aprobado; no afirmar envíos sin pruebas.
- Dirección, precio, cobertura, promociones, pedido y pago deben validarse en NestJS; nunca confiar en montos/roles del navegador. Los accesos administrativos requieren empleado autorizado, MFA `aal2`, permiso y alcance de sucursal.
- **No confundir** `branches.active` con `isOpenNow` ni `isAcceptingOrders`, ni la cobertura `OWN` con la externa `PEDIDOSYA`.
- Sin push/merge/deploy, migraciones destructivas o cambios de producción sin permiso. Dos equipos pueden compartir Git, pero **la base de datos compartida no está aislada por ramas**.
- Antes de ejecutar F10 o una feature posterior, ejecutar la auditoría F00–F09 de `docs/AUDITORIA_F00_F09.md`. Resultados del repositorio, **no presunciones**.

## 1. Estados y criterio de finalización

| Estado             | Definición                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `NOT_VERIFIED`     | Existe una afirmación de avance, pero falta inspeccionar implementación, tests o integración. No equivale a READY. |
| `NOT_STARTED`      | Confirmado que no se inició. No presumirlo solo por no encontrar la rama local.                                    |
| `IN_PROGRESS`      | Código iniciado; faltan capacidades o validaciones.                                                                |
| `READY`            | Alcance comprometido implementado, API + WEB según la ficha, contratos, pruebas y seguridad aprobados.             |
| `MOCK_READY`       | Contrato/adapter/demo funcionan solo con datos simulados identificados.                                            |
| `BLOCKED_EXTERNAL` | Operación real depende de un tercero no habilitado. La parte interna puede estar READY/MOCK_READY.                 |

**Estado inicial de F00–F09:** `NOT_VERIFIED` hasta auditar código local, `develop`, PRs, migraciones y pantallas reales. La indicación de que ya se trabajaron no constituye evidencia de cierre. **F10–F40:** estado por determinar desde Git/PRs; no presuponer sin comenzar.

## 2. Matriz ejecutiva de dependencias y alcance

**Dependencia para empezar** = componente/contrato mínimo necesario. **Integración para cerrar** = feature relacionada que se puede integrar después sin bloquear trabajo independiente. Al fijar READY, se exige que las integraciones **comprometidas en el alcance de esa feature** estén reales; la integración externa bloqueada se reporta aparte.

| ID  | Feature                                               | Dueño | Prioridad           | Tipo y alcance                                                            | Dependencia para empezar                                                                                 | Integración posterior                                                 |
| --- | ----------------------------------------------------- | ----- | ------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| F00 | Fundamentos de API y estándares transversales         | A     | P0                  | API/infraestructura + integración técnica WEB; sin pantalla comercial     | Ninguna                                                                                                  | F01–F40 reutilizan sus contratos                                      |
| F01 | Google OAuth y contexto de sesión                     | A     | P0                  | API + WEB (tienda y backoffice)                                           | F00                                                                                                      | F02/F03/F04; autenticación transversal                                |
| F02 | MFA TOTP obligatorio en backoffice                    | A     | P0                  | API + WEB (flujo administrativo)                                          | F01                                                                                                      | F03; guards administrativos de F07–F40                                |
| F03 | Empleados, roles, permisos y asignaciones             | A     | P0                  | API + WEB (administración de empleados, roles y sucursales)               | F01, F02; contrato mínimo de sucursales F07                                                              | Integración completa F07; auditoría F36                               |
| F04 | Perfil y preferencias de cliente                      | A     | P1                  | API + WEB (cuenta del cliente)                                            | F01                                                                                                      | F05, F06, F23 y endpoints personalizados                              |
| F05 | Direcciones guardadas                                 | A     | P1                  | API + WEB (Mis direcciones + selector en checkout)                        | F01, F04; modelo de municipio disponible o contrato F09                                                  | F09 catálogos/cobertura; F19 y F20 para precio y pedido               |
| F06 | Favoritos del cliente                                 | A     | P2                  | API + WEB (Mis favoritos + botones en tienda)                             | F01, F04 y contrato de producto F11                                                                      | F13 disponibilidad/precios; F17 lecturas agregadas; F18 botón carrito |
| F07 | Sucursales y metadatos públicos                       | B     | P0                  | API + WEB (selector público + administración de sucursales)               | F00                                                                                                      | F03 para guards administrativos; F08 horarios, F09 cobertura          |
| F08 | Horarios y cierres excepcionales                      | B     | P0                  | API + WEB (horarios públicos + editor administrativo)                     | F07                                                                                                      | F03 permisos; F19/F20 validación definitiva de horarios               |
| F09 | Geografía, zonas y cobertura de entrega               | B     | P0                  | API + WEB (catálogo geográfico, cobertura/configuración y administración) | F07 y contratos F00; F03 para cambios administrativos                                                    | F05 direcciones, F19 cotización, F29 cobertura real PedidosYa         |
| F10 | Categorías y jerarquía del menú                       | B     | P0                  | API + WEB (menú y backoffice categorías)                                  | F00; seguridad F03 para admin                                                                            | F11, F17                                                              |
| F11 | Productos y fichas de catálogo                        | B     | P0                  | API + WEB (producto público y administración)                             | F10; F00; F03 seguridad admin                                                                            | F12, F13, F14 medias, F06 favoritos                                   |
| F12 | Grupos y opciones modificadoras                       | B     | P0                  | API + WEB (extras en producto + editor admin)                             | F11                                                                                                      | F18 y F19; F20 snapshots                                              |
| F13 | Precio y disponibilidad por sucursal                  | B     | P0                  | API + WEB (precio/visibilidad por sucursal)                               | F07, F11                                                                                                 | F17 y F19                                                             |
| F14 | Imágenes y medios en Cloudflare R2                    | B     | P0                  | API + WEB (integración técnica R2 + gestor administrativo)                | F00; F11 para vincular imagen a producto                                                                 | F16 y F17                                                             |
| F15 | Promociones, cupones y Happy Hour                     | B     | P0                  | API + WEB (promos públicas y gestión administrativa)                      | F07, F11, F13; F12 según promociones de modificadores                                                    | F08 horario y F19 evaluador descuentos, F16 banners                   |
| F16 | Banners, contenido editorial y campañas               | B     | P1                  | API + WEB (banners públicos + editor backoffice)                          | F14; F15 para campañas de promoción si aplican                                                           | F17 agregados Home                                                    |
| F17 | Agregados públicos de tienda y búsqueda               | B     | P0                  | API + WEB (agregados + Home, menú y búsqueda)                             | F07, F10, F11, F13 como mínimo                                                                           | F12/F14/F15/F16 enriquecen campos existentes                          |
| F18 | Carrito local y su contrato de datos                  | A     | P0                  | WEB principal; API solo contrato de F19, sin CRUD carrito obligatorio     | F11, F12, F13 (contratos de catálogo); F01 opcional invitados                                            | F15 promo y F19 quote; F20 pedidos                                    |
| F19 | Cotización de checkout y reglas monetarias            | A     | P0                  | API + WEB (checkout y resumen de cotización)                              | F08, F09, F12, F13, F18; F15 si promociones habilitadas                                                  | F05 selector direcciones; F29 tarifa PedidosYa REAL bloqueada         |
| F20 | Creación de pedidos, invitados e idempotencia         | A     | P0                  | API + WEB (confirmación de pedido)                                        | F19; F01 si cliente autenticado, invitado según contrato                                                 | F24 pagos, F22 admin, F28 propias, F29 externo                        |
| F21 | Consulta y seguimiento del pedido del cliente         | A     | P0                  | API + WEB (seguimiento cliente)                                           | F20                                                                                                      | F22 estados admin, F28 propias, F29 tracking externo                  |
| F22 | Tablero backoffice y transiciones de pedidos          | A     | P0                  | API + WEB (backoffice pedidos)                                            | F20, F03 y F02                                                                                           | F28 asignaciones OWN; F29 solicitud Courier                           |
| F23 | Historial, reordenamiento y documentos de pedido      | A     | P1                  | API + WEB (Mis pedidos, recibos y reordenar)                              | F20, F21                                                                                                 | F18 y F19 para cotización nueva; F24 pago                             |
| F24 | Efectivo y transferencias bancarias                   | A     | P0                  | API + WEB (pago cliente + confirmación backoffice)                        | F20, F03                                                                                                 | F22 gestión operativa, F26 refunds                                    |
| F25 | Integración Neonet mediante adaptador                 | A     | Bloqueado proveedor | API + WEB condicional — adaptador MOCK; producción externa BLOQUEADA      | F20, F24                                                                                                 | API/sandbox/homologación oficial Neonet (BLOCKED_EXTERNAL)            |
| F26 | Reembolsos, cancelaciones monetarias y conciliación   | A     | P1                  | API + WEB (reembolsos y conciliación admin)                               | F24, F20                                                                                                 | F25 Neonet para devoluciones reales con tarjetas                      |
| F27 | Motoristas propios y disponibilidad                   | B     | P0                  | API + WEB (motoristas propios admin)                                      | F07, F03                                                                                                 | F09 flag OWN, F28 entregas                                            |
| F28 | Entregas con repartidores propios                     | B     | P0                  | API + WEB (entregas propias)                                              | F20, F27, F09                                                                                            | F22 sincroniza pedido, F30 seguimiento agregado                       |
| F29 | PedidosYa Courier (adaptador + contrato pendiente)    | B     | Bloqueado proveedor | API + WEB (adaptador/mock + sección Courier; real BLOCKED_EXTERNAL)       | Contrato F09; modelo F20 de orden/entrega, F28 puede compartir modelo logístico sin ser requisito rígido | API, credenciales y sandbox PedidosYa pendientes                      |
| F30 | Vista agregada de entregas y tracking logístico       | B     | P1                  | API + WEB (dashboard logístico)                                           | F28 para flujo propio y F20 pedidos                                                                      | F29 datos Courier externos cuando estén disponibles                   |
| F31 | Notificaciones WhatsApp y eventos transaccionales     | A     | P1                  | API/eventos + WEB (notificaciones y consola técnica)                      | F20; contrato de eventos/pedidos                                                                         | F22, F24, F28, F29 eventos; proveedor WhatsApp sujeto a aprobación    |
| F32 | Incidencias, reclamos y resoluciones                  | B     | P1                  | API + WEB (cliente y backoffice de incidencias)                           | F20, F03 para gestión admin                                                                              | F28/F29 contexto entrega, F26 compensaciones                          |
| F33 | Dashboard agregado de backoffice                      | B     | P1                  | API + WEB (dashboard principal)                                           | F22, F24, F20; F03 permisos                                                                              | F28 riders/entregas, F29 datos externos                               |
| F34 | Reportes de ventas, pedidos, productos y entrega      | B     | P1                  | API + WEB (reportes)                                                      | F20, F24, F03; F33 consultas agregadas cuando exista                                                     | F15 promos, F28 propia, F29 proveedor externo                         |
| F35 | Exportaciones CSV y tareas administrativas            | B     | P2                  | API + WEB (exportación administrativa)                                    | F34, F03                                                                                                 | F22 export pedidos, jobs solo si volumen justifica                    |
| F36 | Auditoría transversal y registro de cambios sensibles | A     | P0                  | API/infra transversal + WEB (visor admin)                                 | F00; contexto F03 para visor y atribución                                                                | Todas las operaciones críticas usan AuditWriter                       |
| F37 | Postulaciones de empleo y contacto                    | B     | P2                  | API + WEB (postulación pública + gestión admin)                           | F07 para sucursal opcional; F00                                                                          | F03 autoriza admin, R2 privado si CV adjunto                          |
| F38 | Configuración de plataforma y contenido público       | B     | P2                  | API + WEB condicional (configuración aprobada)                            | F07, F03 para settings por sucursal                                                                      | F16 banners; F09 flag de OWN se REUTILIZA, no duplica                 |
| F39 | Observabilidad, pruebas de carga y costos             | A     | P0                  | API/infra + instrumentación WEB; sin pantalla comercial obligatoria       | F00                                                                                                      | Toda la plataforma instrumentada, F40 visor soporte opcional          |
| F40 | Backoffice de soporte técnico (futuro)                | A     | P2                  | FUTURA/CONDICIONAL: API restringida + WEB soporte separado si aprobado    | F03, F36, F39                                                                                            | F29 diagnóstico externo según proveedor                               |

## 3. Contratos transversales, fronteras de dominio y trabajo paralelo

**Dueño A:** F00–F06, F18–F26, F31, F36, F39, F40. **Dueño B:** F07–F17, F27–F30, F32–F35, F37, F38. Revisión cruzada para `schema.prisma`, paquetes/contracts, `app.module`, root configs, policy RBAC, API cross-domain.

**Puertos entre A y B:** catálogo/precios (B→A F18–F20); descuentos (B→A F19); geografía/cobertura propia/puerto proveedor (B F09→A F19); pedidos/OrderFulfillmentPort (A F20/F22→B F28/F29); auditoría AuditWriter (A→todos); resúmenes pagos (A F24/F26→B F33/F34). No escribir tablas del otro módulo desde SQL directo cuando existe un servicio/puerto.

**Ciclo F03↔F07:** F03 puede definir roles y asignaciones mediante contrato de sucursales, F07 puede implementar CRUD público con guard administrativo _deny by default_ hasta integrar RBAC. No desproteger endpoints ni replicar módulo.

**Política externa PedidosYa:** la fuente principal de disponibilidad externa no es `app.delivery_zones`; esta tabla es exclusivamente cobertura propia `OWN`. Flag `ownDeliveryZonesEnabled` por sucursal, por defecto `false`; estado external `AVAILABLE|UNAVAILABLE|UNKNOWN`; `UNKNOWN` nunca confirma servicio. Hasta tener documentación/API/sandbox, cotización, solicitud, cancelación, tracking y webhook externos quedan `BLOCKED_EXTERNAL`. F29 implementa el adaptador real, no F09. Si los clientes seleccionan proveedor tras confirmar pedido, F19/F20 deben establecer una política explícita para el importe cobrado, cambios y conciliación, nunca sustituir montos silenciosamente.

**Desarrollo paralelo:** solo una rama feature por computadora/sesión; PRs a `develop`. Contratos compartidos versionados; una migración compartida abierta a la vez y revisión cruzada. Evitar actualizar en paralelo un único registro de estados: conservar estados de implementación en el PR o en la especificación individual existente (Spec Kit) hasta integrar; este archivo es el alcance estable.

**Aislamiento de trabajo:** F18 es principalmente frontend (carrito local) y F00/F39 infraestructura sin pantalla de negocio propia; el resto requiere integración concreta de la aplicación Web identificada en su ficha, incluyendo la administración en backoffice cuando corresponda.

## 4. Fichas de las 41 features

Los apartados **API** y **Next.js** de cada ficha son entregables separados. Cuando no hay pantalla obligatoria se indica explícitamente. La propuesta de endpoints debe contrastarse con OpenAPI y código real; no crear rutas duplicadas.

### Fundamentos, identidad y clientes

#### F00 — Fundamentos de API y estándares transversales

- **Responsable:** A · **Prioridad:** P0 · **Tipo:** API/infraestructura + integración técnica WEB; sin pantalla comercial.
- **Dependencias mínimas para avanzar:** Ninguna.
- **Integración posterior / para cierre completo:** F01–F40 reutilizan sus contratos.
- **Alcance funcional:** Bootstrap NestJS/Express y TypeScript estricto; configuración de entornos y validación; Prisma/PostgreSQL con pool adecuado; errores estándar y request-id; Swagger/OpenAPI versionado; pruebas y health check; limitación de tasa base y CORS.
- **API — implementación necesaria:** Módulos NestJS, Prisma, config, versionado, DTO validation, errores, CORS, health, pruebas CI, rate limiting base, conexión Supabase segura.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/health; GET /v1/health/ready (interno)`.
- **Next.js — integración obligatoria / excepción:** Configurar cliente HTTP tipado, gestión central de errores, entornos Next.js, generación/consumo de contratos; NO crear una pantalla comercial de F00.
- **Datos y migraciones:** Infraestructura y esquema app.
- **Pruebas y aceptación:** Instalación reproducible; health checks; lint/typecheck/tests/build; credenciales fuera de Git. Validar arranque de ambas aplicaciones, health, documentación OpenAPI, llamadas WEB→API, lint/typecheck/test/build.
- **Límite / no invadir otra feature:** No desarrollar login, catálogo ni checkout en F00.
- **Estado de partida:** NOT_VERIFIED — comprobar en auditoría F00–F09.
- **Decisión o brecha original por resolver:** Decidir proveedor de logs, manejo del pooler y estrategia de migraciones.

#### F01 — Google OAuth y contexto de sesión

- **Responsable:** A · **Prioridad:** P0 · **Tipo:** API + WEB (tienda y backoffice).
- **Dependencias mínimas para avanzar:** F00.
- **Integración posterior / para cierre completo:** F02/F03/F04; autenticación transversal.
- **Alcance funcional:** Supabase Auth es el único emisor de sesiones; Next.js realiza OAuth/PKCE; NestJS valida JWT issuer/audience/exp/firma y sujeto; identidad compartida cliente-empleado; contexto ligero; logout y expiración según Supabase; no desarrollar login con contraseña.
- **API — implementación necesaria:** Validar JWT Supabase en NestJS; manejar contexto de sesión y errores; no emitir contraseñas ni JWT propios.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/auth/context; GET /v1/me (autenticado)`.
- **Next.js — integración obligatoria / excepción:** Botones y callbacks de Google OAuth, PKCE, SSR/sesión segura, protección de rutas de cuenta y backoffice, cierre de sesión, estados de error/no autorizado.
- **Datos y migraciones:** auth.users, app.customers, app.staff_users.
- **Pruebas y aceptación:** Cliente ingresa; empleado no autorizado obtiene 403; tokens expirados/revocaciones según política; no claves secretas al navegador. Validar login, refresh/logout, cuenta sin permisos, 401/403, aislamiento y secretos.
- **Límite / no invadir otra feature:** No permitir autoregistro como empleado; la autorización administrativa corresponde a F03.
- **Estado de partida:** NOT_VERIFIED — comprobar en auditoría F00–F09.
- **Decisión o brecha original por resolver:** DBML staff_users no permite empleado pendiente de vinculación (auth_user_id NOT NULL).

#### F02 — MFA TOTP obligatorio en backoffice

- **Responsable:** A · **Prioridad:** P0 · **Tipo:** API + WEB (flujo administrativo).
- **Dependencias mínimas para avanzar:** F01.
- **Integración posterior / para cierre completo:** F03; guards administrativos de F07–F40.
- **Alcance funcional:** Enrolamiento, challenge y verify desde Supabase Auth; backoffice exige aal2; pantalla de alta restringida para aal1; comprobar aal2 en cada ruta administrativa; recuperación y factor alternativo con procedimiento auditado; clientes sin obligatoriedad MFA inicial.
- **API — implementación necesaria:** Reutilizar verificación de aal2 para rutas administrativas y contexto limitado de enrolamiento con aal1; servicios MFA de Supabase.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/admin/me/context (exige aal2); GET /v1/auth/context (estado de acceso); TOTP por SDK Supabase, no endpoints propios.`.
- **Next.js — integración obligatoria / excepción:** Pantallas de enrolamiento TOTP, challenge/verify, MFA pendiente, sesión caducada, error/recuperación aprobada; no mostrar backoffice antes de aal2.
- **Datos y migraciones:** auth.users; MFA gestionado por Supabase Auth.
- **Pruebas y aceptación:** AAL1 jamás ejecuta operaciones admin; AAL2+permisos sí; empleado desactivado denegado incluso con sesión válida. Probar aal1 denegado, aal2 autorizado, empleado deshabilitado, rutas de enrolamiento limitadas.
- **Límite / no invadir otra feature:** No implementar TOTP criptográfico propio ni exigir MFA general a clientes.
- **Estado de partida:** NOT_VERIFIED — comprobar en auditoría F00–F09.
- **Decisión o brecha original por resolver:** Definir recuperación MFA y seguridad de vinculación inicial.

#### F03 — Empleados, roles, permisos y asignaciones

- **Responsable:** A · **Prioridad:** P0 · **Tipo:** API + WEB (administración de empleados, roles y sucursales).
- **Dependencias mínimas para avanzar:** F01, F02; contrato mínimo de sucursales F07.
- **Integración posterior / para cierre completo:** Integración completa F07; auditoría F36.
- **Alcance funcional:** Preautorizar correo verificado sin registro público; vincular auth_user_id tras primer OAuth; crear/desactivar empleados; asignar roles y sucursales; validar permisos por recurso/sucursal en cada comando; auditoría y límites de privilegio; bootstrap seguro primer admin.
- **API — implementación necesaria:** Preautorizar empleados, vincular identidad Google verificada, administrar roles/permisos/asignaciones, guards y políticas RBAC por sucursal, bootstrap inicial seguro.
- **API — rutas propuestas de la especificación fuente:** `GET/POST /v1/admin/staff; GET/PATCH /v1/admin/staff/:id; PUT /v1/admin/staff/:id/assignments; GET /v1/admin/roles; GET /v1/admin/permissions`.
- **Next.js — integración obligatoria / excepción:** Gestión administrativa de usuarios: listado, crear/invitar, editar, activar/desactivar, roles, permisos, asignaciones de sucursal y navegación según contexto.
- **Datos y migraciones:** app.staff_users, app.roles, app.permissions, app.role_permissions, app.staff_assignments.
- **Pruebas y aceptación:** Un gerente no accede a otra sucursal; cuentas desactivadas bloqueadas; alta solo por admin; sin escalada de permisos. Denegar registro público, escalada de privilegios, acceso entre sucursales y aal1; verificar acceso real con los guards.
- **Límite / no invadir otra feature:** F03 no debe reimplementar el CRUD de sucursales de F07; coordinar contrato circular F03↔F07.
- **Estado de partida:** NOT_VERIFIED — comprobar en auditoría F00–F09.
- **Decisión o brecha original por resolver:** Requiere invitaciones/preautorizaciones o auth_user_id nullable más estado de vínculo.

#### F04 — Perfil y preferencias de cliente

- **Responsable:** A · **Prioridad:** P1 · **Tipo:** API + WEB (cuenta del cliente).
- **Dependencias mínimas para avanzar:** F01.
- **Integración posterior / para cierre completo:** F05, F06, F23 y endpoints personalizados.
- **Alcance funcional:** Crear/actualizar perfil vinculado al UUID de Supabase; nombre, email verificado y teléfono; separar identificadores de sesión y datos de negocio; protección de datos; consultar contexto agregado propio.
- **API — implementación necesaria:** Crear/obtener/editar perfil vinculado a UUID Supabase, validar propiedad, preferencia y datos permitidos.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/me; PATCH /v1/me; GET /v1/me/storefront`.
- **Next.js — integración obligatoria / excepción:** Mi cuenta: datos personales, nombre y teléfono, edición, estados de carga/errores y autenticación; consumir perfil real.
- **Datos y migraciones:** app.customers.
- **Pruebas y aceptación:** Sólo el propietario consulta/edita; actualización parcial válida; sin consultas de otros clientes. Propiedad, actualizaciones parciales, 401, datos del perfil consistentes entre navegador/API.
- **Límite / no invadir otra feature:** No duplicar Supabase Auth ni implementar direcciones o favoritos.
- **Estado de partida:** NOT_VERIFIED — comprobar en auditoría F00–F09.

#### F05 — Direcciones guardadas

- **Responsable:** A · **Prioridad:** P1 · **Tipo:** API + WEB (Mis direcciones + selector en checkout).
- **Dependencias mínimas para avanzar:** F01, F04; modelo de municipio disponible o contrato F09.
- **Integración posterior / para cierre completo:** F09 catálogos/cobertura; F19 y F20 para precio y pedido.
- **Alcance funcional:** CRUD de direcciones propias; etiqueta, referencia, municipio, zona, geolocalización opcional; dirección predeterminada única; verificar cobertura al cotizar; no alterar snapshot de pedidos ya emitidos.
- **API — implementación necesaria:** CRUD privado de app.customer_addresses; predeterminada única, validaciones zona/municipio/coordenadas, transacciones y propiedad por JWT.
- **API — rutas propuestas de la especificación fuente:** `GET/POST /v1/me/addresses; PATCH/DELETE /v1/me/addresses/:id; PUT /v1/me/addresses/:id/default`.
- **Next.js — integración obligatoria / excepción:** Mis direcciones: tarjetas, crear/editar/borrar, default, etiquetas personalizadas, formularios departamento/municipio. Checkout: seleccionar direcciones guardadas o guardar una nueva opcionalmente; SIN cotización ni confirmar pedido.
- **Datos y migraciones:** app.customer_addresses, app.municipalities.
- **Pruebas y aceptación:** Nunca se modifica dirección ajena; máxima una predeterminada; órdenes previas inmutables. Probar dos clientes distintos (IDOR), default concurrente, cambios de cuenta, formulario real y selector reutilizable.
- **Límite / no invadir otra feature:** No llamar a PedidosYa al guardar una dirección; no persistir tarifa/cobertura como hecho permanente.
- **Estado de partida:** NOT_VERIFIED — comprobar en auditoría F00–F09.

#### F06 — Favoritos del cliente

- **Responsable:** A · **Prioridad:** P2 · **Tipo:** API + WEB (Mis favoritos + botones en tienda).
- **Dependencias mínimas para avanzar:** F01, F04 y contrato de producto F11.
- **Integración posterior / para cierre completo:** F13 disponibilidad/precios; F17 lecturas agregadas; F18 botón carrito.
- **Alcance funcional:** Añadir y eliminar favorito idempotentemente; devolver productos visibles por sucursal; excluir o marcar inactivos; respetar permisos de usuario.
- **API — implementación necesaria:** GET/PUT/DELETE favoritos del propio cliente; relación única cliente-producto, idempotencia y consulta batch de identificadores.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/me/favorites; PUT/DELETE /v1/me/favorites/:productId`.
- **Next.js — integración obligatoria / excepción:** Mi cuenta→Mis favoritos; botones de corazón en Home, menú, búsqueda y detalle; sincronización TanStack Query sin request por tarjeta; login requerido.
- **Datos y migraciones:** app.customer_favorites, app.products.
- **Pruebas y aceptación:** Duplicados no se crean; otro usuario no ve favoritos ajenos. Evitar duplicados, 401 y filtrado por propietario; verificar corazones sincronizados y cambio de sucursal/cuenta.
- **Límite / no invadir otra feature:** No guardar precios ni duplicar catálogo; no crear carrito.
- **Estado de partida:** NOT_VERIFIED — comprobar en auditoría F00–F09.

### Sucursales, geografía y catálogo

#### F07 — Sucursales y metadatos públicos

- **Responsable:** B · **Prioridad:** P0 · **Tipo:** API + WEB (selector público + administración de sucursales).
- **Dependencias mínimas para avanzar:** F00.
- **Integración posterior / para cierre completo:** F03 para guards administrativos; F08 horarios, F09 cobertura.
- **Alcance funcional:** Listado y ficha pública de sucursal; nombre, código, contacto, dirección, coordenadas, estado; administración con permisos y auditoría; sucursal activa/inactiva; validación de código único.
- **API — implementación necesaria:** CRUD de app.branches, estado administrativo, códigos únicos, coordenadas, API pública + API protegida, auditoría/invalidez cache.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/branches; GET /v1/branches/:id; GET/POST /v1/admin/branches; PATCH /v1/admin/branches/:id`.
- **Next.js — integración obligatoria / excepción:** Tienda: selector y detalle de sucursal con datos reales. Backoffice: listado, crear/editar, activar/desactivar, estados vacíos y confirmaciones; no falsificar horarios/ventas.
- **Datos y migraciones:** app.branches.
- **Pruebas y aceptación:** Sucursal desactivada no acepta pedidos; solo roles autorizados editan; datos públicos cacheables. Sucursal inactiva no elegible para nuevos pedidos; código único; API y UI real; admin protegido por aal2/RBAC.
- **Límite / no invadir otra feature:** No implementar horarios F08 ni cobertura F09 ni dashboard F33 en F07.
- **Estado de partida:** NOT_VERIFIED — comprobar en auditoría F00–F09.

#### F08 — Horarios y cierres excepcionales

- **Responsable:** B · **Prioridad:** P0 · **Tipo:** API + WEB (horarios públicos + editor administrativo).
- **Dependencias mínimas para avanzar:** F07.
- **Integración posterior / para cierre completo:** F03 permisos; F19/F20 validación definitiva de horarios.
- **Alcance funcional:** Horarios por día y tramos; cierres extraordinarios; determinar apertura en zona horaria Guatemala; horario de pedidos programados; validación de intervalos.
- **API — implementación necesaria:** Gestionar app.branch_hours y app.branch_closures; algoritmo zona America/Guatemala, intervalos solapados, excepciones, nextOpen/Close y aceptación.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/branches/:id/availability; PUT /v1/admin/branches/:id/hours; GET/POST /v1/admin/branches/:id/closures; DELETE /v1/admin/branches/:id/closures/:closureId`.
- **Next.js — integración obligatoria / excepción:** Backoffice: editor semanal por sucursal, varios tramos, cierres extraordinarios. Tienda: horario, abierta/cerrada y próxima apertura; invalidación dirigida.
- **Datos y migraciones:** app.branch_hours, app.branch_closures.
- **Pruebas y aceptación:** Horario nocturno/feriados consistente; no permite pedidos fuera de política; caché no supera próximo cambio de horario. Probar apertura/cierre exactos, medianoche, feriados, zona horaria UTC servidor, 401/403 y pantallas.
- **Límite / no invadir otra feature:** No confundir branches.active con apertura ni aceptación; no implementar pedido programado completo.
- **Estado de partida:** NOT_VERIFIED — comprobar en auditoría F00–F09.
- **Decisión o brecha original por resolver:** Modelo puede requerir regla especial para turnos que crucen medianoche.

#### F09 — Geografía, zonas y cobertura de entrega

- **Responsable:** B · **Prioridad:** P0 · **Tipo:** API + WEB (catálogo geográfico, cobertura/configuración y administración).
- **Dependencias mínimas para avanzar:** F07 y contratos F00; F03 para cambios administrativos.
- **Integración posterior / para cierre completo:** F05 direcciones, F19 cotización, F29 cobertura real PedidosYa.
- **Alcance funcional:** Consultar geografía; mantener zona/tarifa/sucursal; validar dirección y cobertura; definir cuándo aplicar tarifa propia o externa; devolver desglose y motivo sin cobertura; caché de catálogos estáticos.
- **API — implementación necesaria:** Departamentos/municipios, app.delivery_zones SOLO para OWN, tarifas propias, branch_delivery_settings con ownDeliveryZonesEnabled=false; contrato neutral PedidosYa, cobertura por proveedor, mock no productivo.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/locations/departments; GET /v1/locations/municipalities; POST /v1/delivery-coverage/check; GET/POST/PATCH /v1/admin/delivery-zones`.
- **Next.js — integración obligatoria / excepción:** Tienda: departamento/municipio/zona y estados de cobertura por proveedor. Backoffice: CRUD zonas/tarifas propias y flags por sucursal; mostrar PedidosYa pendiente en vez de disponible.
- **Datos y migraciones:** app.departments, app.municipalities, app.delivery_zones.
- **Pruebas y aceptación:** Monto determinado por API; sin cobertura impide cotizar modalidad; permisos por sucursal. Probar flag false, true, coincidente/no coincidente, tarifa exacta decimal, proveedor UNKNOWN, mock segregado, permisos por sucursal.
- **Límite / no invadir otra feature:** PedidosYa es fuente principal EXTERNA; sin API/sandbox, cobertura real UNKNOWN y BLOCKED_EXTERNAL. No generar órdenes, cotizaciones reales, solicitudes de courier.
- **Estado de partida:** NOT_VERIFIED — comprobar en auditoría F00–F09.
- **Decisión o brecha original por resolver:** Geocodificación y rutas externas no están especificadas en DBML.
- **Actualización oficial que prevalece:** PedidosYa proveedor externo principal y **sin integración real** por falta de API/sandbox; no usar tablas propias para afirmar cobertura externa. `ownDeliveryZonesEnabled=false` por sucursal habilita cobertura adicional solo OWN. Distinguir `pedidosyaEnabled` (config) de disponibilidad real. `POST /v1/delivery-coverage/check` retorna resultados independientes por proveedor y `UNKNOWN` cuando externo no comprobable. UI no debe presentar cotizaciones falsas como reales. Incorporar `GET/PATCH /v1/admin/branches/:id/delivery-settings` si el contrato aprobado no tiene equivalente.

#### F10 — Categorías y jerarquía del menú

- **Responsable:** B · **Prioridad:** P0 · **Tipo:** API + WEB (menú y backoffice categorías).
- **Dependencias mínimas para avanzar:** F00; seguridad F03 para admin.
- **Integración posterior / para cierre completo:** F11, F17.
- **Alcance funcional:** Jerarquía padre/hijo, orden, slug, visibilidad, listado público y administración; validar ciclos jerárquicos; soft deactivation; respuestas ligeras.
- **API — implementación necesaria:** CRUD jerarquías app.categories, orden, slug, visibilidad, evitar ciclos, filtros, endpoints públicos y protegidos.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/store/categories; GET/POST /v1/admin/categories; PATCH /v1/admin/categories/:id; PUT /v1/admin/categories/reorder`.
- **Next.js — integración obligatoria / excepción:** Menú: navegación de categorías con datos reales. Backoffice: lista/árbol, crear/editar/activar, cambiar orden, mensajes de errores.
- **Datos y migraciones:** app.categories.
- **Pruebas y aceptación:** No se producen ciclos; orden estable y resultados públicos solo activos. Ciclos imposibles, orden estable, categorías inactivas ocultas, administración solo autorizados.
- **Límite / no invadir otra feature:** No implementar CRUD productos F11.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.

#### F11 — Productos y fichas de catálogo

- **Responsable:** B · **Prioridad:** P0 · **Tipo:** API + WEB (producto público y administración).
- **Dependencias mínimas para avanzar:** F10; F00; F03 seguridad admin.
- **Integración posterior / para cierre completo:** F12, F13, F14 medias, F06 favoritos.
- **Alcance funcional:** CRUD producto con SKU, slug, nombre, descripción, categoría, precio base; búsqueda y paginación; imágenes referenciadas; no borrar físicamente productos usados en pedidos; detalle incluye relaciones necesarias.
- **API — implementación necesaria:** CRUD app.products, slug/SKU/precio base, validaciones, filtros/paginación y detalle, integridad histórica.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/store/products/:slug; GET/POST /v1/admin/products; GET/PATCH /v1/admin/products/:id`.
- **Next.js — integración obligatoria / excepción:** Menú y ficha del producto, administración de productos (crear/editar/activar), búsqueda, componentes de imágenes placeholder hasta F14.
- **Datos y migraciones:** app.products, app.product_media.
- **Pruebas y aceptación:** Producto activo visible; los pedidos guardan snapshots; filtros sin N+1. Listados y fichas reales, precios coherentes, validación campos, 401/403 administrativos.
- **Límite / no invadir otra feature:** No implementar upload R2 F14 ni pricing por sucursal F13 como propios de F11.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** Imágenes se delegan a F14 y disponibilidad por sucursal a F13.

#### F12 — Grupos y opciones modificadoras

- **Responsable:** B · **Prioridad:** P0 · **Tipo:** API + WEB (extras en producto + editor admin).
- **Dependencias mínimas para avanzar:** F11.
- **Integración posterior / para cierre completo:** F18 y F19; F20 snapshots.
- **Alcance funcional:** Gestionar extras, precios adicionales, mínimos y máximos; asociar grupos a productos; validar selección de modificadores en cotización; no confiar en montos del frontend.
- **API — implementación necesaria:** CRUD grupos/opciones, min/max, precios extra, relaciones producto-grupo, validadores reutilizables.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/admin/modifier-groups; POST/PATCH /v1/admin/modifier-groups; GET /v1/admin/products/:id/modifiers; PUT /v1/admin/products/:id/modifier-groups`.
- **Next.js — integración obligatoria / excepción:** Selector de extras con restricciones mínimas/máximas en detalle; panel admin para opciones y grupos.
- **Datos y migraciones:** app.modifier_groups, app.modifiers, app.product_modifier_groups.
- **Pruebas y aceptación:** min<=max, selección válida; subtotal incluye extras; snapshot de extras en pedido. No permitir selecciones fuera min/max ni cantidades inválidas; contratipos y UI coherentes.
- **Límite / no invadir otra feature:** El subtotal definitivo se valida en F19, no confiar en cliente.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.

#### F13 — Precio y disponibilidad por sucursal

- **Responsable:** B · **Prioridad:** P0 · **Tipo:** API + WEB (precio/visibilidad por sucursal).
- **Dependencias mínimas para avanzar:** F07, F11.
- **Integración posterior / para cierre completo:** F17 y F19.
- **Alcance funcional:** Precio override; disponibilidad específica; consultar productos por sucursal; admin cambia disponibilidad; invalidar menú; rechazar producto no disponible en checkout.
- **API — implementación necesaria:** Gestionar app.branch_products; precio override, available, lecturas por sucursal, actualización con permisos.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/store/menu?branchId=; PATCH /v1/admin/products/:id/availability; PUT /v1/admin/branches/:id/products/:productId/pricing`.
- **Next.js — integración obligatoria / excepción:** Menú filtrado al cambiar sucursal; precios/agotados correctos. Backoffice: disponibilidad y pricing por sucursal.
- **Datos y migraciones:** app.branch_products, app.products.
- **Pruebas y aceptación:** No mostrar precio de otra sucursal; cambio de disponibilidad invalida caché; no prometer stock numérico. Precio de sucursal correcta, no ofertar inactivo, invalidación cache, seguridad por branchId.
- **Límite / no invadir otra feature:** No implementar stock numérico si DBML no lo contempla.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** DBML soporta disponibilidad booleana, no kardex/stock de inventario.

#### F14 — Imágenes y medios en Cloudflare R2

- **Responsable:** B · **Prioridad:** P0 · **Tipo:** API + WEB (integración técnica R2 + gestor administrativo).
- **Dependencias mínimas para avanzar:** F00; F11 para vincular imagen a producto.
- **Integración posterior / para cierre completo:** F16 y F17.
- **Alcance funcional:** Almacenar activos en R2 y publicarlos desde dominio personalizado; API autoriza y firma PUT temporal a endpoint S3; validar tipo MIME real, tamaño, extensión, key y checksum; confirmar objeto tras subida; persistir URL pública y opcional object_key; ordenar/eliminar medios y limpiar objetos sin referencias; medios privados separados.
- **API — implementación necesaria:** Intentos de carga firmada a R2, validaciones MIME/tamaño/key, confirmación, metadatos, autorizaciones, HTTPS estable y eliminación segura.
- **API — rutas propuestas de la especificación fuente:** `POST /v1/admin/media/upload-intents; POST /v1/admin/media/complete; GET /v1/admin/media/:id; DELETE /v1/admin/media/:id; POST /v1/admin/products/:id/media`.
- **Next.js — integración obligatoria / excepción:** Backoffice: carga múltiple de fotos, previews, reordenar, errores y estados; tienda: render de imágenes CDN con fallback.
- **Datos y migraciones:** app.product_media (media_url); ampliación opcional de media_assets.
- **Pruebas y aceptación:** No se exponen claves R2; URL firmada corta; media_url HTTPS estable; producto puede tener varias imágenes; borrado auditable. Probar upload/complete seguro, MIME falso, tamaño, sin credenciales públicas, Next Image.
- **Límite / no invadir otra feature:** No guardar secretos/presigned URL persistente ni subir bytes desde API sin necesidad.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** El DBML solo guarda media_url; evaluar object_key, mime, tamaño, checksum, estado, banners; no guardar URLs firmadas temporales como permanentes.

#### F15 — Promociones, cupones y Happy Hour

- **Responsable:** B · **Prioridad:** P0 · **Tipo:** API + WEB (promos públicas y gestión administrativa).
- **Dependencias mínimas para avanzar:** F07, F11, F13; F12 según promociones de modificadores.
- **Integración posterior / para cierre completo:** F08 horario y F19 evaluador descuentos, F16 banners.
- **Alcance funcional:** Promoción por fecha, hora, sucursal y producto; cupón; porcentaje/monto y restricciones; evitar solapamientos inválidos; definir prioridad/combinabilidad; exponer evaluación pura de descuentos al Checkout de A; vigencia temporal estricta.
- **API — implementación necesaria:** Promos/cupones, vigencias, ramas/productos, reglas de combinación, motor puro PromotionEvaluator.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/store/promotions; GET/POST /v1/admin/promotions; GET/PATCH /v1/admin/promotions/:id; PATCH /v1/admin/promotions/:id/status`.
- **Next.js — integración obligatoria / excepción:** Tienda: listados promo/Happy Hour y precios indicativos; backoffice: crear/editar/activar/caducidad con formularios.
- **Datos y migraciones:** app.promotions, app.promotion_branches, app.promotion_products, app.promotion_weekdays.
- **Pruebas y aceptación:** Promoción vencida nunca aplica; total consistente con API; política de apilamiento testeada. Happy hour por zona horaria, fechas/semana, stacking aprobado, descuento no excede límites.
- **Límite / no invadir otra feature:** No calcular total final de pedidos aquí; F19 consume reglas.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** DBML kind/value y dine_in_only existen; falta formalizar reglas avanzadas y cómo se apilan.

#### F16 — Banners, contenido editorial y campañas

- **Responsable:** B · **Prioridad:** P1 · **Tipo:** API + WEB (banners públicos + editor backoffice).
- **Dependencias mínimas para avanzar:** F14; F15 para campañas de promoción si aplican.
- **Integración posterior / para cierre completo:** F17 agregados Home.
- **Alcance funcional:** Gestionar imágenes, CTA, prioridad, idioma, vigencia, sucursal y visibilidad; mostrar contenido del inicio; se apoya en Cloudflare R2; establecer esquema y migración solo tras aprobación.
- **API — implementación necesaria:** Esquema/CRUD para banners solo si se aprueba migración (DBML no contempla tabla); vigencia, idioma, orden, sucursal.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/store/banners; GET/POST /v1/admin/banners; PATCH /v1/admin/banners/:id`.
- **Next.js — integración obligatoria / excepción:** Home: carruseles/banners reales ES/EN; backoffice: gestionar banner, prioridad, CTA, R2 y visibilidad.
- **Datos y migraciones:** No hay tabla explícita de banners/campañas en DBML.
- **Pruebas y aceptación:** Versiones ES/EN; no banner expirado; fallbacks si R2 falla. No mostrar banners expirados, fallbacks R2, permisos de publicación, idiomas.
- **Límite / no invadir otra feature:** No inventar modelo persistente ni rediseñar toda la landing sin acuerdo.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** Nueva entidad requerida si se desea administración dinámica de banners.

#### F17 — Agregados públicos de tienda y búsqueda

- **Responsable:** B · **Prioridad:** P0 · **Tipo:** API + WEB (agregados + Home, menú y búsqueda).
- **Dependencias mínimas para avanzar:** F07, F10, F11, F13 como mínimo.
- **Integración posterior / para cierre completo:** F12/F14/F15/F16 enriquecen campos existentes.
- **Alcance funcional:** Endpoint home optimizado: sucursal, categorías, destacados, promos y banners; endpoint menú con filtros; búsqueda paginada; caché CDN separada por sucursal/idioma; invalidación selectiva; no devolver catálogo entero en el home.
- **API — implementación necesaria:** GET bootstrap/menu/search con paginación, filtro por sucursal/idioma, agregados y caché pública con invalidación selectiva.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/store/bootstrap; GET /v1/store/menu; GET /v1/store/search; GET /v1/store/products/:slug`.
- **Next.js — integración obligatoria / excepción:** Home, menú, búsqueda, ficha con datos reales y TanStack Query; menos peticiones, sin mostrar datos privados en respuestas públicas.
- **Datos y migraciones:** Consultas compositivas, sin nueva tabla obligatoria.
- **Pruebas y aceptación:** Pocas peticiones HTTP y respuesta acotada; caché por sucursal; cambios visibles tras invalidación. Limitar payload, N+1, cache por sucursal/locale, resultados consistentes.
- **Límite / no invadir otra feature:** No meter favoritos/direcciones privadas en CDN público; no cotizar PedidosYa en home.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** A aporta datos del usuario mediante /me/storefront, nunca mezclarlos en caché pública.

### Carrito, checkout, pedidos y pagos

#### F18 — Carrito local y su contrato de datos

- **Responsable:** A · **Prioridad:** P0 · **Tipo:** WEB principal; API solo contrato de F19, sin CRUD carrito obligatorio.
- **Dependencias mínimas para avanzar:** F11, F12, F13 (contratos de catálogo); F01 opcional invitados.
- **Integración posterior / para cierre completo:** F15 promo y F19 quote; F20 pedidos.
- **Alcance funcional:** Definir carrito tipado frontend con producto, cantidad, extras, sucursal y contexto; no aceptar precio del cliente; sincronización con cotización real; si se requiere persistencia cross-device, especificar cambio DB posterior.
- **API — implementación necesaria:** No requiere endpoint propio de carrito inicialmente. Definir tipos compatibles con POST /v1/checkout/quote; la API futura recalcula montos.
- **API — rutas propuestas de la especificación fuente:** `No requiere endpoint al inicio; consume POST /v1/checkout/quote`.
- **Next.js — integración obligatoria / excepción:** Carrito completo: agregar/quitar productos, cantidades, modificadores, resumen, persistencia local aprobada, cambio de sucursal y estados.
- **Datos y migraciones:** Sin tabla persistida de carrito en DBML.
- **Pruebas y aceptación:** Cambios de sucursal recalculan; discrepancias de precio visibles; no almacenar datos de tarjeta. Ningún precio del navegador se trata como definitivo; UI, responsive, revaluación al cambiar branch.
- **Límite / no invadir otra feature:** No crear tabla de carrito ni endpoint de persistencia cross-device sin aprobación.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** DBML no contempla carritos persistentes.

#### F19 — Cotización de checkout y reglas monetarias

- **Responsable:** A · **Prioridad:** P0 · **Tipo:** API + WEB (checkout y resumen de cotización).
- **Dependencias mínimas para avanzar:** F08, F09, F12, F13, F18; F15 si promociones habilitadas.
- **Integración posterior / para cierre completo:** F05 selector direcciones; F29 tarifa PedidosYa REAL bloqueada.
- **Alcance funcional:** Validar surtido, cantidades, modificadores, horarios, modalidad, zona, descuentos y cargos; GTQ con decimal preciso; entregar líneas y total calculados por backend; vencimiento/identificador de cotización si necesario; separar estimación de courier.
- **API — implementación necesaria:** Cotizador servidor GTQ con Decimal: menú/extras/promos/horarios/cobertura OWN, vigencia, no confiar en importes frontend; puerto externo neutral.
- **API — rutas propuestas de la especificación fuente:** `POST /v1/checkout/quote; GET /v1/store/checkout-context`.
- **Next.js — integración obligatoria / excepción:** Checkout real: dirección propia/guardada, pickup vs delivery, promociones, errores de cotización y total; marcar PedidosYa UNKNOWN si sin API.
- **Datos y migraciones:** app.products, app.branch_products, app.promotions, app.delivery_zones (lectura).
- **Pruebas y aceptación:** API recalcula precios; datos inválidos rechazados; coincidencia exacta subtotal+extras-descuentos+envío. Subtotal+modificadores-descuentos+envío = total, alcance por sucursal, validación de cotización.
- **Límite / no invadir otra feature:** No permitir confirmar PedidosYa con tarifas mock; no crear pedido, eso es F20.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** Definir tipos de fulfillment y contrato de cotización compartido A/B.
- **Límite PedidosYa:** El flujo de pedidos internos y reparto OWN puede avanzarse con contratos reales; el flujo operativo externo se reporta `BLOCKED_EXTERNAL` hasta entrega y validación del proveedor. No usar un mock para despacho real.

#### F20 — Creación de pedidos, invitados e idempotencia

- **Responsable:** A · **Prioridad:** P0 · **Tipo:** API + WEB (confirmación de pedido).
- **Dependencias mínimas para avanzar:** F19; F01 si cliente autenticado, invitado según contrato.
- **Integración posterior / para cierre completo:** F24 pagos, F22 admin, F28 propias, F29 externo.
- **Alcance funcional:** Crear pedido en una transacción; cliente autenticado o invitado; snapshots inmutables de productos, extras y dirección; reserva/cotización válida; idempotency key y recuperación del resultado; número ordenado; bloqueo de duplicados; auditabilidad.
- **API — implementación necesaria:** POST pedidos transaccional, idempotency key, snapshots precio/dirección/items/promociones, estados y acceso seguro invitado.
- **API — rutas propuestas de la especificación fuente:** `POST /v1/orders; GET /v1/orders/:id (según permisos)`.
- **Next.js — integración obligatoria / excepción:** Confirmar checkout, mostrar número de pedido y detalle, estados de error/idempotencia; no usar mocks como éxito real.
- **Datos y migraciones:** app.orders, app.order_addresses, app.order_items, app.order_item_modifiers, app.order_promotions, app.order_status_history.
- **Pruebas y aceptación:** Reintentos no duplican; copia histórica estable; falla parcial revierte transacción; guest tracking seguro. Reintentos no duplican; snapshot inmutable; transacción revierte ante errores.
- **Límite / no invadir otra feature:** No solicitar PedidosYa real sin integración; permitir pickup/OWN elegible.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** Falta tabla/índice para idempotencia de creación; política para acceso de invitado.
- **Límite PedidosYa:** El flujo de pedidos internos y reparto OWN puede avanzarse con contratos reales; el flujo operativo externo se reporta `BLOCKED_EXTERNAL` hasta entrega y validación del proveedor. No usar un mock para despacho real.

#### F21 — Consulta y seguimiento del pedido del cliente

- **Responsable:** A · **Prioridad:** P0 · **Tipo:** API + WEB (seguimiento cliente).
- **Dependencias mínimas para avanzar:** F20.
- **Integración posterior / para cierre completo:** F22 estados admin, F28 propias, F29 tracking externo.
- **Alcance funcional:** Vista segura de pedido, línea temporal y estado; para invitado usar token opaco y límites; evitar exponer PII; respuestas agrupadas y polling moderado o eventos más adelante; no retornar data logística sensible innecesaria.
- **API — implementación necesaria:** Tracking seguro propietario o token opaco invitado, eventos/polling razonable, minimización PII.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/orders/:id; GET /v1/orders/:id/tracking; GET /v1/guest/orders/:token`.
- **Next.js — integración obligatoria / excepción:** Confirmación/seguimiento con timeline, estados, auto-actualización moderada, errores de acceso.
- **Datos y migraciones:** app.orders, app.order_status_history, app.deliveries (lectura).
- **Pruebas y aceptación:** Acceso solo dueño/token; nunca enumeración por order_number; estados consistentes. Token invitado no enumerable; 404/403, historial veraz, seguimiento consistente.
- **Límite / no invadir otra feature:** No inventar GPS/ETA externa ni exponer datos de otros clientes.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** Diseñar token de consulta invitado con expiración y revocación.

#### F22 — Tablero backoffice y transiciones de pedidos

- **Responsable:** A · **Prioridad:** P0 · **Tipo:** API + WEB (backoffice pedidos).
- **Dependencias mínimas para avanzar:** F20, F03 y F02.
- **Integración posterior / para cierre completo:** F28 asignaciones OWN; F29 solicitud Courier.
- **Alcance funcional:** Tablero agregado por estado y sucursal, filtros y paginación; aceptar/rechazar/preparar/listo/despachar/cancelar; transición válida, control de concurrencia, motivo y quién ejecuta; sincronización con entregas mediante puerto, no escritura directa al módulo B.
- **API — implementación necesaria:** Tablero estados y órdenes por sucursal, comandos con reglas de transición/concurrencia, auditoría, OrderFulfillmentPort.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/admin/orders; GET /v1/admin/orders/board; GET /v1/admin/orders/:id; POST /v1/admin/orders/:id/{accept,reject,start-preparing,mark-ready,cancel}`.
- **Next.js — integración obligatoria / excepción:** Backoffice: tablero y detalle, aceptar/rechazar/preparar/listo/cancelar, filtros y carga; botones de reparto propio/PedidosYa diferenciados; externos deshabilitados sin API.
- **Datos y migraciones:** app.orders, app.order_status_history, app.audit_events.
- **Pruebas y aceptación:** Gerente sin permiso de otra sucursal; dos acciones simultáneas no crean estado imposible; historial auditado. Transiciones válidas, acciones simultáneas, permisos y estados visibles sincronizados.
- **Límite / no invadir otra feature:** No escribir SQL sobre entregas de B ni solicitar proveedor automáticamente sin regla aprobada.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** Definir reglas de transición y relación pedido/entrega antes de implementar.
- **Límite PedidosYa:** El flujo de pedidos internos y reparto OWN puede avanzarse con contratos reales; el flujo operativo externo se reporta `BLOCKED_EXTERNAL` hasta entrega y validación del proveedor. No usar un mock para despacho real.

#### F23 — Historial, reordenamiento y documentos de pedido

- **Responsable:** A · **Prioridad:** P1 · **Tipo:** API + WEB (Mis pedidos, recibos y reordenar).
- **Dependencias mínimas para avanzar:** F20, F21.
- **Integración posterior / para cierre completo:** F18 y F19 para cotización nueva; F24 pago.
- **Alcance funcional:** Listado histórico paginado por cliente/sucursal; repetición genera borrador con productos actuales y nueva cotización; recibo simple no factura fiscal; exportación/descarga según reglas definidas.
- **API — implementación necesaria:** Historial paginado por cliente, detalle, recibo simple no fiscal, preview reordenar contra catálogo vigente.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/me/orders; GET /v1/me/orders/:id; POST /v1/me/orders/:id/reorder-preview; GET /v1/orders/:id/receipt`.
- **Next.js — integración obligatoria / excepción:** Mi cuenta→Mis pedidos, detalle, recibo descargable si aprobado, volver a pedir al carrito con reconfirmación.
- **Datos y migraciones:** app.orders, app.order_items, app.order_item_modifiers.
- **Pruebas y aceptación:** Reordenar no copia precios obsoletos; recibo restringido; CSV/PDF sólo si se aprueba. Solo dueño; preview valida catálogo actual y no reutiliza tarifas antiguas.
- **Límite / no invadir otra feature:** No copiar precios históricos al pedido nuevo ni generar factura FEL.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** Precisar requisitos legales de recibo, no representar factura FEEL.

#### F24 — Efectivo y transferencias bancarias

- **Responsable:** A · **Prioridad:** P0 · **Tipo:** API + WEB (pago cliente + confirmación backoffice).
- **Dependencias mínimas para avanzar:** F20, F03.
- **Integración posterior / para cierre completo:** F22 gestión operativa, F26 refunds.
- **Alcance funcional:** Definir método habilitado; registro de intención de pago; confirmar efectivo/transferencia por rol autorizado con comprobación; evitar doble confirmación; conciliación manual; auditoría y límites.
- **API — implementación necesaria:** Métodos efectivo/transferencia, confirmación por rol, transacción, idempotencia, auditoría, referencia banco permitida.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/payment-methods; GET /v1/admin/payments; GET /v1/orders/:id/payments; POST /v1/admin/payments/:id/confirm-transfer; POST /v1/admin/payments/:id/confirm-cash`.
- **Next.js — integración obligatoria / excepción:** Checkout: seleccionar efectivo/transferencia, instrucciones y comprobante si aprobado. Admin: revisar/confirmar pago sin duplicación.
- **Datos y migraciones:** app.payment_methods, app.payments, app.audit_events.
- **Pruebas y aceptación:** Estado de pedido independiente del pago; solo autorización competente confirma; no duplicación de pago. Método y monto correctos, doble confirmación rechazada, admin sucursal.
- **Límite / no invadir otra feature:** No procesar tarjetas ni almacenar datos PCI dentro de F24.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** Definir qué comprobantes de transferencia se almacenarán y en qué bucket privado.

#### F25 — Integración Neonet mediante adaptador

- **Responsable:** A · **Prioridad:** Bloqueado proveedor · **Tipo:** API + WEB condicional — adaptador MOCK; producción externa BLOQUEADA.
- **Dependencias mínimas para avanzar:** F20, F24.
- **Integración posterior / para cierre completo:** API/sandbox/homologación oficial Neonet (BLOCKED_EXTERNAL).
- **Alcance funcional:** Definir interfaz PaymentGateway y simulador; no usar tarjeta real en mock; mapear referencias/estados/webhooks/idempotencia; esperar APIs, ambiente y homologación; seguridad PCI mediante solución hospedada/tokenizada; estados finales solo verificados servidor.
- **API — implementación necesaria:** Interfaz gateway, mock determinista, intentos y callbacks verificados solamente con proveedor real; nunca recoger PAN/CVV.
- **API — rutas propuestas de la especificación fuente:** `POST /v1/orders/:id/payment-sessions (propuesto); POST /v1/webhooks/neonet (si lo soporta); GET /v1/orders/:id/payment-status`.
- **Next.js — integración obligatoria / excepción:** Checkout: demo tarjeta etiquetada simulación y flujo real hospedado/tokenizado una vez aprobado; estados/error.
- **Datos y migraciones:** app.payments, app.refunds; extensiones pendientes.
- **Pruebas y aceptación:** Con mock: aprobado/rechazado/error reproducibles; producción bloqueada hasta sandbox y firma/verificación. Sin secretos/tarjetas en logs, mock aprobado/rechazado/error, bloqueo producción.
- **Límite / no invadir otra feature:** No presentar aprobado mock como dinero cobrado ni habilitar producción.
- **Estado de partida:** BLOCKED_EXTERNAL para operaciones reales; MOCK_READY solo tras pruebas.
- **Decisión o brecha original por resolver:** Pendiente contrato Neonet: sesiones, webhook, captura, anulaciones y reembolsos no confirmados.

#### F26 — Reembolsos, cancelaciones monetarias y conciliación

- **Responsable:** A · **Prioridad:** P1 · **Tipo:** API + WEB (reembolsos y conciliación admin).
- **Dependencias mínimas para avanzar:** F24, F20.
- **Integración posterior / para cierre completo:** F25 Neonet para devoluciones reales con tarjetas.
- **Alcance funcional:** Solicitar/aprobar reembolso según política; monto máximo y parcial, motivo; no reembolsar dos veces; distinguir devolución interna y proveedor; conciliación y auditoría; Neonet sólo cuando soporte documentado.
- **API — implementación necesaria:** Crear/consultar refund, reglas de monto parcial/acumulado, autorizaciones, eventos de conciliación; proveedor externo solo confirmado.
- **API — rutas propuestas de la especificación fuente:** `POST /v1/admin/payments/:id/refunds; GET /v1/admin/payments/:id/refunds; GET /v1/admin/payments/reconciliation`.
- **Next.js — integración obligatoria / excepción:** Backoffice: solicitar/aprobar reembolso, motivos, historial y conciliación; estados simulados identificados.
- **Datos y migraciones:** app.payments, app.refunds, app.audit_events.
- **Pruebas y aceptación:** Monto acumulado devuelto <= pagado; autorización y doble control cuando aplique. Reembolso acumulado <= pago, idempotencia, doble control según política.
- **Límite / no invadir otra feature:** No emitir devolución externa sin confirmación del proveedor.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** Modelar intentos/estado/refund events si Neonet lo requiere.

### Logística y repartidores

#### F27 — Motoristas propios y disponibilidad

- **Responsable:** B · **Prioridad:** P0 · **Tipo:** API + WEB (motoristas propios admin).
- **Dependencias mínimas para avanzar:** F07, F03.
- **Integración posterior / para cierre completo:** F09 flag OWN, F28 entregas.
- **Alcance funcional:** CRUD de repartidores por sucursal; activación, vehículo, placa; disponibilidad operativa y estados; reglas de asignación; no usar staff_users automáticamente como riders; datos personales protegidos.
- **API — implementación necesaria:** CRUD app.riders por sucursal, estados activo/disponible/ocupado, vehículo y placa, reglas de asignación.
- **API — rutas propuestas de la especificación fuente:** `GET/POST /v1/admin/riders; GET/PATCH /v1/admin/riders/:id; PATCH /v1/admin/riders/:id/availability`.
- **Next.js — integración obligatoria / excepción:** Backoffice: listado, alta/edición, disponibilidad y filtros, tarjeta de motoristas.
- **Datos y migraciones:** app.riders.
- **Pruebas y aceptación:** Motorista no asignable si inactivo u ocupado según regla; sucursal aislada. Permisos, no asignar a inactivo/ocupado, sucursal correcta, PII protegida.
- **Límite / no invadir otra feature:** La existencia de riders no activa ownDeliveryZonesEnabled.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** DBML no tiene disponibilidad, turnos o retorno persistente explícito.

#### F28 — Entregas con repartidores propios

- **Responsable:** B · **Prioridad:** P0 · **Tipo:** API + WEB (entregas propias).
- **Dependencias mínimas para avanzar:** F20, F27, F09.
- **Integración posterior / para cierre completo:** F22 sincroniza pedido, F30 seguimiento agregado.
- **Alcance funcional:** Crear entrega para pedido elegible; asignar motorista; confirmar recogida, ruta y entrega; registrar retorno a restaurante separado de entrega; cambios de estado auditados; coordinar con órdenes vía puerto o evento de aplicación.
- **API — implementación necesaria:** Crear entrega OWN, asignar motorista, recogido/entregado/retorno, historial; consumo OrderFulfillmentPort sin escritura SQL de orders.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/admin/deliveries; GET /v1/admin/deliveries/:id; POST /v1/admin/deliveries/:id/assign-own-rider; POST /v1/admin/deliveries/:id/{mark-picked-up,mark-delivered,return-to-branch}`.
- **Next.js — integración obligatoria / excepción:** Backoffice: lista/detail, asignación y botones de estados, retorno a restaurante, refresco dirigido.
- **Datos y migraciones:** app.deliveries, app.delivery_status_history, app.riders.
- **Pruebas y aceptación:** No dobles asignaciones; historial correcto; retorno libera disponibilidad; pedido no se modifica por SQL desde B. No doble asignación, idempotencia, permiso branch, retorno libera motorista.
- **Límite / no invadir otra feature:** No gestionar servicios reales PedidosYa, corresponden a F29.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** Extender estado/logística para retorno y disponibilidad.
- **Límite PedidosYa:** El flujo de pedidos internos y reparto OWN puede avanzarse con contratos reales; el flujo operativo externo se reporta `BLOCKED_EXTERNAL` hasta entrega y validación del proveedor. No usar un mock para despacho real.

#### F29 — PedidosYa Courier (adaptador + contrato pendiente)

- **Responsable:** B · **Prioridad:** Bloqueado proveedor · **Tipo:** API + WEB (adaptador/mock + sección Courier; real BLOCKED_EXTERNAL).
- **Dependencias mínimas para avanzar:** Contrato F09; modelo F20 de orden/entrega, F28 puede compartir modelo logístico sin ser requisito rígido.
- **Integración posterior / para cierre completo:** API, credenciales y sandbox PedidosYa pendientes.
- **Alcance funcional:** Diseñar interfaz CourierProvider; simulación de cotización/solicitud/cancelación/tracking; idempotencia y referencias externas; normalizar estado externo sin asumir equivalencia; webhooks solo si proveedor soporta; recopilar costo cotizado y real.
- **API — implementación necesaria:** Puerto CourierProvider y mock; persistencia intentos/idempotencia; adaptador real solo tras documentación, webhooks si oficiales.
- **API — rutas propuestas de la especificación fuente:** `POST /v1/admin/deliveries/:id/courier-quote; POST /v1/admin/deliveries/:id/request-pedidosya; POST /v1/admin/deliveries/:id/cancel-courier; POST /v1/webhooks/pedidosya (propuestos)`.
- **Next.js — integración obligatoria / excepción:** Backoffice: cotizar/solicitar/seguir/cancelar si está soportado; MOCK en demo etiquetado, botones reales bloqueados sin proveedor.
- **Datos y migraciones:** app.deliveries; nuevas tablas propuestas cotizaciones, solicitudes, eventos.
- **Pruebas y aceptación:** Mock sin tráfico externo; conectividad real bloqueada hasta documentación, credenciales y ambiente. UNKNOWN sin conexión, fallos/reintentos, no doble solicitud, secretos no públicos.
- **Límite / no invadir otra feature:** No inventar endpoints, cobertura, tarifa o ETA oficiales; no usar MOCK en producción real.
- **Estado de partida:** BLOCKED_EXTERNAL para operaciones reales; MOCK_READY solo tras pruebas.
- **Decisión o brecha original por resolver:** DBML deliveries no tiene provider ni external refs ni cotizaciones/eventos; ampliar tras contrato oficial.
- **Límite PedidosYa:** El flujo de pedidos internos y reparto OWN puede avanzarse con contratos reales; el flujo operativo externo se reporta `BLOCKED_EXTERNAL` hasta entrega y validación del proveedor. No usar un mock para despacho real.

#### F30 — Vista agregada de entregas y tracking logístico

- **Responsable:** B · **Prioridad:** P1 · **Tipo:** API + WEB (dashboard logístico).
- **Dependencias mínimas para avanzar:** F28 para flujo propio y F20 pedidos.
- **Integración posterior / para cierre completo:** F29 datos Courier externos cuando estén disponibles.
- **Alcance funcional:** Vista por sucursal y estado, resumen de ocupación, ETA si proveedor lo ofrece, filtros y paginación; endpoint de timeline autorizado; actualización incremental o realtime cuando aporte valor.
- **API — implementación necesaria:** Overview entregas, agrupación por sucursal/proveedor/estado, timeline y permisos.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/admin/deliveries/overview; GET /v1/admin/deliveries/:id/history; GET /v1/admin/deliveries/:id/tracking`.
- **Next.js — integración obligatoria / excepción:** Backoffice: pestañas OWN/PEDIDOSYA, historial y tracking, disponibilidad de riders; estados externos reales solo tras F29.
- **Datos y migraciones:** app.deliveries, app.riders, app.delivery_status_history.
- **Pruebas y aceptación:** Una consulta agregada por panel; datos privados fuera de CDN; modo sin realtime correcto. Consultas agregadas, datos privados, estados veraces, paginación/refetch.
- **Límite / no invadir otra feature:** No bloquear dashboard OWN por F29 externo.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** Elegir mecanismo realtime y eventos tras medir consumo.
- **Límite PedidosYa:** El flujo de pedidos internos y reparto OWN puede avanzarse con contratos reales; el flujo operativo externo se reporta `BLOCKED_EXTERNAL` hasta entrega y validación del proveedor. No usar un mock para despacho real.

### Operación, reportes y administración

#### F31 — Notificaciones WhatsApp y eventos transaccionales

- **Responsable:** A · **Prioridad:** P1 · **Tipo:** API/eventos + WEB (notificaciones y consola técnica).
- **Dependencias mínimas para avanzar:** F20; contrato de eventos/pedidos.
- **Integración posterior / para cierre completo:** F22, F24, F28, F29 eventos; proveedor WhatsApp sujeto a aprobación.
- **Alcance funcional:** Notificar confirmación y cambios relevantes; registro de intento, estado y referencia; plantilla y destinatario; reintentos con backoff sin duplicación; patrón outbox si se requiere consistencia; adaptar proveedor oficial de WhatsApp cuando se defina.
- **API — implementación necesaria:** Outbox/intentos, plantillas, reintentos seguros, idempotencia, registro de resultado; adaptador del canal acordado.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/admin/notifications; POST /v1/admin/notifications/:id/retry; eventos internos OrderPlaced/StatusChanged`.
- **Next.js — integración obligatoria / excepción:** Notificaciones del estado en tienda cuando correspondan; backoffice o panel técnico: lista de intentos/reenvíos autorizados.
- **Datos y migraciones:** app.notifications.
- **Pruebas y aceptación:** Fallo WhatsApp no cancela pedido; reintentos auditables; no filtrar PII en logs. Reintentos no duplican, errores controlados, sin PII en logs.
- **Límite / no invadir otra feature:** No revertir pedido porque falle WhatsApp; no afirmar mensajes enviados sin proveedor real.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** DBML notifications no incluye cantidad de intentos/error ni outbox; proveedor WhatsApp por confirmar.

#### F32 — Incidencias, reclamos y resoluciones

- **Responsable:** B · **Prioridad:** P1 · **Tipo:** API + WEB (cliente y backoffice de incidencias).
- **Dependencias mínimas para avanzar:** F20, F03 para gestión admin.
- **Integración posterior / para cierre completo:** F28/F29 contexto entrega, F26 compensaciones.
- **Alcance funcional:** Reclamo por pedido y artículos; descripción, resolución solicitada, responsable, estado, notas y trazabilidad; cliente sólo ve propios; admin asigna y resuelve con permisos.
- **API — implementación necesaria:** CRUD/listados/status de incidentes e incident_items/updates, propiedad cliente y permisos admin.
- **API — rutas propuestas de la especificación fuente:** `POST /v1/orders/:id/incidents; GET /v1/me/incidents; GET /v1/admin/incidents; GET /v1/admin/incidents/:id; POST /v1/admin/incidents/:id/updates; PATCH /v1/admin/incidents/:id/status`.
- **Next.js — integración obligatoria / excepción:** Cliente: reportar/consultar reclamos. Backoffice: tablero, filtros, detalle, notas/resolución.
- **Datos y migraciones:** app.incident_types, app.incidents, app.incident_items, app.incident_updates.
- **Pruebas y aceptación:** Solo cliente legítimo reclama; transición con motivo; adjuntos opcionales sujetos a nueva entidad. Solo pedido propio, roles/sucursal, historial íntegro y motivos.
- **Límite / no invadir otra feature:** No tramitar cobros o reembolsos directamente desde este módulo.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** Prototipo cliente incluye reclamaciones; revisar necesidad de archivos evidenciales.

#### F33 — Dashboard agregado de backoffice

- **Responsable:** B · **Prioridad:** P1 · **Tipo:** API + WEB (dashboard principal).
- **Dependencias mínimas para avanzar:** F22, F24, F20; F03 permisos.
- **Integración posterior / para cierre completo:** F28 riders/entregas, F29 datos externos.
- **Alcance funcional:** KPIs, últimos pedidos, alertas, resumen por sucursal y filtros; respetar permisos; respuesta compacta con métricas calculadas en PostgreSQL; caché privada y caducidad breve.
- **API — implementación necesaria:** GET overview con KPIs/contadores por sucursal y período, consultas SQL agregadas, permisos.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/admin/overview`.
- **Next.js — integración obligatoria / excepción:** Dashboard backoffice con gráficas, KPIs, alertas y tendencias usando datos reales; estados vacíos.
- **Datos y migraciones:** Lecturas agregadas orders/payments/deliveries (sin titularidad escritora).
- **Pruebas y aceptación:** Datos consistentes y acotados por sucursal; sin exponer datos de otra sucursal; tiempos medidos. Totales consistentes, filtros de sucursal, p95/caché y privacidad.
- **Límite / no invadir otra feature:** No presentar datos mock como cifras reales; no inventar costos externos.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** B usa query interfaces públicas de A para pedidos/pagos; no escribir tablas ajenas.

#### F34 — Reportes de ventas, pedidos, productos y entrega

- **Responsable:** B · **Prioridad:** P1 · **Tipo:** API + WEB (reportes).
- **Dependencias mínimas para avanzar:** F20, F24, F03; F33 consultas agregadas cuando exista.
- **Integración posterior / para cierre completo:** F15 promos, F28 propia, F29 proveedor externo.
- **Alcance funcional:** Agregaciones por periodo/sucursal; desempeño de productos, pedidos por fecha, ventas, delivery por proveedor y motoristas; filtros consistentes; criterios para pedido pagado/cancelado y reembolso; índices y paginación.
- **API — implementación necesaria:** Ventas y pedidos por fechas/sucursal, top products, delivery por proveedor/costos separados, agregados SQL.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/admin/reports/summary; GET /v1/admin/reports/sales; GET /v1/admin/reports/top-products; GET /v1/admin/reports/deliveries`.
- **Next.js — integración obligatoria / excepción:** Backoffice: filtros de período/sucursal, tablas, gráficas y desgloses de reparto OWN/PEDIDOSYA.
- **Datos y migraciones:** app.orders, app.order_items, app.payments, app.deliveries (lectura).
- **Pruebas y aceptación:** Totales y periodos reconciliados con definición financiera; índices adecuados; permiso de reporte. Conciliación, autorización por sucursal, filtros exactos y rendimiento.
- **Límite / no invadir otra feature:** No mezclar cobrado al cliente con costo proveedor ni inventar costos propios.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** Definir base contable: ventas por colocado/pagado, tasas y reembolsos.

#### F35 — Exportaciones CSV y tareas administrativas

- **Responsable:** B · **Prioridad:** P2 · **Tipo:** API + WEB (exportación administrativa).
- **Dependencias mínimas para avanzar:** F34, F03.
- **Integración posterior / para cierre completo:** F22 export pedidos, jobs solo si volumen justifica.
- **Alcance funcional:** Exportar filtros de listados y reportes; para volúmenes pequeños CSV streaming, para grandes job asíncrono sólo si se necesita; excluir PII no autorizada; logs y límites.
- **API — implementación necesaria:** CSV streaming con permisos, filtros, límites, escape de fórmula, jobs sólo si aprobados.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/admin/reports/export?format=csv; POST /v1/admin/exports (si aplica); GET /v1/admin/exports/:id (si aplica)`.
- **Next.js — integración obligatoria / excepción:** Botones Exportar y estados de descarga/errores en reportes y pedidos.
- **Datos y migraciones:** Sin tabla de export jobs en DBML.
- **Pruebas y aceptación:** Exportar coincide filtros y permiso; límites de tamaño; caracteres CSV escapados. CSV seguro, mismas cifras y filtros que pantalla, autorización.
- **Límite / no invadir otra feature:** No crear cola de jobs sin necesidad; no exponer PII de otras sucursales.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** El DBML no contempla trabajos de exportación, evaluar más adelante.

#### F36 — Auditoría transversal y registro de cambios sensibles

- **Responsable:** A · **Prioridad:** P0 · **Tipo:** API/infra transversal + WEB (visor admin).
- **Dependencias mínimas para avanzar:** F00; contexto F03 para visor y atribución.
- **Integración posterior / para cierre completo:** Todas las operaciones críticas usan AuditWriter.
- **Alcance funcional:** Servicio compartido para cambios en permisos, precio, cancelaciones, entregas y pagos; registrar actor, sucursal, entidad, motivo y diff redactado; no guardar secretos o tarjetas; consulta restringida; operación en transacción cuando aplique.
- **API — implementación necesaria:** Servicio AuditWriter con actor/recurso/cambio redactado, atomicidad con comando cuando corresponda; lectura admin.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/admin/audit-events; servicio interno AuditWriter`.
- **Next.js — integración obligatoria / excepción:** Backoffice: vista audit-events con filtros por actor/sucursal/entidad/fecha, visibilidad por permisos.
- **Datos y migraciones:** app.audit_events.
- **Pruebas y aceptación:** Cambios críticos generan evento verificable; datos sensibles filtrados; B consume AuditWriter, no duplica auditoría. Cambios críticos trazables, redacción segura, acceso por sucursal.
- **Límite / no invadir otra feature:** No auditar información secreta ni reimplementar servicio en cada feature.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** Definir retención, inmutabilidad y política de visualización.

#### F37 — Postulaciones de empleo y contacto

- **Responsable:** B · **Prioridad:** P2 · **Tipo:** API + WEB (postulación pública + gestión admin).
- **Dependencias mínimas para avanzar:** F07 para sucursal opcional; F00.
- **Integración posterior / para cierre completo:** F03 autoriza admin, R2 privado si CV adjunto.
- **Alcance funcional:** Recibir y consultar solicitudes laborales; validaciones, rate-limit/antispam, seguimiento y estado; permitir adjuntos sólo bajo política y medios privados; contacto general requiere definición si se necesita persistencia.
- **API — implementación necesaria:** POST postulaciones con validación/antispam, estado, admin list y update; datos privados/retención.
- **API — rutas propuestas de la especificación fuente:** `POST /v1/job-applications; GET /v1/admin/job-applications; PATCH /v1/admin/job-applications/:id/status; POST /v1/contact (solo si aprobado)`.
- **Next.js — integración obligatoria / excepción:** Tienda: Trabaja con nosotros, formulario/contacto aprobado. Backoffice: listado y seguimiento.
- **Datos y migraciones:** app.job_applications; contacto sin tabla definida.
- **Pruebas y aceptación:** Envío público protegido; gestión restringida; datos personales con retención definida. No spam, datos protegidos, acceso admin, formularios verificados.
- **Límite / no invadir otra feature:** No almacenar CV público sin política; contacto general solo si aprobado.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** Adjuntos y contacto general no están modelados en DBML.

#### F38 — Configuración de plataforma y contenido público

- **Responsable:** B · **Prioridad:** P2 · **Tipo:** API + WEB condicional (configuración aprobada).
- **Dependencias mínimas para avanzar:** F07, F03 para settings por sucursal.
- **Integración posterior / para cierre completo:** F16 banners; F09 flag de OWN se REUTILIZA, no duplica.
- **Alcance funcional:** Preferencias configurables de tienda: visualización pública, enlaces/contacto, locales soportados, métodos visibles; separar configuración estática de datos DB; restringir cambios globales; invalidar CDN.
- **API — implementación necesaria:** GET config pública y admin GET/PATCH solo datos dinámicos aprobados, invalidación/selectividad.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/store/config; GET/PATCH /v1/admin/settings (si se aprueba persistencia)`.
- **Next.js — integración obligatoria / excepción:** Tienda: textos/contacto/locales públicos. Backoffice: editor de opciones aprobadas sin duplicar settings logísticas.
- **Datos y migraciones:** No hay tabla general settings en DBML.
- **Pruebas y aceptación:** No depender de endpoint para tokens de diseño estáticos; límites claros de configuración. Configuración consistente, no exponer secretos, permisos por scope.
- **Límite / no invadir otra feature:** No convertir tokens visuales estáticos a tablas DB arbitrariamente.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** Requiere decisión si se necesita tabla settings; no generar una por costumbre.

#### F39 — Observabilidad, pruebas de carga y costos

- **Responsable:** A · **Prioridad:** P0 · **Tipo:** API/infra + instrumentación WEB; sin pantalla comercial obligatoria.
- **Dependencias mínimas para avanzar:** F00.
- **Integración posterior / para cierre completo:** Toda la plataforma instrumentada, F40 visor soporte opcional.
- **Alcance funcional:** Request IDs, errores estructurados, métricas por feature, duración/errores DB, monitoreo de caché, análisis rate limiting, cost budgets Vercel/Supabase/R2, pruebas de carga con datos artificiales; evitar logs de información personal.
- **API — implementación necesaria:** Logs estructurados, request-id, métricas p95/errores/caché, costos, load test y dashboard externo técnico.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/health; métricas internas restringidas; no endpoint público de monitorización sensible`.
- **Next.js — integración obligatoria / excepción:** Instrumentar Web Vitals/errores permitidos, sin construir panel comercial de métricas salvo decisión posterior.
- **Datos y migraciones:** Infraestructura, sin tabla obligatoria.
- **Pruebas y aceptación:** CI verificable; latencias/errores medidos; sin credenciales expuestas ni logging de JWT. Trazabilidad web→API, carga con datos falsos, alertas y presupuestos.
- **Límite / no invadir otra feature:** No exponer endpoint de métricas con datos sensibles; no loggear JWT.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** Definir plataforma observabilidad y umbrales tras datos reales.

#### F40 — Backoffice de soporte técnico (futuro)

- **Responsable:** A · **Prioridad:** P2 · **Tipo:** FUTURA/CONDICIONAL: API restringida + WEB soporte separado si aprobado.
- **Dependencias mínimas para avanzar:** F03, F36, F39.
- **Integración posterior / para cierre completo:** F29 diagnóstico externo según proveedor.
- **Alcance funcional:** Definir acceso técnico separado o rol específico, diagnóstico limitado, trazabilidad y break-glass con autorización; prohibir acceso indiscriminado a datos cliente y a producción; utilidades de soporte sujetas a aprobación.
- **API — implementación necesaria:** Rutas de diagnóstico mínimas autorizadas, trazabilidad, controles break-glass si aprobados.
- **API — rutas propuestas de la especificación fuente:** `GET /v1/support/diagnostics (futuro y restringido); sin endpoints activos en MVP`.
- **Next.js — integración obligatoria / excepción:** Panel soporte técnico aislado del backoffice de negocio, vistas y acciones limitadas, si aprobado.
- **Datos y migraciones:** app.audit_events; entidades adicionales por definir.
- **Pruebas y aceptación:** No habilitar cuenta maestra oculta; toda asistencia auditada y temporal. Roles explícitos, auditabilidad, autorización temporal, revisión legal y seguridad.
- **Límite / no invadir otra feature:** No crear cuenta maestra ni endpoint de acceso irrestricto; no asumir feature incluida en MVP.
- **Estado de partida:** POR DETERMINAR tras inspección Git y tests.
- **Decisión o brecha original por resolver:** Requerimiento mencionado en decisiones previas, ausente de prototipos/DBML.

## 5. Etapas sugeridas sin ejecución automática

| Etapa                | Desarrollador A                           | Desarrollador B                   | Puerta de integración                            |
| -------------------- | ----------------------------------------- | --------------------------------- | ------------------------------------------------ |
| Base y autorización  | F00 → F01 → F02 → F03 (contratos)         | F07 (contratos + público)         | Contexto staff y sucursales no vulnerables       |
| Geografía y clientes | F04 → F05; F06 cuando exista contrato F11 | F08 → F09; F10 → F11              | Catálogos, direcciones, menús y contratos        |
| Catálogo completo    | Contratos F18; F36 transversal temprano   | F12/F13/F14 y después F15/F16/F17 | Precio/modificador/promoción consistentes        |
| Checkout y pedidos   | F18 → F19 → F20 → F21/F22                 | F27; F28 al existir pedidos       | Pedido real pickup/OWN sin PedidosYa             |
| Operación            | F23/F24/F31                               | F28/F30/F32/F33                   | Entrega propia, panel y WhatsApp según proveedor |
| Ampliaciones         | F25/F26/F39/F40                           | F29/F34/F35/F37/F38               | Externos no bloquean internos; validar sandbox   |

**ATENCIÓN:** Es una secuencia sugerida; NO significa permiso para empezar de forma automática ninguna feature.

## 6. Plantilla de aceptación por feature

Para declarar una feature `READY`, reportar: ID/rama/commit; dependencias; diff; contratos OpenAPI; migraciones preparadas/aplicadas (ambiente); API ejecutada y casos 401/403/409; pantalla(s) Next.js conectadas a datos reales (o excepción de alcance); tests unitarios/integración/E2E, lint, typecheck, build; observaciones de seguridad y rendimiento; cambios en archivos compartidos; bloqueos y deuda; confirmación de no push/merge/deploy no autorizados.

**Antes de F10 o posteriores:** revisar `docs/AUDITORIA_F00_F09.md`. Sin evidencia de implementación real, marcar `NOT_VERIFIED` o `PARTIAL`, no READY.
