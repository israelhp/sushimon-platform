---
name: performance-cost
description: 'Rendimiento y costos (consultas, caché, renderizado, conexiones). Úsala al diseñar listados, catálogo, checkout o panel.'
---

# Rendimiento y costos

Contexto: ~100 pedidos/día, 3→5 sucursales: optimizar con medición, no por intuición.

- Paginación obligatoria en listados; índices acordes a filtros (sucursal, estado, fecha).
- Evitar N+1; agregaciones en SQL cuando convenga; pool de conexiones a Supabase acotado.
- Caché de catálogo/promociones con invalidación definida; privada por usuario/sucursal si aplica.
- Next: renderizado estático/streaming donde sea posible; `next/image`; TanStack Query solo para datos interactivos.
- **No** añadir Redis ni colas sin evidencia; para eventos externos evaluar outbox/reintentos después.
- No inventar estimaciones de costo: citar límites oficiales vigentes de Vercel/Supabase o medir.
