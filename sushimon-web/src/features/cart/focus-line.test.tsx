import { afterEach, describe, expect, it } from 'vitest';
import { focusCartLine } from './focus-line';

afterEach(() => {
  document.body.innerHTML = '';
});

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe('focusCartLine (U4)', () => {
  it('prefiere la fila del diálogo abierto cuando la línea también está en el resumen del menú', async () => {
    document.body.innerHTML = `
      <aside><ul><li id="aside" tabindex="-1" data-line-id="l1_a"></li></ul></aside>
      <div role="dialog" aria-modal="true"><ul><li id="drawer" tabindex="-1" data-line-id="l1_a"></li></ul></div>`;
    focusCartLine('l1_a');
    await nextFrame();
    expect(document.activeElement?.id).toBe('drawer');
  });

  it('sin diálogo usa la fila existente y reintenta si aún no se pintó', async () => {
    focusCartLine('l1_late');
    await nextFrame();
    document.body.innerHTML = '<ul><li id="late" tabindex="-1" data-line-id="l1_late"></li></ul>';
    await nextFrame();
    expect(document.activeElement?.id).toBe('late');
  });

  it('un id nulo no hace nada', () => {
    expect(() => focusCartLine(null)).not.toThrow();
  });
});
