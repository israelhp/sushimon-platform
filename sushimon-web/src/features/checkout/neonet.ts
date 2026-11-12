/**
 * Lógica pura de la pasarela NeoNet SIMULADA (formato, validación y tarjetas de prueba).
 * SEGURIDAD: estos valores (PAN, CVV) solo se usan en el estado local del diálogo; nada se persiste,
 * registra ni se coloca en cachés. Integración real de NeoNet: pendiente de documentación y credenciales.
 */
export type TestScenario = 'approved' | 'declined' | 'pending';

export interface TestCard {
  number: string;
  brand: 'Visa' | 'Mastercard';
  scenario: TestScenario;
}

/** Tarjetas de prueba públicas de la simulación (las mismas que acepta el adaptador mock). */
export const TEST_CARDS: readonly TestCard[] = [
  { number: '4242424242424242', brand: 'Visa', scenario: 'approved' },
  { number: '5555555555554444', brand: 'Mastercard', scenario: 'approved' },
  { number: '4000000000000002', brand: 'Visa', scenario: 'declined' },
  { number: '4000000000000077', brand: 'Visa', scenario: 'pending' },
];

export const onlyDigits = (value: string) => value.replace(/\D/g, '');

/** "4242424242424242" → "4242 4242 4242 4242" (máximo 16 dígitos). */
export function formatCardNumber(value: string): string {
  return onlyDigits(value)
    .slice(0, 16)
    .replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** "1228" → "12/28". */
export function formatExpiry(value: string): string {
  const d = onlyDigits(value).slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
}

export const findTestCard = (number: string): TestCard | null =>
  TEST_CARDS.find((c) => c.number === onlyDigits(number)) ?? null;

export const lastFour = (number: string) => onlyDigits(number).slice(-4);

/** "•••• •••• •••• 4242" para mostrar; nunca el número completo. */
export function maskCardNumber(number: string): string {
  return `•••• •••• •••• ${lastFour(number).padStart(4, '•')}`;
}

/** MM/AA no vencida respecto de `now` (la hora del servidor/demo). */
export function isExpiryValid(expiry: string, now: Date): boolean {
  const m = /^(\d{2})\/(\d{2})$/.exec(expiry);
  if (!m) return false;
  const month = Number(m[1]);
  const year = 2000 + Number(m[2]);
  if (month < 1 || month > 12) return false;
  const y = now.getFullYear();
  return year > y || (year === y && month >= now.getMonth() + 1);
}

export interface CardForm {
  number: string;
  name: string;
  expiry: string;
  cvv: string;
}

export type CardErrorKey =
  | 'neonet.errNumber'
  | 'neonet.errTestOnly'
  | 'neonet.errName'
  | 'neonet.errExpiry'
  | 'neonet.errCvv';

export interface CardErrors {
  number?: CardErrorKey;
  name?: CardErrorKey;
  expiry?: CardErrorKey;
  cvv?: CardErrorKey;
}

export function validateCard(card: CardForm, now: Date): CardErrors {
  const errors: CardErrors = {};
  const number = onlyDigits(card.number);
  if (number.length !== 16) errors.number = 'neonet.errNumber';
  else if (!findTestCard(number)) errors.number = 'neonet.errTestOnly';
  if (card.name.trim().length < 3) errors.name = 'neonet.errName';
  if (!isExpiryValid(card.expiry, now)) errors.expiry = 'neonet.errExpiry';
  if (!/^\d{3,4}$/.test(card.cvv)) errors.cvv = 'neonet.errCvv';
  return errors;
}

/** Valores precargados del prototipo: la tarjeta de prueba aprobada (datos públicos de prueba). */
export const DEMO_CARD: CardForm = {
  number: '4242 4242 4242 4242',
  name: 'CLIENTE DEMO',
  expiry: '12/28',
  cvv: '123',
};

/** Estado vacío (se usa para limpiar los campos al cerrar o terminar). */
export const EMPTY_CARD: CardForm = { number: '', name: '', expiry: '', cvv: '' };
