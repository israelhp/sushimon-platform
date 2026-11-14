import 'reflect-metadata';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

/**
 * Preregistra al PRIMER administrador (proceso manual controlado, ADR-0009/0010, spec 006 D8).
 * No crea cuentas de Auth ni da acceso por sí solo: la persona queda vinculada en su primer inicio de
 * sesión con Google usando ese mismo correo.
 *
 * Requiere que la migración 0005 esté aplicada (el rol admin ya contiene el catálogo granular).
 *
 * Uso (DIRECT_URL/DATABASE_URL del entorno o de sushimon-api/.env; la URL nunca va como argumento):
 *   pnpm --filter sushimon-api staff:bootstrap -- --email <correo> --name "<nombre>" --yes --confirm-host=<host> [--allow-existing-admin]
 * El correo y el nombre también pueden venir de BOOTSTRAP_ADMIN_EMAIL / BOOTSTRAP_ADMIN_NAME. Jamás en código.
 *
 * Protecciones:
 *  - muestra host/puerto/base de destino (sin usuario ni contraseña) y exige --yes Y --confirm-host=<host> igual al host
 *    real del destino (evita ejecutarlo contra la base equivocada por un .env heredado);
 *  - los valores de los argumentos no pueden empezar por `--` (un flag olvidado no se consume como valor);
 *  - avisa explícitamente si promueve a administrador una fila YA vinculada a una cuenta;
 *  - si ya hay un administrador global activo y VINCULADO aborta (exit 3) salvo --allow-existing-admin;
 *  - idempotente: si el correo ya es administrador global activo no cambia ni audita (exit 0);
 *  - escribe `staff.bootstrapped` en audit_events en la MISMA transacción (actor NULL, sin correo).
 * Códigos de salida: 0 ok/sin cambios · 2 uso · 3 ya existe un administrador activo.
 */
try {
  process.loadEnvFile('.env'); // no pisa variables ya definidas; se ignora si no existe
} catch {
  /* sin .env */
}

/** Valor de `--name value` o `--name=value`; null = ausente; un valor que empieza por `--` es un error de uso. */
function arg(name: string): string | undefined {
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  const i = process.argv.indexOf(`--${name}`);
  const value = inline ? inline.slice(name.length + 3) : i > -1 ? process.argv[i + 1] : undefined;
  if (value !== undefined && value.startsWith('--')) {
    console.error(`Uso: el valor de --${name} no puede empezar por "--" (¿falta el valor?).`);
    process.exit(2);
  }
  return value;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

/** Destino legible SIN credenciales (usuario/contraseña/query se omiten). */
function describeTarget(connection: string): string {
  try {
    const u = new URL(connection);
    return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
  } catch {
    return '(URL no interpretable)';
  }
}

const confirmHost = arg('confirm-host');
function targetHostname(connection: string): string {
  try {
    return new URL(connection).hostname.toLowerCase();
  } catch {
    return '';
  }
}

const email = (arg('email') ?? process.env['BOOTSTRAP_ADMIN_EMAIL'])?.trim().toLowerCase();
const name = (arg('name') ?? process.env['BOOTSTRAP_ADMIN_NAME'])?.trim();
const url = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'];
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || !url) {
  console.error(
    'Uso: DATABASE_URL=… staff:bootstrap -- --email <correo> --name "<nombre>" --yes [--allow-existing-admin]',
  );
  process.exit(2);
}

console.log(`Base de datos de destino: ${describeTarget(url)}`);
if (!flag('yes')) {
  console.error(
    'Abortado: revisa el destino y repite con --yes --confirm-host=<host> (no se escribió nada).',
  );
  process.exit(2);
}
if (!confirmHost || confirmHost.toLowerCase() !== targetHostname(url)) {
  console.error(
    'Abortado: --confirm-host=<host> es obligatorio y debe ser IGUAL al host del destino mostrado (no se escribió nada).',
  );
  process.exit(2);
}
const allowExistingAdmin = flag('allow-existing-admin');

type Outcome = 'unchanged' | 'changed' | 'blocked';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1 }) });
try {
  const outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
    // Misma clave que el candado de «último administrador» de la API (ADR-0010 d.5).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('app:staff-admin-guard', 0))`;

    const role = await tx.role.findUniqueOrThrow({ where: { code: 'admin' } });
    const current = await tx.staffUser.findUnique({
      where: { email },
      include: { assignments: { where: { roleId: role.id, branchId: null } } },
    });
    const adminAssignment = current?.assignments[0];

    if (current?.active && adminAssignment?.active) return 'unchanged';

    const otherActiveLinkedAdmins = await tx.staffUser.count({
      where: {
        active: true,
        authUserId: { not: null },
        ...(current ? { id: { not: current.id } } : {}),
        assignments: { some: { active: true, branchId: null, roleId: role.id } },
      },
    });
    if (otherActiveLinkedAdmins > 0 && !allowExistingAdmin) return 'blocked';

    const reactivatedStaff = !!current && !current.active;
    const staff = current
      ? reactivatedStaff
        ? await tx.staffUser.update({ where: { id: current.id }, data: { active: true } })
        : current
      : await tx.staffUser.create({ data: { email, fullName: name } });

    let assignmentAction: 'created' | 'reactivated' | 'none' = 'none';
    if (!adminAssignment) {
      await tx.staffAssignment.create({ data: { staffId: staff.id, roleId: role.id } });
      assignmentAction = 'created';
    } else if (!adminAssignment.active) {
      await tx.staffAssignment.update({
        where: { id: adminAssignment.id },
        data: { active: true },
      });
      assignmentAction = 'reactivated';
    }

    if (current?.authUserId && !adminAssignment) {
      console.warn(
        'AVISO: se PROMUEVE a administrador global a un empleado YA VINCULADO a una cuenta (revisa que sea la persona correcta).',
      );
    }
    if (reactivatedStaff)
      console.warn('AVISO: la fila del empleado existía inactiva y se REACTIVA.');
    if (assignmentAction === 'reactivated')
      console.warn('AVISO: se reactiva una asignación admin existente.');

    await tx.auditEvent.create({
      data: {
        actorId: null,
        entityType: 'staff_user',
        entityId: staff.id,
        action: 'staff.bootstrapped',
        reason: allowExistingAdmin ? 'allow-existing-admin' : null,
        oldValues: current ? { active: current.active } : undefined,
        newValues: {
          active: true,
          adminAssignment: assignmentAction,
          created: !current,
          identityStatus: staff.authUserId ? 'LINKED' : 'PENDING_LINK',
        },
      },
    });
    return 'changed';
  });

  if (outcome === 'blocked') {
    console.error(
      'Abortado (exit 3): ya existe un administrador global activo y vinculado. Para recuperación usa --allow-existing-admin.',
    );
    process.exitCode = 3;
  } else if (outcome === 'unchanged') {
    console.log('Sin cambios: ese correo ya es administrador global activo.');
  } else {
    console.log('Administrador preregistrado; se vinculará en su primer login con Google.');
  }
} finally {
  await prisma.$disconnect();
}
