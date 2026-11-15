/**
 * Reglas del perfil comercial del cliente (F04). Funciones puras: sin Nest, sin base de datos.
 * Invariantes: el nombre se normaliza antes de persistir; el teléfono se guarda en E.164 (+502 para Guatemala).
 */

export const FULL_NAME_MIN = 2;
export const FULL_NAME_MAX = 120;
export const PHONE_MAX_INPUT = 20;

/** Letras (incluidas tildes y ñ), marcas combinantes, espacios, apóstrofos, guiones y puntos. */
const NAME_CHARS = /^[\p{L}\p{M}'’.\- ]+$/u;
const HAS_LETTER = /\p{L}/u;

export type PolicyError = { field: 'fullName' | 'phone'; message: string };

export type NormalizeResult<T> = { ok: true; value: T } | { ok: false; error: PolicyError };

/** Recorta, colapsa espacios internos y elimina caracteres de control. Valida longitud y caracteres permitidos. */
export function normalizeFullName(raw: string): NormalizeResult<string> {
  const value = raw
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const length = [...value].length;
  if (length < FULL_NAME_MIN || length > FULL_NAME_MAX) {
    return {
      ok: false,
      error: {
        field: 'fullName',
        message: `fullName: debe tener entre ${FULL_NAME_MIN} y ${FULL_NAME_MAX} caracteres`,
      },
    };
  }
  if (!NAME_CHARS.test(value) || !HAS_LETTER.test(value)) {
    return {
      ok: false,
      error: { field: 'fullName', message: 'fullName: contiene caracteres no permitidos' },
    };
  }
  return { ok: true, value };
}

/**
 * Normaliza un teléfono. Vacío o null = sin teléfono (`null`).
 * - Guatemala: 8 dígitos locales, opcionalmente con `502` o `+502` → `+502XXXXXXXX`.
 * - Internacional: `+` seguido de 8 a 15 dígitos → E.164 sin separadores.
 * Se ignoran espacios, guiones, puntos y paréntesis. No se asume prefijo local (2–7) para no rechazar números válidos.
 */
export function normalizePhone(raw: string | null): NormalizeResult<string | null> {
  if (raw === null) return { ok: true, value: null };
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: null };
  const compact = trimmed.replace(/[\s\-().]/g, '');
  if (compact.length > PHONE_MAX_INPUT) return invalidPhone();

  const gt = /^(?:\+?502)?(\d{8})$/.exec(compact);
  if (gt) return { ok: true, value: `+502${gt[1]}` };

  // Código de Guatemala con longitud incorrecta: no se acepta como internacional.
  if (/^\+502/.test(compact)) return invalidPhone();

  const intl = /^\+([1-9]\d{7,14})$/.exec(compact);
  if (intl) return { ok: true, value: `+${intl[1]}` };

  return invalidPhone();
}

function invalidPhone(): NormalizeResult<never> {
  return {
    ok: false,
    error: {
      field: 'phone',
      message:
        'phone: formato inválido (Guatemala: 8 dígitos; internacional: +código y 8 a 15 dígitos)',
    },
  };
}

/** Campos que el PATCH de perfil puede modificar. Lo omitido (undefined) no cambia. */
export interface ProfilePatchInput {
  fullName?: string;
  phone?: string | null;
}

export interface ProfilePatch {
  fullName?: string;
  phone?: string | null;
}

/**
 * Normaliza un PATCH parcial. Devuelve solo los campos presentes (nunca inventa valores para los omitidos)
 * o la lista de errores de validación.
 */
export function buildProfilePatch(
  input: ProfilePatchInput,
): { ok: true; patch: ProfilePatch } | { ok: false; errors: string[] } {
  const patch: ProfilePatch = {};
  const errors: string[] = [];
  if (input.fullName !== undefined) {
    const name = normalizeFullName(input.fullName);
    if (name.ok) patch.fullName = name.value;
    else errors.push(name.error.message);
  }
  if (input.phone !== undefined) {
    const phone = normalizePhone(input.phone);
    if (phone.ok) patch.phone = phone.value;
    else errors.push(phone.error.message);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, patch };
}

/**
 * Nombre inicial sugerido por Google (solo para crear el perfil). Nunca sobrescribe un nombre guardado.
 * Devuelve null si el dato no es utilizable (el servicio usa el respaldo del correo).
 */
export function suggestedFullName(displayName: string | null): string | null {
  if (!displayName) return null;
  const result = normalizeFullName(displayName);
  return result.ok ? result.value : null;
}

const AVATAR_HOSTS = new Set(['lh3.googleusercontent.com']);

/**
 * Imagen de perfil de la identidad: solo https y dominio de Google conocido. Cualquier otra URL se descarta
 * (no permitimos que un `user_metadata` arbitrario haga peticiones a terceros).
 */
export function safeAvatarUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !AVATAR_HOSTS.has(url.hostname)) return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
