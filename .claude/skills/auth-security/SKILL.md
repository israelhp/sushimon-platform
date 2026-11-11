---
name: auth-security
description: 'Autenticación (Google OAuth vía Supabase), RBAC por sucursal y seguridad de aplicación. Úsala al tocar auth, permisos o datos sensibles.'
---

# Auth y seguridad

Reglas: `.claude/rules/security.md`; docs: `docs/security/README.md`.

## Backoffice (orden de verificación en la API)

Token verificable → identidad Google → `staff_users` activo → rol → permiso → alcance de sucursal →
autorización sobre el recurso. Cualquier fallo = 401/403 sin filtrar detalles.

## Tienda pública

Navegación y checkout invitado permitidos; Google opcional; un cliente solo ve **sus** datos.

## Checklist

JWT validado (firma, `aud`, `exp`) · CORS por lista blanca · rate limiting · validación de entrada ·
XSS/CSRF según mecanismo de sesión · secretos fuera del repo · logs sin PII · webhooks verificados ·
auditoría de acciones sensibles. El login por contraseña del prototipo es **solo visual**.
