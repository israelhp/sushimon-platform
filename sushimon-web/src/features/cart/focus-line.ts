/**
 * Devuelve el foco a la fila de una línea del carrito (`data-line-id`) tras editarla en la ficha: si la configuración cambió, el
 * botón que abrió la ficha ya no existe y el foco se perdería en `body`. Reintenta una vez si la fila aún no se pintó.
 */
export function focusCartLine(lineId: string | null, attempts = 2): void {
  if (!lineId || typeof window === 'undefined') return;
  window.requestAnimationFrame(() => {
    // La misma línea puede pintarse dos veces (cajón y resumen del menú en escritorio): se prefiere la del diálogo abierto.
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-line-id]')).filter(
      (el) => el.dataset.lineId === lineId,
    );
    const row = rows.find((el) => el.closest('[aria-modal="true"]')) ?? rows[0];
    if (row) row.focus();
    else if (attempts > 1) focusCartLine(lineId, attempts - 1);
  });
}
