import {
  AuthAdminUnavailableError,
  type AuthAdminPort,
  type MfaFactorRef,
} from './auth-admin.port.js';

/** Adaptador por defecto: sin `SUPABASE_SERVICE_ROLE_KEY` (o sin `SUPABASE_URL`) no hay red ni operaciones. */
export class UnavailableAuthAdminAdapter implements AuthAdminPort {
  listMfaFactors(): Promise<MfaFactorRef[]> {
    return Promise.reject(new AuthAdminUnavailableError());
  }

  deleteMfaFactor(): Promise<void> {
    return Promise.reject(new AuthAdminUnavailableError());
  }
}
