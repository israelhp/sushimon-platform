import { DEMO_BASE_TIME } from '../../src/mocks/clock';

/**
 * Desfase (ms) entre la hora real y el reloj de la demo. Se calcula UNA vez por proceso para que el
 * navegador (`support/test.ts`) y los datos que siembran las pruebas (`demoNow()`) coincidan.
 */
export const DEMO_OFFSET_MS = Date.parse(DEMO_BASE_TIME) - Date.now();

/** «Ahora» tal como lo ve el navegador de las pruebas. */
export const demoNow = () => Date.now() + DEMO_OFFSET_MS;
