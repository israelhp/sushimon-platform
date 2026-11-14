import type {
  BranchAvailability,
  Category,
  Order,
  Product,
  PromotionInput,
  ReportGroup,
  ReportSummary,
  StaffUser,
  StaffUserInput,
} from '@/lib/data-access/models';
import { STAFF_ROLES } from '@/lib/data-access/models';
import { permissionsFor, ROLE_PERMISSIONS } from '@/lib/permissions';
import { localMinutes } from '@/lib/time';
import { fail, isValidEmail, productView, promotionView, round2 } from '../domain';
import { clampRange } from '../factories/history';
import type { ProductRecord } from '../store';
import { isSale } from './backoffice';
import {
  body,
  now,
  oneOf,
  ordersForDay,
  requireStaff,
  scopedBranchIds,
  staffBranchIds,
  str,
  today,
  type Handler,
  type Req,
} from './shared';

const HM = /^\d{2}:\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PRICE = 100_000;
const MAX_NAME = 120;
const MAX_DESCRIPTION = 600;

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// ── Productos ─────────────────────────────────────────────────────────────────────────────

/** GET /v1/backoffice/products — todo el catálogo (incluye categorías ocultas). */
export const listBoProducts: Handler = (req): Product[] => {
  requireStaff(req);
  return req.store.products.map((p) => productView(p));
};

function parseAvailability(req: Req, value: unknown): BranchAvailability[] {
  if (!Array.isArray(value)) fail(400, 'availability inválido');
  const known = new Set(req.store.branches.map((b) => b.id));
  return value.map((a: Partial<BranchAvailability>) => {
    if (!a || !known.has(str(a.branchId)) || typeof a.available !== 'boolean') {
      fail(400, 'availability inválido');
    }
    return { branchId: str(a.branchId), available: a.available };
  });
}

function validateProduct(req: Req, p: ProductRecord) {
  if (!p.name.trim()) fail(400, 'Escribe el nombre del producto');
  if (p.name.length > MAX_NAME) fail(400, `El nombre admite hasta ${MAX_NAME} caracteres`);
  if (p.nameEn && p.nameEn.length > MAX_NAME)
    fail(400, `El nombre admite hasta ${MAX_NAME} caracteres`);
  if (p.description.length > MAX_DESCRIPTION || (p.descriptionEn?.length ?? 0) > MAX_DESCRIPTION) {
    fail(400, `La descripción admite hasta ${MAX_DESCRIPTION} caracteres`);
  }
  if (!(typeof p.price === 'number' && Number.isFinite(p.price) && p.price > 0)) {
    fail(400, 'Escribe un precio mayor a Q0.00');
  }
  if (p.price > MAX_PRICE) fail(400, `El precio no puede superar Q${MAX_PRICE}`);
  if (!req.store.categories.some((c) => c.id === p.categoryId && c.kind === 'products')) {
    fail(422, 'Categoría inválida');
  }
}

/** POST /v1/backoffice/products (admin) */
export const createProduct: Handler = (req): Product => {
  requireStaff(req, 'products.edit');
  const b = body<Product>(req);
  const id = slug(str(b.name)) || `producto-${req.store.sequences.product}`;
  const record: ProductRecord = {
    id: req.store.products.some((p) => p.id === id) ? `${id}-${req.store.sequences.product}` : id,
    name: str(b.name).trim(),
    nameEn: b.nameEn ? str(b.nameEn).trim() : undefined,
    description: str(b.description).trim(),
    descriptionEn: b.descriptionEn ? str(b.descriptionEn).trim() : undefined,
    price: round2(Number(b.price)),
    categoryId: str(b.categoryId),
    illustration: str(b.illustration) || 'roll',
    featured: b.featured === true,
    food: b.food !== false,
    availability:
      b.availability !== undefined
        ? parseAvailability(req, b.availability)
        : req.store.branches
            .filter((x) => x.status === 'active')
            .map((x) => ({ branchId: x.id, available: true })),
  };
  validateProduct(req, record);
  req.store.sequences.product++;
  req.store.products.push(record);
  return productView(record);
};

/**
 * PATCH /v1/backoffice/products/:id
 * - Solo `availability` → permiso products.availability (encargado: solo su sucursal).
 * - Cualquier otro campo → products.edit (admin).
 */
