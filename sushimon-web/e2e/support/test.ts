import { test as base, expect } from '@playwright/test';
import { DEMO_OFFSET_MS } from './demo-clock';

/**
 * `test` de Playwright con la fecha del navegador anclada al reloj de la demo.
 *
 * El mock emite las credenciales de los pedidos con el reloj de la demo (`DEMO_BASE_TIME` + 14 días),
 * pero la app las compara con `Date.now()`. Sin esto, cuando el calendario real supera esa vigencia el
 * seguimiento y el recibo muestran «Se perdió el acceso a este pedido». El tiempo sigue corriendo
 * (solo se desplaza `Date`), así que los temporizadores y las esperas no cambian.
 */
export const test = base.extend({
  context: async ({ context }, provide) => {
    await context.addInitScript((offset: number) => {
      const RealDate = Date;
      const shifted = () => RealDate.now() + offset;
      class ShiftedDate extends RealDate {
        constructor(...args: unknown[]) {
          if (args.length === 0) super(shifted());
          else super(...(args as ConstructorParameters<typeof RealDate>));
        }
        static now() {
          return shifted();
        }
      }
      globalThis.Date = ShiftedDate as unknown as DateConstructor;
    }, DEMO_OFFSET_MS);
    await provide(context);
  },
});

export { expect };
export type { Page } from '@playwright/test';
