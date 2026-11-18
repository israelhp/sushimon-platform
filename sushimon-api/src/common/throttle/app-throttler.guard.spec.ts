import type { ExecutionContext } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  AppThrottlerGuard,
  CHECKOUT_QUOTE_THROTTLE,
  CREATE_ORDER_THROTTLE,
  ORDER_READ_THROTTLE,
  COUPON_ACTOR_THROTTLER,
  COUPON_THROTTLER,
  skipUnlessActorLimited,
  skipUnlessCouponLimited,
} from './app-throttler.guard.js';

@Throttle(CHECKOUT_QUOTE_THROTTLE)
class Limited {}
class Plain {}
const handler = (): void => undefined;
const ctx = (cls: new () => object, body: unknown) =>
  ({
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ body }) }),
  }) as unknown as ExecutionContext;

describe('throttlers de cupón y actor (F19)', () => {
  it('declara 60/min por IP y actor y 10/min por IP y 20/min por actor con cupón', () => {
    expect(CHECKOUT_QUOTE_THROTTLE).toEqual({
      default: { limit: 60, ttl: 60_000 },
      actor: { limit: 60, ttl: 60_000 },
      coupon: { limit: 10, ttl: 60_000 },
      couponActor: { limit: 20, ttl: 60_000 },
    });
  });

  it.each([COUPON_THROTTLER, COUPON_ACTOR_THROTTLER])(
    '%s solo cuenta en rutas que lo declaran Y con couponCode en el cuerpo',
    (name) => {
      const skip = skipUnlessCouponLimited(name);
      expect(skip(ctx(Limited, { couponCode: 'ABC' }))).toBe(false);
      expect(skip(ctx(Limited, {}))).toBe(true);
      expect(skip(ctx(Limited, { couponCode: '' }))).toBe(true);
      expect(skip(ctx(Limited, { couponCode: null }))).toBe(true);
      expect(skip(ctx(Limited, undefined))).toBe(true);
      expect(skip(ctx(Limited, 'texto'))).toBe(true);
      expect(skip(ctx(Plain, { couponCode: 'ABC' }))).toBe(true); // otra ruta: nunca
    },
  );

  it('el throttler por actor sigue limitado a las rutas que lo declaran', () => {
    expect(skipUnlessActorLimited(ctx(Limited, {}))).toBe(false);
    expect(skipUnlessActorLimited(ctx(Plain, {}))).toBe(true);
  });
});

describe('throttlers de pedidos (F20)', () => {
  it('crear: 10/min por IP y por actor; leer: 60/min por IP y 30/min por actor', () => {
    expect(CREATE_ORDER_THROTTLE).toEqual({
      default: { limit: 10, ttl: 60_000 },
      actor: { limit: 10, ttl: 60_000 },
    });
    expect(ORDER_READ_THROTTLE).toEqual({
      default: { limit: 60, ttl: 60_000 },
      actor: { limit: 30, ttl: 60_000 },
    });
  });

  describe('429 RATE_LIMITED siempre con Retry-After', () => {
    const guard = Object.create(AppThrottlerGuard.prototype) as {
      throwThrottlingException: (c: ExecutionContext, d: unknown) => Promise<void>;
    };
    const run = (headers: Record<string, string>, detail: object) => {
      const res = {
        setHeader: vi.fn((k: string, v: string) => (headers[k] = v)),
        getHeader: (k: string) => headers[k],
      };
      const context = {
        switchToHttp: () => ({ getResponse: () => res }),
      } as unknown as ExecutionContext;
      try {
        void guard.throwThrottlingException(context, detail);
      } catch (e) {
        return {
          error: e as { getStatus: () => number; getResponse: () => { code: string } },
          headers,
        };
      }
      return { error: null, headers };
    };

    it('añade Retry-After cuando solo existe el sufijo del throttler `actor`', () => {
      const out = run({ 'Retry-After-actor': '42' }, { timeToExpire: 42, timeToBlockExpire: 0 });
      expect(out.error?.getStatus()).toBe(429);
      expect(out.error?.getResponse().code).toBe('RATE_LIMITED');
      expect(out.headers['Retry-After']).toBe('42');
    });

    it('respeta el Retry-After que ya fijó el throttler por defecto y nunca baja de 1 s', () => {
      expect(run({ 'Retry-After': '7' }, { timeToExpire: 3 }).headers['Retry-After']).toBe('7');
      expect(run({}, { timeToExpire: 0, timeToBlockExpire: 0 }).headers['Retry-After']).toBe('1');
    });
  });
});
