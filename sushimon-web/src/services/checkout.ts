import type { DataClient } from '@/lib/data-access/types';
import type { CheckoutQuote, CheckoutQuoteRequest } from '@/lib/data-access/models';
import { paths } from '@/lib/data-access/paths';

/**
 * F19 — Cotización de checkout (`quoteCheckout`, `POST /v1/checkout/quote`). El SERVIDOR calcula líneas, extras, descuentos,
 * tarifa y total; el cuerpo solo lleva ids, cantidades, modalidad, dirección (guardada o municipio+zona) y cupón. Es una
 * lectura PRIVADA (`private, no-store`, auth opcional): NUNCA `public: true` (con sesión viaja `Authorization`). Sin efectos:
 * no crea pedidos ni pagos. `signal` cancela la solicitud obsoleta.
 */
export const quoteCheckout = (
  client: DataClient,
  input: CheckoutQuoteRequest,
  signal?: AbortSignal,
) =>
  client.request<CheckoutQuote>(paths.checkoutQuote(), {
    method: 'POST',
    body: input,
    signal,
  });
