import type { CheckoutQuote } from '@/lib/data-access/models';
import { sha256Hex } from './sha256';

/**
 * F20 — `quote.token` SIMULADO. La API real lo firma con HMAC (secreto de servidor); aquí es un valor opaco SIN firma
 * (`mockq.<base64url(json)>`) que solo lleva la «evidencia» de la cotización para que el mock de `POST /v1/orders` pueda
 * reproducir `QUOTE_CHANGED` / `QUOTE_EXPIRED` / `QUOTE_INVALID`. No es seguridad: es un doble de pruebas rotulado.
 */
export interface MockQuoteEvidence {
  /** Sujeto: correo de la cuenta de demostración o `guest`. */
  sub: string;
  inputHash: string;
  provider: string | null;
  subtotal: string;
  discountTotal: string;
  deliveryFee: string;
  total: string;
  linesHash: string;
  /** Vencimiento (ms epoch, reloj de la demo). */
  exp: number;
}

const PREFIX = 'mockq.';

const toBase64Url = (text: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const fromBase64Url = (value: string): string => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export const mintMockQuoteToken = (evidence: MockQuoteEvidence): string =>
  PREFIX + toBase64Url(JSON.stringify(evidence));

/** `null` si el token no es uno de los del mock o está malformado (=> `QUOTE_INVALID`). */
export function readMockQuoteToken(token: unknown): MockQuoteEvidence | null {
  if (typeof token !== 'string' || !token.startsWith(PREFIX)) return null;
  try {
    const e = JSON.parse(fromBase64Url(token.slice(PREFIX.length))) as Partial<MockQuoteEvidence>;
    const strings = [
      e.sub,
      e.inputHash,
      e.subtotal,
      e.discountTotal,
      e.deliveryFee,
      e.total,
      e.linesHash,
    ];
    if (strings.some((x) => typeof x !== 'string') || typeof e.exp !== 'number') return null;
    if (e.provider !== null && typeof e.provider !== 'string') return null;
    return e as MockQuoteEvidence;
  } catch {
    return null;
  }
}

/** Forma canónica estable (claves ordenadas) para huellas y comparaciones. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Entradas de la cotización que fijan la huella (las mismas que el cuerpo de `POST /v1/orders`). */
export interface QuoteInputShape {
  branchId: string;
  lines: {
    productId: string;
    quantity: number;
    selections: { groupId: string; optionId: string }[];
  }[];
  fulfillment: unknown;
  couponCode: string;
}

export const inputHashOf = (input: QuoteInputShape): string =>
  sha256Hex(
    stableStringify({
      b: input.branchId,
      l: input.lines.map((l) => ({
        p: l.productId,
        q: l.quantity,
        s: l.selections.map((s) => `${s.groupId}:${s.optionId}`).sort(),
      })),
      f: input.fulfillment,
      c: input.couponCode,
    }),
  );

/** Huella de las líneas efectivas (precio, extras, descuento, promoción): detecta cambios que dejan igual el total. */
export const linesHashOf = (lines: CheckoutQuote['lines']): string =>
  sha256Hex(
    lines
      .map((l) =>
        [l.productId, l.unitPrice, l.extrasPerUnit, l.discount, l.promotionId ?? ''].join('|'),
      )
      .join(';'),
  );
