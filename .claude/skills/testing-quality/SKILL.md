---
name: testing-quality
description: 'Estrategia de pruebas y quality gates. Úsala al escribir pruebas o validar un cambio.'
---

# Pruebas y calidad

Pirámide: unit (Vitest) → integración/e2e API (supertest) → contrato (`pnpm contracts:check`) → E2E web
(Playwright, al existir pantallas). Hooks de seguridad: `pnpm test:hooks`.

## Reglas

Bug ⇒ prueba de regresión primero · deterministas, sin red · no debilitar aserciones · cubrir ramas de
autorización y errores · reportar solo salidas reales.

## Gates (`pnpm check`)

format:check → lint → typecheck → test → contracts:check → secrets:scan → build. CI repite todo.
