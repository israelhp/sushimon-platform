---
name: database-integrity
description: 'Integridad, índices, concurrencia y migraciones sobre el DBML de Sushi Mon. Úsala al tocar el modelo de datos.'
---

# Integridad de base de datos

Línea base inmutable: `docs/references/monsushi_dbdiagram.dbml`. Brechas: `docs/database/schema-gap-analysis.md`.

## Procedimiento

1. Localizar tablas y relaciones afectadas; revisar brechas conocidas.
2. Proponer migración SQL (nunca editar el DBML): CHECK, índices parciales, FKs, defaults.
3. Analizar concurrencia: asignación de repartidor, idempotencia de pagos, transiciones de estado.
4. Probar restricciones (insertar datos inválidos debe fallar) en una base local/desechable.
5. ADR + revisión humana antes de aplicar. **Nunca** aplicar a bases reales ni usar `reset`/`DROP` sin aprobación.

## Criterios

Snapshots en pedidos · auditoría monetaria · RLS/permisos de Supabase revisados · índices para filtros reales
(sucursal+estado+fecha) · sin N+1.
