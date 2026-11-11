## Resumen

<!-- Qué cambia y por qué. Enlaza la spec (specs/NNN-…) si existe. -->

## Tipo de rama / destino

- [ ] `feature/*`, `fix/*` → `develop`
- [ ] `release/*` → `main` (y vuelta a `develop`)
- [ ] `hotfix/*` → `main` (y vuelta a `develop`)

## Estado de integración (slice)

`MOCK_ONLY` · `CONTRACT_DEFINED` · `API_IMPLEMENTED` · `INTEGRATED` · `VERIFIED` · `BLOCKED_EXTERNAL`

Estado resultante de este PR: <!-- uno de los anteriores -->

## Checklist

- [ ] `pnpm check` pasa localmente
- [ ] Contrato OpenAPI actualizado **antes** de la implementación (`pnpm contracts:check`)
- [ ] Pruebas añadidas/actualizadas (incluye regresión si es un fix)
- [ ] Sin secretos, `.env` ni datos reales de clientes
- [ ] Autorización por rol/sucursal verificada en el servidor (si aplica)
- [ ] Docs actualizadas (marcar implementado vs. simulado vs. pendiente)
- [ ] Migración revisada por database-engineer (si aplica); sin cambios destructivos
- [ ] Capturas/video si cambia la UI (comparar con el prototipo)

## Riesgos y notas para el revisor
