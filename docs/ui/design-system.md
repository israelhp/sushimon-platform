# Sistema de diseño (borrador extraído de los prototipos)

Estado: ✅ tokens por zona en `sushimon-web/src/styles/{store-tokens,backoffice}.css` (`[data-zone="store"|"bo"]`, claro/oscuro); componentes base en `src/components/ui` (página interna `/ui-kit`). Desviación intencional: en oscuro de la tienda el texto sobre botones rojos usa tinta oscura (`--onprimary`) para cumplir AA (blanco sobre #EF4444 = 3,76:1); en el backoffice, `--bo-muted` claro es #646b78 por el mismo motivo.
Los prototipos son **referencia**, no código a copiar.

## Tokens observados

| Token                   | Claro                        | Oscuro                       |
| ----------------------- | ---------------------------- | ---------------------------- |
| Fondo                   | `#FAF7F2`                    | `#0B0B0F`                    |
| Línea/borde             | `#E8E2D8` (fuerte `#D5CEC2`) | `#232C3F` (fuerte `#34405A`) |
| Texto atenuado          | `#6B7280`                    | `#9CA3AF`                    |
| Primario (rojo)         | `#DC2626`                    | `#EF4444`                    |
| Acento (ámbar)          | `#F59E0B`                    | `#FBBF24`                    |
| Éxito                   | `#15803D` / suave `#E3F3E8`  | `#4ADE80`                    |
| Superficies azul/marino | `#0F172A`, `#1F2937`         | `#162038`                    |

Tipografía: **Archivo Black** (títulos, números destacados) y **DM Sans** (cuerpo); la tienda también carga Dela Gothic One.
Ilustraciones de producto: SVG planos con trazo oscuro grueso (rollos, gyozas, sopa, bebida, postre) — estilo a replicar con recursos propios.

## Componentes a construir (reutilizables en ambas zonas)

Botón (primary/ghost/danger/sm/lg), pill de estado, tarjeta, tabla con cabecera, drawer de detalle, modal, switch
accesible (`role="switch"`), chips/tabs con contador, toolbar de búsqueda, KPI, banner informativo, estado vacío,
selector segmentado, indicador de progreso de pedido, insignia “Simulación”.

## Requisitos transversales

Contraste AA · foco visible · navegación por teclado · `prefers-reduced-motion` · mobile-first (el prototipo oculta
columnas en pantallas pequeñas) · tema persistido como preferencia (no como auth) · textos es/en fuera de componentes.
Pendiente: cargar fuentes con `next/font` (requiere red en build; decidir si se autoalojan) ❓.
