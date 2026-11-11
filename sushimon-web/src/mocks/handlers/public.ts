import type {
  Category,
  DeliveryQuote,
  JobApplication,
  JobApplicationRequest,
  OrderAddress,
  StoreConfig,
} from '@/lib/data-access/models';
import {
  assertAddress,
  bestBranchFor,
  branchView,
  fail,
  feeFor,
  isValidEmail,
  isValidPhone,
  productView,
  promotionView,
  tierFor,
} from '../domain';
import { hashSeed } from '../factories/random';
import { body, now, oneOf, str, type Handler, type Req } from './shared';

/** GET /v1/store/config */
export const getStoreConfig: Handler = (req): StoreConfig => ({
  ...req.store.config,
  serverTime: now(req).toISOString(),
});

/** GET /v1/branches — todas (activas y "próximamente"). */
export const listBranches: Handler = (req) =>
  req.store.branches.map((b) => branchView(b, now(req)));

function quoteFor(req: Req, address: OrderAddress, branchId?: string | null): DeliveryQuote {
  const createdAt = now(req).toISOString();
  const miss = (reason: 'not_covered' | 'branch_not_covered'): DeliveryQuote => ({
    covered: false,
    reason,
    quoteId: null,
    branchId: branchId ?? null,
    tier: null,
    fee: null,
    currency: 'GTQ',
    etaMinMinutes: null,
    etaMaxMinutes: null,
    simulated: true,
    createdAt,
  });
  let branch;
  let tier;
  if (branchId) {
    branch = req.store.branches.find((b) => b.id === branchId);
    if (!branch) fail(404, 'Sucursal no encontrada');
    tier = tierFor(branch, address.municipality, address.zone);
    if (!tier) return miss('branch_not_covered');
  } else {
    const best = bestBranchFor(req.store.branches, address.municipality, address.zone);
    if (!best) return miss('not_covered');
    ({ branch, tier } = best);
  }
  const t = feeFor(req.store, tier);
  return {
    covered: true,
    reason: null,
    quoteId: `EST-${hashSeed(`${branch.id}|${address.municipality}|${address.zone}`).toString(36).toUpperCase()}`,
    branchId: branch.id,
    tier,
    fee: t.fee,
    currency: 'GTQ',
    etaMinMinutes: t.etaMinMinutes,
    etaMaxMinutes: t.etaMaxMinutes,
    simulated: true,
    createdAt,
  };
}

/** Cotización interna reutilizada al crear pedidos. */
export { quoteFor };

/** GET /v1/delivery/quote?branchId&department&municipality&zone[&line] */
export const getDeliveryQuote: Handler = (req) => {
  const q = req.query;
  const address = assertAddress(req.store, {
    department: q.get('department') ?? '',
    municipality: q.get('municipality') ?? '',
    zone: q.get('zone') ?? '',
    // La cotización por zona no exige la línea de dirección.
    line: q.get('line') ?? 'cotización',
    references: '',
  });
  return quoteFor(req, address, q.get('branchId'));
};

/** GET /v1/catalog/categories — solo visibles, ordenadas. */
export const listCategories: Handler = (req): Category[] =>
  req.store.categories.filter((c) => c.visible).sort((a, b) => a.sortOrder - b.sortOrder);

/** GET /v1/catalog/products?branchId&categoryId */
export const listProducts: Handler = (req) => {
  const branchId = req.query.get('branchId') ?? undefined;
  const categoryId = req.query.get('categoryId');
  if (branchId && !req.store.branches.some((b) => b.id === branchId)) {
    fail(404, 'Sucursal no encontrada');
  }
  const visible = new Set(req.store.categories.filter((c) => c.visible).map((c) => c.id));
  return req.store.products
    .filter((p) => visible.has(p.categoryId))
    .filter((p) => !categoryId || p.categoryId === categoryId)
    .map((p) => productView(p, branchId));
};

/** GET /v1/promotions — activas (vigentes, programadas o vencidas: la UI muestra el estado). */
export const listPromotions: Handler = (req) =>
  req.store.promotions.filter((p) => p.active).map((p) => promotionView(p, now(req)));

const MAX_CV_BYTES = 5 * 1024 * 1024;

/** POST /v1/job-applications */
export const createJobApplication: Handler = (req): JobApplication => {
  const b = body<JobApplicationRequest>(req);
  if (str(b.name).trim().length < 3) fail(400, 'Escribe tu nombre completo');
  if (!isValidEmail(str(b.email))) fail(400, 'Correo inválido');
  if (!isValidPhone(str(b.phone))) fail(400, 'Teléfono inválido');
  if (!str(b.position).trim()) fail(400, 'Elige un puesto');
  const experience = oneOf(b.experience, ['none', 'lt1', 'y1to3', 'gt3'] as const, 'experience');
  if (b.consent !== true) fail(400, 'Se requiere consentimiento');
  if (!/\.pdf$/i.test(str(b.cvFileName))) fail(422, 'El CV debe ser un PDF');
  if (typeof b.cvSizeBytes !== 'number' || b.cvSizeBytes <= 0 || b.cvSizeBytes > MAX_CV_BYTES)
    fail(422, 'El PDF supera los 5 MB');
  const app: JobApplication = {
    id: `JOB-${String(req.store.sequences.job++).padStart(4, '0')}`,
    createdAt: now(req).toISOString(),
    status: 'received',
    name: str(b.name).trim(),
    email: str(b.email).trim(),
    phone: str(b.phone).trim(),
    position: str(b.position).trim(),
    experience,
    message: str(b.message).trim(),
    cvFileName: str(b.cvFileName),
  };
  req.store.jobApplications.push(app);
  return app;
};
