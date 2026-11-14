import 'reflect-metadata';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

/**
 * Preregistra al PRIMER administrador (proceso manual controlado, ADR-0009).
 * No crea cuentas de Auth ni da acceso por sí solo: la persona queda vinculada en su primer inicio de
 * sesión con Google usando ese mismo correo. Idempotente.
 *
 * Uso (toma DIRECT_URL/DATABASE_URL de sushimon-api/.env): pnpm --filter sushimon-api staff:bootstrap -- --email persona@dominio.com --name "Nombre"
 * La URL se toma del entorno (nunca como argumento) para no dejarla en el historial del shell.
 */
try {
  process.loadEnvFile('.env'); // no pisa variables ya definidas; se ignora si no existe
} catch {
  /* sin .env */
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const email = arg('email')?.trim().toLowerCase();
const name = arg('name')?.trim();
const url = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'];
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || !url) {
  console.error('Uso: DATABASE_URL=… staff:bootstrap -- --email <correo> --name "<nombre>"');
  process.exit(2);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1 }) });
try {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  const staff = await prisma.staffUser.upsert({
    where: { email },
    create: { email, fullName: name },
    update: { active: true },
  });
  const existing = await prisma.staffAssignment.findFirst({
    where: { staffId: staff.id, roleId: role.id, branchId: null },
  });
  if (!existing) {
    await prisma.staffAssignment.create({ data: { staffId: staff.id, roleId: role.id } });
  }
  console.log(
    `Administrador preregistrado (${staff.authUserId ? 'ya vinculado' : 'se vinculará en su primer login con Google'}).`,
  );
} finally {
  await prisma.$disconnect();
}
