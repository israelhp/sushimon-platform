/**
 * Destino post-login seguro (anti open-redirect): solo rutas internas absolutas del mismo origen.
 * Rechaza `//host`, `/\host`, esquemas (`https:`, `javascript:`) y caracteres de control.
 */
export function safeNextPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw || raw.length > 300) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  try {
    const url = new URL(raw, 'http://internal.invalid');
    if (url.origin !== 'http://internal.invalid') return fallback;
    // La normalización puede producir `//host` (p. ej. `/..//evil`): se vuelve a validar el resultado.
    const out = `${url.pathname}${url.search}${url.hash}`;
    return out.startsWith('//') || out.startsWith('/\\') ? fallback : out;
  } catch {
    return fallback;
  }
}
