import { Injectable } from '@nestjs/common';

/** Reloj inyectable: el servidor es la única fuente de tiempo (D11). Las pruebas lo sustituyen. */
export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol('CLOCK');

/** Zona horaria del negocio (de `BUSINESS_TIMEZONE`, default America/Guatemala). */
export const BUSINESS_TIMEZONE = Symbol('BUSINESS_TIMEZONE');

@Injectable()
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
