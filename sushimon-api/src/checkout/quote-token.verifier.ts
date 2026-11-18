import { Inject, Injectable } from '@nestjs/common';
import type { Principal } from '../auth/auth.types.js';
import { CHECKOUT_QUOTE_SECRET_TOKEN } from './checkout-errors.js';
import {
  keyedHash,
  MIN_SECRET_LENGTH,
  subjectOf,
  verifyQuoteToken,
  type TokenVerification,
} from './quote-token.js';

/**
 * Acceso de F20 al secreto de la vigencia firmada SIN releer el entorno ni exponerlo (ADR-0026 D2). `CheckoutModule`
 * lo exporta; `OrdersModule` lo usa para verificar el token, el sujeto y la huella del cuerpo del pedido.
 */
@Injectable()
export class QuoteTokenVerifier {
  constructor(@Inject(CHECKOUT_QUOTE_SECRET_TOKEN) private readonly secret: string | undefined) {}

  /** ¿Hay un secreto utilizable (>= 32 caracteres)? Sin él F20 falla cerrado (503 `ORDERS_UNAVAILABLE`). */
  get configured(): boolean {
    return this.secret !== undefined && this.secret.length >= MIN_SECRET_LENGTH;
  }

  verify(token: string, nowMs: number): TokenVerification {
    return verifyQuoteToken(token, this.need(), nowMs);
  }

  /** Sujeto del actor (HMAC del `authUserId` o `guest`), comparable con `payload.sub`. */
  subjectOf(principal: Principal | undefined): string {
    return subjectOf(this.need(), principal?.authUserId ?? null);
  }

  /** HMAC (con separación de dominio `order-body`) del cuerpo canónico del pedido. */
  bodyHash(canonical: unknown): Buffer {
    return Buffer.from(
      keyedHash(this.need(), 'order-body', JSON.stringify(canonical)),
      'base64url',
    );
  }

  private need(): string {
    if (!this.configured) throw new Error('CHECKOUT_QUOTE_SECRET no configurado');
    return this.secret as string;
  }
}
