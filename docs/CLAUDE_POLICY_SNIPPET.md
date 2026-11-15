## Política de backlog y ejecución controlada (añadir a `CLAUDE.md` existente)

- Backlog oficial: `docs/BACKLOG.md`; proceso: `docs/FEATURE-WORKFLOW.md`; auditoría: `docs/AUDITORIA_F00_F09.md`.
- **Leer no significa ejecutar:** implementar **solo la feature FXX expresamente solicitada** en la sesión actual. Nunca recorrer F00–F40 automáticamente ni iniciar otra feature tras terminar.
- Antes de codificar: confirmar rama Git/estado, dependencias, contrato, dueño, tipo (API + WEB, WEB principal, API/infra o condicional), especificación individual y cambios del otro desarrollador.
- Aplicar el orquestador, agentes, skills, rules, hooks y Spec Kit existentes; **no duplicarlos**.
- Para una feature API+WEB, verificar que UI Next.js consuma la API real; Mock Data no equivale a READY. Para F18 frontend principal o F00/F39 infraestructura, respetar la excepción indicada en el backlog.
- F03/F07 coordinan contratos y seguridad; F05 integra Mis direcciones y selector en checkout; F06 integra Mis favoritos y botones en menú.
- PedidosYa Courier real permanece `BLOCKED_EXTERNAL` hasta documentación/API/sandbox, con `UNKNOWN` si no se verifica cobertura. Zonas OWN deshabilitadas inicialmente por `ownDeliveryZonesEnabled=false`. No permitir despachos reales con mocks.
- Dos máquinas: ramas y PR independientes, revisión cruzada en contratos/migraciones. No sobrescribir worktrees ni cambiar DB compartida sin coordinación.
- Antes de nueva F10+ solicitar auditoría F00–F09 solo lectura si no se ha realizado. **Auditar no autoriza reparar ni continuar**.
- Sin commits, push, merge, deploy o migraciones contra producción sin autorización. Reportar evidencias, dependencias y estado; detenerse.
