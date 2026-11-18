import { quoteFingerprint, type QuoteInputs } from '@/lib/checkout-quote';
import type { OrderCreateRequest, OrderPaymentPreference } from '@/lib/data-access/models';

/**
 * F20 (spec 021 §9, ADR-0026 D9) — Intento LÓGICO de pedido: la clave de idempotencia es estable mientras la intención del cliente
 * no cambie. Se guarda en `sessionStorage` (por pestaña) junto con la huella canónica de la entrada, así un reintento tras un
 * error de red, un 503 o una recarga reutiliza la MISMA clave (el servidor devuelve el mismo pedido) y un envío distinto usa otra.
 *
 *  - Se reutiliza ante reintento / error de red / respuesta ambigua / 503 / `IDEMPOTENCY_IN_PROGRESS`.
 *  - Se renueva solo si cambia la huella (entradas, contacto, dirección, notas, preferencia, cuenta), tras `QUOTE_CHANGED` aceptado,
 *    `QUOTE_EXPIRED`, `IDEMPOTENCY_KEY_REUSED` y tras el éxito.
 * La huella NO incluye el `quoteToken` (la clave sobrevive a un token renovado, igual que el `request_hash` del servidor).
 * La clave no es un secreto de autorización, pero tampoco se registra ni se envía a ningún sitio salvo la cabecera.
 */
export const ORDER_ATTEMPT_STORAGE_KEY = 'monsushi-order-attempt';

export interface OrderAttempt {
  key: string;
  /**
   * SHA-256 (hex) de `sal + huella`. La huella contiene datos personales (nombre, teléfono, correo, dirección, notas): en
   * `sessionStorage` solo se guarda este resumen con una sal aleatoria del intento, nunca la huella en claro.
   */
  fingerprintHash: string;
  salt: string;
}

/** Lo que el cliente decidió confirmar (sin importes ni token). */
export interface OrderIntent {
  /** Cuenta (`scope` de `useCustomerScope`) o `null` = invitado: cambiar de cuenta cambia la huella. */
  scope: string | null;
  quote: Pick<QuoteInputs, 'cart' | 'fulfillment' | 'couponCode'>;
  contact: { fullName: string; phone: string; email: string };
  /** Solo con dirección NUEVA (`municipalityId`); con dirección guardada va `null`. */
  deliveryAddress: { addressLine: string; referenceNote: string } | null;
  notes: string;
  preference: OrderPaymentPreference | null;
}

/** Huella canónica de la intención (la misma intención produce la misma cadena). */
export function intentFingerprint(intent: OrderIntent): string {
  return JSON.stringify([
    intent.scope ?? 'guest',
    quoteFingerprint({ ...intent.quote, couponCode: intent.quote.couponCode }),
    intent.contact.fullName.trim(),
    intent.contact.phone.replace(/\D/g, ''),
    intent.contact.email.trim().toLowerCase(),
    intent.deliveryAddress
      ? [intent.deliveryAddress.addressLine.trim(), intent.deliveryAddress.referenceNote.trim()]
      : null,
    intent.notes.trim(),
    intent.preference,
  ]);
}

/** Cuerpo de `POST /v1/orders`: la cotización aceptada + contacto/dirección/preferencia. NUNCA importes. */
export function buildOrderRequest(intent: OrderIntent, quoteToken: string): OrderCreateRequest {
  const email = intent.contact.email.trim();
  const notes = intent.notes.trim();
  return {
    cart: intent.quote.cart,
    fulfillment: intent.quote.fulfillment,
    ...(intent.quote.couponCode ? { couponCode: intent.quote.couponCode } : {}),
    quoteToken,
    contact: {
      fullName: intent.contact.fullName.trim(),
      phone: intent.contact.phone.trim(),
      ...(email ? { email } : {}),
    },
    ...(intent.deliveryAddress
      ? {
          deliveryAddress: {
            addressLine: intent.deliveryAddress.addressLine.trim().slice(0, 200),
            ...(intent.deliveryAddress.referenceNote.trim()
              ? { referenceNote: intent.deliveryAddress.referenceNote.trim() }
              : {}),
          },
        }
      : {}),
    ...(notes ? { notes: notes.slice(0, 280) } : {}),
    ...(intent.preference ? { paymentMethodPreference: intent.preference } : {}),
  };
}

// ── Almacenamiento (sessionStorage con respaldo en memoria) ────────────────────────────────────────

let memory: OrderAttempt | null = null;

function parse(raw: string | null): OrderAttempt | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<OrderAttempt>;
    return typeof v.key === 'string' &&
      v.key &&
      typeof v.fingerprintHash === 'string' &&
      typeof v.salt === 'string'
      ? { key: v.key, fingerprintHash: v.fingerprintHash, salt: v.salt }
      : null;
  } catch {
    return null;
  }
}

function read(): OrderAttempt | null {
  try {
    return parse(window.sessionStorage.getItem(ORDER_ATTEMPT_STORAGE_KEY)) ?? memory;
  } catch {
    return memory;
  }
}

function write(attempt: OrderAttempt) {
  memory = attempt;
  try {
    window.sessionStorage.setItem(ORDER_ATTEMPT_STORAGE_KEY, JSON.stringify(attempt));
  } catch {
    /* sin almacenamiento: la clave vive en memoria mientras la pestaña siga abierta */
  }
}

/** UUID v4 (cumple `^[A-Za-z0-9_-]{22,128}$`). */
export const newIdempotencyKey = (): string => crypto.randomUUID();

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Intento vigente para esta huella: reutiliza la clave si el resumen de la huella (con la sal guardada) coincide; si no, crea
 * una clave y una sal nuevas y las guarda. Solo se persiste el resumen, nunca la huella.
 */
export async function attemptFor(
  fingerprint: string,
  makeKey: () => string = newIdempotencyKey,
): Promise<OrderAttempt> {
  const current = read();
  if (current && (await sha256Hex(current.salt + fingerprint)) === current.fingerprintHash)
    return current;
  const salt = crypto.randomUUID();
  const next = { key: makeKey(), salt, fingerprintHash: await sha256Hex(salt + fingerprint) };
  write(next);
  return next;
}

/** Descarta el intento (éxito, `QUOTE_CHANGED`/`QUOTE_EXPIRED`/`IDEMPOTENCY_KEY_REUSED`, cierre de sesión, salida del checkout). */
export function clearAttempt() {
  memory = null;
  try {
    window.sessionStorage.removeItem(ORDER_ATTEMPT_STORAGE_KEY);
  } catch {
    /* nada que limpiar */
  }
}
