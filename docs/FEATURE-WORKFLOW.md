# SushiMon — Política de ejecución de una feature

Esta política complementa (NO sustituye) los `CLAUDE.md`, reglas, orquestador, agentes, skills y Spec Kit ya presentes.

## Regla de activación

- El backlog de 41 features se **lee para contexto** y no es una lista de tareas a ejecutar automáticamente.
- Implementa **solamente una feature FXX expresamente autorizada en la petición actual**. Una orden de revisión/auditoría NO autoriza implementación.
- **No avances a la siguiente** al terminar, aunque todas sus dependencias estén resueltas.
- No implementes por tu cuenta features dependientes completas. Si falta una dependencia, usa el contrato acordado, un adaptador seguro o documenta el bloqueo.

## Antes de escribir código

1. Identificar `FXX` exacta y la rama designada.
2. Leer `docs/BACKLOG.md` (ficha FXX), Spec Kit de esa feature y los `CLAUDE.md` relevantes.
3. Verificar repositorio: `git status`, rama actual, `develop`, cambios locales, PRs y migraciones sin fusionar; no descartar trabajo.
4. Validar dependencias concretas en el código. Considerar `NOT_VERIFIED` aunque figure avanzadas si faltan evidencias.
5. Confirmar **tipo y alcance** del backlog (API + WEB, WEB principal, API/infra + WEB técnico o futuro condicional).
6. Identificar contratos y módulos de la otra computadora que NO deben reescribirse.
7. Planificar una sola vertical slice: contratos → DB si aplica → API → Web si aplica → tests.

## Durante

- Utiliza el orquestador existente para asignar agentes según necesidad, sin crear otro conjunto.
- Usa DTOs tipados, permisos y branch-scope, seguridad server-side, TanStack Query y cliente tipado existente.
- Mantén separación de dominios y de estados `OWN` vs `PEDIDOSYA` y operaciones `READY` vs `MOCK_READY`.
- Nunca pongas mocks de PedidosYa o Neonet como confirmación real de operación en producción.
- No hagas commit/push/merge/deploy ni migración destructiva/sobre producción sin autorización explícita.
- Si haces cambios en Prisma, avisa al otro desarrollador y coordina una sola migración compartida por vez.

## Al finalizar

- Reporta código y pantallas realmente conectadas, endpoints, contratos, migraciones, pruebas ejecutadas y resultados.
- Distingue `READY`, `PARTIAL`, `MOCK_READY`, `BLOCKED_EXTERNAL`, `NOT_VERIFIED` por subcapacidad.
- Actualiza el seguimiento de la feature en el PR/especificación existente; no realices cambios simultáneos al backlog maestro en ramas de ambos equipos.
- Detente. **No empieces otra FXX**.

## Gate obligatorio F00–F09

Antes de implementar F10 o posterior, revisar si existe auditoría reciente basada en la `develop` integrada y las ramas relevantes. Si no existe, ejecutar **auditoría de solo lectura** de `docs/AUDITORIA_F00_F09.md`; reportar brechas. El audit no autoriza repararlas ni implementar la siguiente feature.