export const updateProduct: Handler = (req): Product => {
  const b = body<Product>(req);
  const keys = Object.keys(b);
  const onlyAvailability = keys.length > 0 && keys.every((k) => k === 'availability');
  const user = requireStaff(req, onlyAvailability ? 'products.availability' : 'products.edit');
  const index = req.store.products.findIndex((p) => p.id === req.params.id);
  const current = req.store.products[index];
  if (!current) fail(404, 'Producto no encontrado');
  const next: ProductRecord = { ...current };
  if (b.availability !== undefined) {
    const incoming = parseAvailability(req, b.availability);
    const allowed = new Set(staffBranchIds(req.store, user));
    for (const a of incoming) {
      const prev = current.availability.find((x) => x.branchId === a.branchId);
      if (prev?.available !== a.available && !allowed.has(a.branchId)) {
        fail(403, 'Sin acceso a esa sucursal');
      }
    }
    next.availability = current.availability.map(
      (a) => incoming.find((x) => x.branchId === a.branchId) ?? a,
    );
  }
  if (b.name !== undefined) next.name = str(b.name).trim();
  if (b.nameEn !== undefined) next.nameEn = str(b.nameEn).trim();
  if (b.description !== undefined) next.description = str(b.description).trim();
  if (b.descriptionEn !== undefined) next.descriptionEn = str(b.descriptionEn).trim();
  if (b.price !== undefined) next.price = round2(Number(b.price));
  if (b.categoryId !== undefined) next.categoryId = str(b.categoryId);
  if (b.illustration !== undefined) next.illustration = str(b.illustration);
  if (b.featured !== undefined) next.featured = b.featured === true;
  if (b.food !== undefined) next.food = b.food === true;
  validateProduct(req, next);
  req.store.products[index] = next;
  return productView(next);
};

// ── Categorías ────────────────────────────────────────────────────────────────────────────

/** GET /v1/backoffice/categories — todas, por orden. */
export const listBoCategories: Handler = (req): Category[] => {
  requireStaff(req);
  return [...req.store.categories].sort((a, b) => a.sortOrder - b.sortOrder);
};

/** POST /v1/backoffice/categories (admin) */
export const createCategory: Handler = (req): Category => {
  requireStaff(req, 'products.edit');
  const b = body<Category>(req);
  if (!str(b.name).trim()) fail(400, 'Escribe el nombre de la categoría');
  const base = slug(str(b.name)) || `categoria-${req.store.sequences.category}`;
  const category: Category = {
    id: req.store.categories.some((c) => c.id === base)
      ? `${base}-${req.store.sequences.category}`
      : base,
    name: str(b.name).trim(),
    nameEn: b.nameEn ? str(b.nameEn).trim() : undefined,
    sortOrder:
      typeof b.sortOrder === 'number'
        ? b.sortOrder
        : Math.max(0, ...req.store.categories.map((c) => c.sortOrder)) + 1,
    visible: b.visible !== false,
    kind: 'products',
    illustration: b.illustration ? str(b.illustration) : undefined,
    jpLabel: b.jpLabel ? str(b.jpLabel) : undefined,
  };
  req.store.sequences.category++;
  req.store.categories.push(category);
  return category;
};

/** PATCH /v1/backoffice/categories/:id — nombre, orden, visibilidad. */
export const updateCategory: Handler = (req): Category => {
  requireStaff(req, 'products.edit');
  const b = body<Category>(req);
  const index = req.store.categories.findIndex((c) => c.id === req.params.id);
  const current = req.store.categories[index];
  if (!current) fail(404, 'Categoría no encontrada');
  const next: Category = { ...current };
  if (b.name !== undefined) {
    if (!str(b.name).trim()) fail(400, 'Escribe el nombre de la categoría');
    next.name = str(b.name).trim();
  }
  if (b.nameEn !== undefined) next.nameEn = str(b.nameEn).trim();
  if (b.sortOrder !== undefined) {
    if (!Number.isInteger(b.sortOrder)) fail(400, 'Orden inválido');
    next.sortOrder = b.sortOrder;
  }
  if (b.visible !== undefined) next.visible = b.visible === true;
  req.store.categories[index] = next;
  return next;
};

// ── Promociones ───────────────────────────────────────────────────────────────────────────

