# F14 — Pendientes para retomar (Cloudflare R2 y medios)

Estado de la feature: **API + web implementadas y probadas con almacenamiento simulado**. La integración con R2 real es `BLOCKED_EXTERNAL`: nada de lo de abajo se ha verificado contra Cloudflare. Referencias: `specs/015-cloudflare-r2-media/spec.md`, `docs/adr/0020-medios-cloudflare-r2.md`, `docs/integrations/cloudflare-r2.md`.

Última verificación (2026-11-16): `pnpm check` verde; migración `0015` aplicada por el propietario; `test/media.int-spec.ts` 7/7 contra la BD de pruebas (Supabase). `test/migration-0015.int-spec.ts` se omite contra Supabase y corre en el CI.

## A. Configuración externa (propietario)

- [ ] Crear el bucket R2 (privado) y un token S3 con permisos mínimos sobre ese bucket.
- [ ] Dominio público de medios, **separado** del de la app, apuntado al bucket → `R2_PUBLIC_BASE_URL` (https). No se inventó ningún dominio.
- [ ] CORS del bucket: `PUT` (y `HEAD`) desde el origen del backoffice; cabeceras `Content-Type`, `Cache-Control`, `x-amz-checksum-sha256`.
- [ ] Reglas de caché del dominio y cabecera `X-Content-Type-Options: nosniff`.
- [ ] Variables en el entorno de la API (todas o ninguna): `R2_ACCOUNT_ID` (o `R2_ENDPOINT`), `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE_URL`, `R2_REGION=auto`, `MEDIA_MAX_BYTES`, `MEDIA_UPLOAD_TTL_SECONDS`. Nunca `NEXT_PUBLIC_`. Sin ellas la API responde 503 `MEDIA_STORAGE_UNAVAILABLE`.

## B. Verificar con R2 real (cuando exista el bucket)

- [ ] R2 acepta el PUT con las cabeceras firmadas, incluido `Content-Length`.
- [ ] `HeadObject` devuelve el checksum SHA-256 (si no, `complete` falla cerrado por diseño).
- [ ] GET con `Range` (comprobación de firma de archivo) funciona.
- [ ] CORS desde el navegador real; el XHR no fija `Content-Length`/`Host` (los gestiona el navegador).
- [ ] Imágenes públicas servidas con caché inmutable y `nosniff`.
- [ ] Al verificar: pasar `docs/integrations/README.md` de `BLOCKED_EXTERNAL` a verificado y anotar la fecha.

## C. Pruebas y revisiones que no se hicieron

- [ ] Web contra la API real (hoy solo mock).
- [ ] Revisión de QA y de UI/UX de la feature.
- [ ] Playwright proyecto `e2e-mobile` y suite visual.
- [ ] Prueba manual del flujo completo: subir → completar → adjuntar → ver en la tienda.

## D. Decisiones y deuda técnica

- [ ] **Desviación del contrato (P13):** `MEDIA_CONTENT_MISMATCH` borra el objeto de inmediato pero deja la fila `PENDING` con `expires_at = now`; la purga la elimina a los 5 min. El contrato dice «se borra el objeto y el asset». Decidir: ajustar el código (borrar la fila en el acto) o el texto del contrato.
- [ ] **Sin cron de purga:** la limpieza es perezosa (al crear un intent, lote de 20, 3 s) y `MediaCleanupService.purgeExpired()` queda listo para un job. Decidir si se programa (p. ej. con F39/infraestructura).
- [ ] Sin procesamiento de imágenes en servidor (la web optimiza antes de subir). Si se necesitan variantes/miniaturas, requiere ADR y no usar Cloudflare Image Resizing (decisión de la petición).
- [ ] Revisar objetos huérfanos en R2 si algún borrado best-effort falló (el log avisa con la clave).
