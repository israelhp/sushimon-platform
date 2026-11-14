/**
 * Puente entre el cliente HTTP (módulo, sin React) y la sesión de Supabase (proveedor React).
 * El proveedor de sesión instala las funciones al montar; con auth `mock` quedan inertes.
 */
export interface TokenSource {
  /** Access token vigente (renovado por Supabase si está por expirar) o null sin sesión. */
  getAccessToken: () => Promise<string | null>;
  /**
   * Se llama ante un 401 con token enviado. Devuelve true si la sesión se renovó y vale la pena
   * reintentar UNA vez; false si la sesión expiró (el proveedor ya la cerró y avisó a la UI).
   */
  onUnauthorized: () => Promise<boolean>;
}

const inert: TokenSource = {
  getAccessToken: () => Promise.resolve(null),
  onUnauthorized: () => Promise.resolve(false),
};

let current: TokenSource = inert;

export const tokenSource: TokenSource = {
  getAccessToken: () => current.getAccessToken(),
  onUnauthorized: () => current.onUnauthorized(),
};

export function installTokenSource(source: TokenSource): () => void {
  current = source;
  return () => {
    if (current === source) current = inert;
  };
}
