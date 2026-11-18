import type { ExecutionContext } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  CHECKOUT_QUOTE_THROTTLE,
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
