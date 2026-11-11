---
name: ui-design-system
description: 'Sistema visual de Sushi Mon (tokens, tipografía, componentes, temas). Úsala al construir o revisar UI.'
---

# Design system

Detalle: `docs/ui/design-system.md`. Identidad extraída de los prototipos: fondo cálido `#FAF7F2`
(oscuro `#0B0B0F`), primario rojo `#DC2626`/`#EF4444`, acento ámbar `#F59E0B`/`#FBBF24`; tipografías
Archivo Black (títulos) y DM Sans (texto).

## Reglas

Tokens en `globals.css` (sin hex sueltos) · tema claro/oscuro · componentes reutilizables (botón, pill,
tarjeta, tabla, modal, drawer, switch, toolbar) · espaciados y bordes consistentes · transiciones
sobrias con `prefers-reduced-motion` · contraste AA · estados vacío/carga/error.
Referencia, no copia: no portar el CSS/JS empaquetado de los prototipos.
