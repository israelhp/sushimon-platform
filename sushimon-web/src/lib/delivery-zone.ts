/**
 * Zonas propias de entrega (F09, spec 008 D6/D11/D19). Funciones puras compartidas por la UI (formularios del
 * backoffice, etiqueta «Zona N» de la tienda) y por el adaptador mock, que reproduce con ellas las reglas del
 * servidor. La API es la ÚNICA fuente de verdad: estas funciones solo anticipan sus reglas para dar mensajes
 * inmediatos y nunca deciden precio ni cobertura.
 */

/** Máximo de caracteres de la etiqueta TRAS normalizar (CHECK de BD, D6). */
export const ZONE_LABEL_MAX = 60;
/** Tope de la entrada cruda (solo protege el tamaño del payload). */
export const ZONE_LABEL_INPUT_MAX = 200;
/** Importe máximo de `baseFee` (tope técnico anti-error de captura). */
export const MONEY_MAX = '99999.99';

const CONTROL = /\p{Cc}/u;
const MARKS = /\p{M}/gu;

export type ZoneLabelResult =
  { ok: true; label: string | null } | { ok: false; reason: 'control' | 'tooLong' };

/**
 * Etiqueta legible normalizada (D6): NFC → cualquier espacio Unicode (tab, NBSP…) cuenta como espacio y las secuencias
 * se colapsan a UNO → recorte → vacío = `null` (cobertura general del municipio). Conserva mayúsculas y acentos.
 * Un carácter de control que no sea espacio, o más de 60 caracteres, es inválido.
 */
export function normalizeZoneLabel(raw: string | null | undefined): ZoneLabelResult {
  if (raw === null || raw === undefined) return { ok: true, label: null };
  const spaced = raw.normalize('NFC').replace(/\s+/gu, ' ');
  if (CONTROL.test(spaced)) return { ok: false, reason: 'control' };
  const label = spaced.trim();
  if (label === '') return { ok: true, label: null };
  if ([...label].length > ZONE_LABEL_MAX) return { ok: false, reason: 'tooLong' };
  return { ok: true, label };
}

/**
 * Clave de comparación (D6): etiqueta normalizada → NFD → minúsculas → sin marcas diacríticas. `''` para la cobertura
 * general. NO unifica ceros a la izquierda ni sinónimos: `Zona 4` ≠ `4` ≠ `04`. `null` si la etiqueta solo tiene marcas.
 */
export function zoneKeyOf(label: string | null): string | null {
  if (label === null) return '';
  const key = label.normalize('NFD').toLowerCase().replace(MARKS, '').normalize('NFC');
  return key.trim() === '' ? null : key;
}

/** Etiqueta de la zona numérica de la Ciudad de Guatemala. Es la MISMA que escribe el backoffice (D19): `Zona 10`. */
export const zoneLabelOf = (zone: number | string): string => `Zona ${Number(zone)}`;

/**
 * Etiqueta de zona que la tienda envía a `checkDeliveryCoverage`: `''`/blanco = sin zona (solo cobertura general).
 * Cualquier otro valor numérico del borrador de dirección (`'10'`) se convierte a `Zona 10`.
 */
export function coverageZoneOf(zone: string | null | undefined): string | null {
  const text = (zone ?? '').trim();
  if (!text) return null;
  return /^\d+$/.test(text) ? zoneLabelOf(text) : text;
}

/** `"15"` → `"15.00"`. Mismo patrón que el servidor: 0–2 decimales, hasta 5 enteros, sin signo ni ceros a la izquierda. */
export const MONEY_INPUT_PATTERN = /^(0|[1-9][0-9]{0,4})(\.[0-9]{1,2})?$/;

export function normalizeMoney(input: string): string | null {
  const text = input.trim();
  if (!MONEY_INPUT_PATTERN.test(text)) return null;
  const [whole = '0', frac = ''] = text.split('.');
  return `${whole}.${frac.padEnd(2, '0')}`;
}

/** Compara dos importes decimales exactos (`"15.00"`) sin usar `number`. */
export function sameMoney(a: string, b: string): boolean {
  return (normalizeMoney(a) ?? a) === (normalizeMoney(b) ?? b);
}

/** Para MOSTRAR un importe del servidor (`"15.00"`) con el formato `Q15.00` sin pasar por `number` en datos. */
export function formatMoneyGtq(amount: string): string {
  const [whole = '0', frac = '00'] = amount.split('.');
  return `Q${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac.padEnd(2, '0').slice(0, 2)}`;
}
