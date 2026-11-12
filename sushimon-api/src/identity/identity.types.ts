export interface StaffAssignmentView {
  role: string;
  /** null = todas las sucursales. */
  branchId: string | null;
}

/** Lo que el SERVIDOR sabe de un empleado activo: base de toda decisión de autorización. */
export interface StaffContext {
  staffId: string;
  fullName: string;
  assignments: StaffAssignmentView[];
  permissions: string[];
  allBranches: boolean;
  branchIds: string[];
}

/** ¿Puede esta identidad operar sobre la sucursal indicada? (alcance por sucursal) */
export function canAccessBranch(staff: StaffContext, branchId: string): boolean {
  return staff.allBranches || staff.branchIds.includes(branchId);
}
