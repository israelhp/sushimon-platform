---
name: prototype-analysis
description: 'Análisis seguro de los prototipos HTML (bundles) y el DBML. Úsala para extraer pantallas, flujos y requisitos.'
---

# Análisis de prototipos

Fuentes: `docs/references/*`. **No ejecutar** los HTML con credenciales ni abrir sus scripts con acceso a producción.

- Backoffice: es un bundle (`__bundler/manifest` + `__bundler/template`). Extrae con Python en modo
  aislado (`python3 -I`): decodifica base64/gzip del manifest y lee el template como texto.
- Tienda pública: bundle Vite en un `<script type="module">`; buscar cadenas de UI y rutas por lectura.
- Resultado en `docs/ui/prototype-inventory.md`: pantallas, flujos, estados, componentes, y marcar
  **demostrado / confirmado / pendiente**. Registrar inconsistencias con el DBML.
- Los prototipos son referencia, no código de producción.
