import type {
  AuthAdminProviderError,
  AuthAdminPort,
  MfaFactorRef,
} from '../../src/auth-admin/auth-admin.port.js';

/**
 * Las pruebas e2e reinician el registro de módulos (`vi.resetModules`) antes de importar la app: la clase de error se
 * resuelve en cada llamada para que `instanceof` coincida con la copia que usa el servicio.
 */
const unavailableError = async (): Promise<Error> => {
  const { AuthAdminUnavailableError } = await import('../../src/auth-admin/auth-admin.port.js');
  return new AuthAdminUnavailableError();
};

/** Doble en memoria del puerto de administración de identidad: sin red, sin Supabase. */
export class FakeAuthAdmin implements AuthAdminPort {
  /** authUserId -> ids de factores. */
  factors = new Map<string, string[]>();
  calls: string[] = [];
  /** Simula la indisponibilidad (sin clave de servicio). */
  unavailable = false;
  /** Falla (categoría fija) en la operación indicada; `afterDeletes` permite fallar tras N borrados correctos. */
  failList?: AuthAdminProviderError;
  failDelete?: { error: AuthAdminProviderError; afterDeletes: number };
  private deleted = 0;

  seed(authUserId: string, ...factorIds: string[]): void {
    this.factors.set(authUserId, [...factorIds]);
  }

  async listMfaFactors(authUserId: string): Promise<MfaFactorRef[]> {
    this.calls.push(`list:${authUserId}`);
    if (this.unavailable) throw await unavailableError();
    if (this.failList) throw this.failList;
    return (this.factors.get(authUserId) ?? []).map((id) => ({ id }));
  }

  async deleteMfaFactor(authUserId: string, factorId: string): Promise<void> {
    this.calls.push(`delete:${authUserId}:${factorId}`);
    if (this.unavailable) throw await unavailableError();
    if (this.failDelete && this.deleted >= this.failDelete.afterDeletes) {
      throw this.failDelete.error;
    }
    this.deleted += 1;
    this.factors.set(
      authUserId,
      (this.factors.get(authUserId) ?? []).filter((f) => f !== factorId),
    );
  }
}
