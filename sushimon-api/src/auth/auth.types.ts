/** Identidad verificada a partir del JWT de Supabase Auth. Es AUTENTICACIÓN: no implica ningún permiso. */
export interface Principal {
  /** `auth.users.id` (claim `sub`). Mismo UUID para cliente y empleado. */
  authUserId: string;
  /** Correo en minúsculas, o null si el token no lo trae. */
  email: string | null;
  /** Proveedor de identidad (`app_metadata.provider`, controlado por el servidor de Auth). */
  provider: string | null;
  /**
   * true solo si ESTA sesión nació de un OAuth con Google (provider google + amr `oauth`).
   * Es la única base para vincular un empleado preregistrado por correo.
   */
  googleOAuth: boolean;
  /**
   * Nivel de aseguramiento de la sesión (claim `aal`, ya verificado con la firma). `aal2` SOLO si el claim lo
   * dice Y `amr` registra un segundo factor TOTP; cualquier otro valor/forma degrada a `aal1` (deny by default).
   */
  aal: 'aal1' | 'aal2';
  /** Nombre para mostrar (user_metadata es editable por el usuario: solo sirve de dato inicial). */
  displayName: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}
