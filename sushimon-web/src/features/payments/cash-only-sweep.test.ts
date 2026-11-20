import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * F24 (spec 025 §13 #6): barrido automatizado. La web NO conserva ninguna rama de transferencia bancaria ni de tarjeta/Neonet en el
 * checkout, los mocks, los textos ni los tipos (las pruebas negativas sí pueden nombrarlos: se excluyen).
 */
const SRC = join(__dirname, '../..');

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

const sources = [...walk(SRC)].filter(
  (f) => /\.(ts|tsx|json)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.endsWith('.d.ts'),
);

describe('F24 · solo efectivo', () => {
  it('ningún archivo de la web menciona bank_transfer ni conserva el diálogo/hook de Neonet', () => {
    const offenders = sources.filter(
      (f) =>
        /bank_transfer|neonet|payWithCard|usePayWithCard|\/v1\/payments\/card|cardPayment|TEST_CARDS|PAYMENT_METHOD_UNAVAILABLE|NOT_STARTED/i.test(
          readFileSync(f, 'utf8'),
        ) && !f.endsWith('promotion-rules.ts'),
    );
    // Los comentarios que explican el retiro (`bank_transfer` retirado) viven en mocks/admin-orders.ts y en el handler de pedidos.
    const allowed = ['mocks/admin-orders.ts', 'mocks/handlers/order-placement.ts'];
    // `i18n/messages.test` y el barrido mismo nombran los términos: son pruebas y ya están excluidas.
    expect(
      offenders.filter((f) => !allowed.some((a) => f.endsWith(a))).map((f) => f.replace(SRC, '')),
    ).toEqual([]);
  });

  it('el paso Pago y la revisión no importan íconos ni componentes de tarjeta o transferencia', () => {
    for (const rel of [
      'features/checkout/components/PaymentStep.tsx',
      'features/checkout/components/ReviewStep.tsx',
      'features/checkout/components/CheckoutFlow.tsx',
      'features/checkout/checkout-model.ts',
    ]) {
      const text = readFileSync(join(SRC, rel), 'utf8');
      expect(text, rel).not.toMatch(/CreditCard|Landmark|bank_transfer|NeoNet|'card'/);
    }
  });

  it('el contrato de la web solo conoce CASH / cash', () => {
    const models = readFileSync(join(SRC, 'lib/data-access/models.ts'), 'utf8');
    expect(models).not.toMatch(/bank_transfer/);
  });
});
