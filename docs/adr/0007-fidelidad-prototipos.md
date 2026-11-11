# ADR-0007 Fidelidad a los prototipos: se reutiliza contenido, no código

**Estado**: aceptada · 2026-11-11

**Contexto**: la Etapa 1 exige que la tienda y el backoffice sean visualmente idénticos a
`docs/references/*-prototype.html`, pero la regla del repo prohíbe copiar el código empaquetado.
**Decisión**:

- **Se permite extraer contenido y recursos**: valores de tokens (colores, radios, sombras, tamaños, breakpoints),
  textos (i18n), trazados SVG, logos y datos semilla. Herramientas: `scripts/prototype-extract.mjs` (decodifica
  base64/gzip y recorta texto; **no ejecuta** el bundle) y `scripts/prototype-i18n.mjs` (evalúa _solo_ el literal del
  diccionario en un contexto `vm` vacío). Salida en `docs/ui/extracted/` (ignorada por git, regenerable).
- **No se copia código**: componentes, layout, estado y lógica se reescriben en React 19 + Tailwind 4 con la
  arquitectura del repo (data-access, services, hooks, i18n).
- La fidelidad se verifica con capturas Playwright del prototipo (red bloqueada, reloj congelado) frente a la app
  (`pnpm --filter sushimon-web test:visual`) y la revisión del agente `ui-ux-reviewer`.
  **Consecuencias**: las diferencias intencionales (rutas reales en el backoffice, accesibilidad añadida, estados del
  contrato) se documentan en `docs/ui/prototype-inventory.md`.
