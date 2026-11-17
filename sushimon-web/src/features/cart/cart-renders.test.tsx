import { act, fireEvent, screen } from '@testing-library/react';
import { Profiler, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { ProductCard } from '@/features/catalog/components/product-card';
import { useProducts } from '@/features/catalog/hooks';
import { MobileNav } from '@/features/store-shell/components/MobileNav';
import { cartInput } from '@/test/cart';
import { renderStore } from '@/test/store-providers';
import { vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/menu',
  useRouter: () => ({ push: vi.fn() }),
}));

/** Cuenta cuántas veces se CONFIRMÓ (commit) un render dentro del subárbol. */
const counts: Record<string, number> = {};

function Counted({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Profiler
      id={id}
      onRender={() => {
        counts[id] = (counts[id] ?? 0) + 1;
      }}
    >
      {children}
    </Profiler>
  );
}

function Cards() {
  const products = useProducts();
  const catalog = products.data ?? [];
  const find = (id: string) => catalog.find((p) => p.id === id);
  const a = find('dumplings');
  const b = find('california-roll');
  if (!a || !b) return null;
  return (
    <>
      <Counted id="dumplings">
        <ProductCard product={a} catalog={catalog} variant="row" />
      </Counted>
      <Counted id="california">
        <ProductCard product={b} catalog={catalog} variant="row" />
      </Counted>
    </>
  );
}

describe('rendimiento del carrito: selectores y contexto de acciones estable (P1)', () => {
  it('«+» en una tarjeta repinta SOLO esa tarjeta y el encabezado; la ajena no se re-renderiza', async () => {
    for (const key of Object.keys(counts)) delete counts[key];
    const view = await renderStore(
      <>
        <Counted id="header">
          <MobileNav />
        </Counted>
        <Cards />
      </>,
      { branchId: 'sucursal-1' },
    );
    await act(async () => {
      view.api().cart.add(cartInput('dumplings', 1));
      view.api().cart.add(cartInput('california-roll', 1));
    });
    await screen.findByRole('button', { name: 'Agregar uno de Dumplings' });
    const before = { ...counts };

    fireEvent.click(screen.getByRole('button', { name: 'Agregar uno de Dumplings' }));
    expect(view.api().cart.quantityOf('dumplings')).toBe(2);
    expect(counts['dumplings']).toBeGreaterThan(before['dumplings']!); // la suya cambió
    expect(counts['header']).toBeGreaterThan(before['header']!); // el contador cambió
    expect(counts['california']).toBe(before['california']); // la ajena NO se re-renderiza
  });

  it('un ajuste de presentación (precio/nombre) no cambia el contador: encabezado y tarjetas no se repintan', async () => {
    for (const key of Object.keys(counts)) delete counts[key];
    const view = await renderStore(
      <>
        <Counted id="header">
          <MobileNav />
        </Counted>
        <Cards />
      </>,
      { branchId: 'sucursal-1' },
    );
    await act(async () => view.api().cart.add(cartInput('dumplings', 2, '', { unitCents: 5000 })));
    await screen.findByRole('button', { name: 'Agregar uno de Dumplings' });
    const before = { ...counts };
    const line = view.api().cart.lines[0]!;
    await act(async () =>
      view
        .api()
        .cart.applyRevalidation([
          { lineId: line.lineId, unitCents: 5300, name: 'Dumplings', imageUrl: null, options: [] },
        ]),
    );
    expect(view.api().cart.lines[0]?.display.unitCents).toBe(5300);
    expect(counts['header']).toBe(before['header']);
    expect(counts['dumplings']).toBe(before['dumplings']);
    expect(counts['california']).toBe(before['california']);
  });
});