function parsePromotion(input: Partial<PromotionInput>) {
  if (!str(input.name).trim()) fail(400, 'Escribe el nombre de la promoción');
  const kind = oneOf(input.kind, ['2x1', 'percent', 'fixed_price'] as const, 'kind');
  const value = Number(input.value ?? 0);
  if (str(input.name).length > MAX_NAME) fail(400, `El nombre admite hasta ${MAX_NAME} caracteres`);
  if (str(input.description).length > MAX_DESCRIPTION) {
    fail(400, `La descripción admite hasta ${MAX_DESCRIPTION} caracteres`);
  }
  if (kind !== '2x1' && !(Number.isFinite(value) && value > 0)) {
    fail(400, 'Indica el descuento o precio especial');
  }
  if (kind === 'percent' && value > 100) fail(400, 'El porcentaje no puede superar 100');
  if (kind === 'fixed_price' && value > MAX_PRICE) {
    fail(400, `El precio especial no puede superar Q${MAX_PRICE}`);
  }
  const days = input.daysOfWeek;
  if (!Array.isArray(days) || days.length === 0) fail(400, 'Elige al menos un día');
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) fail(400, 'Día inválido');
  const startTime = str(input.startTime);
  const endTime = str(input.endTime);
  if (!HM.test(startTime) || !HM.test(endTime) || startTime >= endTime) {
    fail(400, 'Horario inválido');
  }
  const validFrom = str(input.validFrom);
  const validTo = str(input.validTo);
  if (!DATE_RE.test(validFrom) || !DATE_RE.test(validTo) || validFrom > validTo) {
    fail(400, 'Vigencia inválida');
  }
  const description =
    str(input.description).trim() ||
    (kind === 'percent'
      ? `${value} % de descuento.`
      : kind === 'fixed_price'
        ? 'Precio especial.'
        : 'Lleva dos y paga uno.');
  return {
    name: str(input.name).trim(),
    description,
    kind,
    value: kind === '2x1' ? 0 : value,
    daysOfWeek: [...new Set(days)].sort(),
    startTime,
    endTime,
    validFrom,
    validTo,
    active: input.active !== false,
  };
}

/** GET /v1/backoffice/promotions */
export const listBoPromotions: Handler = (req) => {
  requireStaff(req, 'promotions');
  return req.store.promotions.map((p) => promotionView(p, now(req)));
};

/** POST /v1/backoffice/promotions */
export const createPromotion: Handler = (req) => {
  requireStaff(req, 'promotions');
  const data = parsePromotion(body<PromotionInput>(req));
  const promo = {
    ...data,
    id: `promo-${req.store.sequences.promotion++}`,
    dineInOnly: false,
    items: [],
  };
  req.store.promotions.push(promo);
  return promotionView(promo, now(req));
};

/** PATCH /v1/backoffice/promotions/:id (campos parciales; p. ej. { active }) */
export const updatePromotion: Handler = (req) => {
  requireStaff(req, 'promotions');
  const index = req.store.promotions.findIndex((p) => p.id === req.params.id);
  const current = req.store.promotions[index];
  if (!current) fail(404, 'Promoción no encontrada');
  const data = parsePromotion({ ...current, ...body<PromotionInput>(req) });
  const next = { ...current, ...data };
  req.store.promotions[index] = next;
  return promotionView(next, now(req));
};

// ── Usuarios internos ─────────────────────────────────────────────────────────────────────

function parseUser(req: Req, input: Partial<StaffUserInput>, selfId?: string) {
  const name = str(input.name).trim();
  const email = str(input.email).trim().toLowerCase();
  if (!name || !isValidEmail(email)) fail(400, 'Completa el nombre y un correo válido');
  const role = oneOf(input.role, STAFF_ROLES, 'role');
  let branchId: string | null = null;
  if (role !== 'admin') {
    branchId = str(input.branchId);
    if (!req.store.branches.some((b) => b.id === branchId && b.status === 'active')) {
      fail(422, 'Elige una sucursal activa');
    }
  }
  if (req.store.staff.some((u) => u.email === email && u.id !== selfId)) {
    fail(409, 'Ya existe un usuario con ese correo');
  }
  const known: readonly string[] = ROLE_PERMISSIONS.admin;
  if (
    input.permissions !== undefined &&
    (!Array.isArray(input.permissions) ||
      input.permissions.some((p) => typeof p !== 'string' || !known.includes(p)))
  ) {
    fail(400, 'Permisos inválidos');
  }
  const permissions =
    input.permissions === undefined ? permissionsFor(role) : [...new Set(input.permissions)];
  return { name, email, role, branchId, permissions };
}

/** GET /v1/backoffice/users (admin) */
export const listUsers: Handler = (req): StaffUser[] => {
  requireStaff(req, 'users');
  return req.store.staff;
};

