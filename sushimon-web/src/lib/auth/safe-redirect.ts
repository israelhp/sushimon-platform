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
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
