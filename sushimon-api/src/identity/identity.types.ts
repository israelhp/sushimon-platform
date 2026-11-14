export interface StaffAssignmentView {
  role: string;
  /** null = todas las sucursales. */
  branchId: string | null;
}

export interface BranchRef {
  id: string;
  name: string;
  code: string;
}

/** Alcance de UN permiso: global o las sucursales ACTIVAS donde se posee. */
export interface GrantScope {
  allBranches: boolean;
  branchIds: string[];
}

/** Permiso → alcance. Solo asignaciones activas de personal activo hacia sucursales activas (ADR-0010 d.2). */
export type Grants = Record<string, GrantScope>;

/**
 * Lo que el SERVIDOR sabe de un empleado activo: base de toda decisión de autorización. Se calcula en cada
 * solicitud (memoizado solo en `req`). `permissions`, `allBranches` y `branchIds` son la unión plana de todos
 * los roles: solo orientan a la UI y NUNCA autorizan; la autorización usa `grants` (vía AuthorizationService).
 */
export interface StaffContext {
  staffId: string;
  fullName: string;
  assignments: StaffAssignmentView[];
  grants: Grants;
  /**
   * Sucursales activas de las asignaciones acotadas con algún permiso. Con alcance global, `IdentityService.withAllBranches`
   * la completa con todas las activas (solo para los endpoints de contexto). Nunca autoriza.
   */
  branches: BranchRef[];
  /** @deprecated Unión plana: no autoriza. */
  permissions: string[];
  /** @deprecated Unión plana: no autoriza. */
  allBranches: boolean;
  /** @deprecated Unión plana: no autoriza. */
  branchIds: string[];
}