/** POST /v1/backoffice/users (admin) — en la API real enviaría la invitación por correo. */
export const createUser: Handler = (req): StaffUser => {
  requireStaff(req, 'users');
  const data = parseUser(req, body<StaffUserInput>(req));
  const user: StaffUser = { id: `u${req.store.sequences.user++}`, active: true, ...data };
  req.store.staff.push(user);
  return user;
};

/** PATCH /v1/backoffice/users/:id (admin) */
export const updateUser: Handler = (req): StaffUser => {
  const me = requireStaff(req, 'users');
  const index = req.store.staff.findIndex((u) => u.id === req.params.id);
  const current = req.store.staff[index];
  if (!current) fail(404, 'Usuario no encontrado');
  const b = body<StaffUserInput>(req);
  const data = parseUser(req, { ...current, ...b }, current.id);
  const active = b.active === undefined ? current.active : b.active === true;
  if (current.id === me.id && (!active || data.role !== 'admin')) {
    fail(409, 'No puedes desactivarte ni quitarte el rol de administrador');
  }
  const next: StaffUser = { ...current, ...data, active };
  req.store.staff[index] = next;
  return next;
};

// ── Reportes ──────────────────────────────────────────────────────────────────────────────

function rangeParams(req: Req) {
  const from = req.query.get('from') || today(req);
  const to = req.query.get('to') || from;
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) fail(400, 'Fechas inválidas (YYYY-MM-DD)');
  return clampRange(from, to, today(req));
}

const sales = (orders: Order[]) => round2(orders.filter(isSale).reduce((s, o) => s + o.total, 0));

/** GET /v1/backoffice/reports/summary?from&to&branchId */
export const getReportSummary: Handler = (req): ReportSummary => {
  const user = requireStaff(req, 'reports');
  const branchIds = scopedBranchIds(req, user);
  const range = rangeParams(req);
  const perDay = range.days.map((d) => ({ day: d, orders: ordersForDay(req, d, branchIds) }));
  const all = perDay.flatMap((x) => x.orders);
  const byBranch = (orders: Order[]) =>
    branchIds.map((branchId) => {
      const mine = orders.filter((o) => o.branchId === branchId);
      return { branchId, orders: mine.length, sales: sales(mine) };
    });
  const group = (key: string, orders: Order[]): ReportGroup => ({
    key,
    orders: orders.length,
    sales: sales(orders),
    byBranch: byBranch(orders),
  });

  let unit: ReportSummary['unit'] = 'day';
  let groups: ReportGroup[];
  if (range.days.length === 1) {
    unit = 'hour';
    groups = Array.from({ length: 11 }, (_, i) => {
      const hour = 12 + i;
      const inHour = all.filter((o) => {
        const h = Math.min(22, Math.max(12, Math.floor(localMinutes(new Date(o.createdAt)) / 60)));
        return h === hour;
      });
      return group(String(hour), inHour);
    });
  } else {
    groups = perDay.map((x) => group(x.day, x.orders));
  }

  const qty = new Map<string, { name: string; quantity: number }>();
  for (const o of all) {
    if (o.status === 'rejected' || o.status === 'cancelled') continue;
    for (const l of o.lines) {
      const cur = qty.get(l.productId) ?? { name: l.name, quantity: 0 };
      cur.quantity += l.quantity;
      qty.set(l.productId, cur);
    }
  }
  const cancelled = all.filter((o) => o.status === 'rejected' || o.status === 'cancelled').length;
  const totalSales = sales(all);
  const ok = all.length - cancelled;
  return {
    from: range.from,
    to: range.to,
    branchId: branchIds.length === 1 ? (branchIds[0] ?? null) : null,
    unit,
    clipped: range.clipped,
    minDate: range.min,
    groups,
    byBranch: byBranch(all),
    topProducts: [...qty.entries()]
      .map(([productId, v]) => ({ productId, ...v }))
      .sort((a, b) => b.quantity - a.quantity || a.productId.localeCompare(b.productId))
      .slice(0, 6),
    orders: all.length,
    cancelled,
    sales: totalSales,
    averageTicket: ok ? round2(totalSales / ok) : 0,
    deliveryOrders: all.filter((o) => o.fulfillment === 'delivery').length,
  };
};

/** GET /v1/backoffice/reports/history?from&to&branchId — pedidos del rango (más recientes primero). */
export const getReportHistory: Handler = (req): Order[] => {
  const user = requireStaff(req, 'reports');
  const branchIds = scopedBranchIds(req, user);
  const range = rangeParams(req);
  return range.days
    .flatMap((d) => ordersForDay(req, d, branchIds))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};
