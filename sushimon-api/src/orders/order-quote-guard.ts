import { Inject, Injectable } from '@nestjs/common';
import type { Principal } from '../auth/auth.types.js';
import { CLOCK, type Clock } from '../branch-schedule/clock.js';
import {
  CheckoutQuoteService,
  type QuoteWithEvidence,
} from '../checkout/checkout-quote.service.js';
import type { CheckoutQuoteRequestDto } from '../checkout/dto/checkout-quote-request.dto.js';
import type { QuoteEvidence, QuoteTokenPayload } from '../checkout/quote-token.js';
import { QuoteTokenVerifier } from '../checkout/quote-token.verifier.js';
import {
  checkoutBlocked,
  deliveryProviderNotSelectable,
  ordersUnavailable,
  quoteChanged,
  quoteExpired,
  quoteInvalid,
  type QuoteChange,
} from './orders-errors.js';

export type OrderQuoteBody = Pick<CheckoutQuoteRequestDto, 'cart' | 'fulfillment' | 'couponCode'>;

/** Recotización aceptada: la evidencia ya está garantizada (no nula). */
export interface GuardedQuote extends QuoteWithEvidence {
  evidence: QuoteEvidence;
}

/**
 * Diferencias entre lo que el cliente aceptó (payload del token) y la recotización (P52: CUALQUIER diferencia, también
 * una mejora de precio). `linesHash` solo se compara si el token lo trae (tokens anteriores a F20 siguen válidos).
 */
export function diffQuote(accepted: QuoteTokenPayload, current: QuoteEvidence): QuoteChange[] {
  const changes: QuoteChange[] = [];
  if (accepted.provider !== current.provider) {
    changes.push({ field: 'provider', previous: accepted.provider, current: current.provider });
  }
  for (const field of ['subtotal', 'discountTotal', 'deliveryFee', 'total'] as const) {
    if (accepted[field] !== current[field]) {
      changes.push({ field, previous: accepted[field], current: current[field] });
    }
  }
  if (accepted.linesHash !== undefined && accepted.linesHash !== current.linesHash) {
    changes.push({ field: 'lines', previous: null, current: null });
  }
  return changes;
}

/**
 * Verificación y recotización del pedido (F20, spec 021 §3.5-§3.8, ADR-0026 D2). Orden: invariante PedidosYa de la
 * entrada -> token (firma, `sub`, vigencia) -> recotización con el MISMO `CheckoutQuoteService` -> invariante del
 * proveedor resultante -> `canProceed` -> huella de entrada -> comparación de importes y líneas. Sin efectos en BD.
 * La repetición idempotente (que se resuelve ANTES de llamar aquí) no pasa por este guard.
 */
@Injectable()
export class OrderQuoteGuard {
  constructor(
    @Inject(QuoteTokenVerifier) private readonly verifier: QuoteTokenVerifier,
    @Inject(CheckoutQuoteService) private readonly quotes: CheckoutQuoteService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async check(
    principal: Principal | undefined,
    body: OrderQuoteBody,
    quoteToken: string,
  ): Promise<GuardedQuote> {
    if (!this.verifier.configured) throw ordersUnavailable();
    if (
      body.fulfillment.deliveryProvider !== undefined &&
      body.fulfillment.deliveryProvider !== 'OWN'
    ) {
      throw deliveryProviderNotSelectable();
    }

    const verified = this.verifier.verify(quoteToken, this.clock.now().getTime());
    let accepted: QuoteTokenPayload | null = null;
    let expired = false;
    if (verified.ok) {
      // Un token de invitado no sirve con sesión ni a la inversa (la web recotiza al cambiar de cuenta).
      if (verified.payload.sub !== this.verifier.subjectOf(principal)) throw quoteInvalid();
      accepted = verified.payload;
    } else if (verified.reason === 'EXPIRED') {
      expired = true;
    } else {
      throw quoteInvalid();
    }

    const result = await this.quotes.quoteWithEvidence(principal, {
      cart: body.cart,
      fulfillment: body.fulfillment,
      ...(body.couponCode !== undefined ? { couponCode: body.couponCode } : {}),
    });
    if (expired) throw quoteExpired(result.quote);

    // Invariante propia de F20 (cinturón y tirantes): jamás se crea un pedido con un proveedor que no sea OWN.
    const resulting = result.quote.fulfillment.delivery?.selectedProvider ?? null;
    if (
      (resulting !== null && resulting !== 'OWN') ||
      (result.evidence?.provider ?? null) === 'PEDIDOSYA'
    ) {
      throw deliveryProviderNotSelectable();
    }
    if (!result.quote.canProceed) throw checkoutBlocked(result.quote.blockers);
    if (result.evidence === null || accepted === null) throw ordersUnavailable();
    if (result.evidence.provider !== null && result.evidence.provider !== 'OWN') {
      throw deliveryProviderNotSelectable();
    }

    // La entrada difiere de la cotizada (cuerpo manipulado o de otra cotización): inválido, no «cambió el precio».
    if (accepted.inputHash !== result.evidence.inputHash) throw quoteInvalid();
    const changes = diffQuote(accepted, result.evidence);
    if (changes.length > 0) throw quoteChanged(changes, result.quote);
    return { ...result, evidence: result.evidence };
  }
}
