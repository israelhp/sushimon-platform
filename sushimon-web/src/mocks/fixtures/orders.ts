import type {
  DeliveryStatus,
  Incident,
  OrderAddress,
  DraftOrderStatus,
  PaymentMethod,
} from '@/lib/data-access/models';

/**
 * Pedidos sembrados. Se describen con datos mínimos; `seed.ts` calcula precios (catálogo canónico),
 * envío (cobertura de la sucursal), historial y pagos.
 *
 * MAPEO de productos del backoffice (18, p1…p18) al catálogo canónico de la tienda:
 *   p1 California Roll → california-roll      p10 Sashimi mixto → joselito-roll
 *   p2 Philadelphia Roll → salomon-roll       p11 Gyozas de cerdo → dumplings
 *   p3 Spicy Tuna Roll → dynamita-roll        p12 Edamame → poporopos-cangrejo
 *   p4 Tempura Roll → mulato-roll             p13 Tempura de camarón → loco-ribs
 *   p5 Dragon Roll → cayibel-roll             p14 Té verde → te-lipton
 *   p6 Acevichado Roll → acevichado-roll      p15 Limonada de jengibre → licuado-sandia
 *   p7 Volcano Roll → la-suegra-roll          p16 Ramune → gaseosas
 *   p8 Mon Roll → platanito-roll              p17 Mochi de matcha → helados-asiaticos
 *   p9 Nigiri de salmón → alaska-roll         p18 Helado tempura → licuado-melon
 * Sucursales: s1/s2/s3 → sucursal-1/2/3. Números: SM-70xx → MON-3070xx.
 * Direcciones de sucursal-3 que la cobertura canónica (de la tienda) no cubre (Zona 15/16,
 * Carretera a El Salvador) se reubicaron a zonas cubiertas (Zona 11, Zona 13, Mixco).
 */
export const BACKOFFICE_PRODUCT_MAP: Record<string, string> = {
  p1: 'california-roll',
  p2: 'salomon-roll',
  p3: 'dynamita-roll',
  p4: 'mulato-roll',
  p5: 'cayibel-roll',
  p6: 'acevichado-roll',
  p7: 'la-suegra-roll',
  p8: 'platanito-roll',
  p9: 'alaska-roll',
  p10: 'joselito-roll',
  p11: 'dumplings',
  p12: 'poporopos-cangrejo',
  p13: 'loco-ribs',
  p14: 'te-lipton',
  p15: 'licuado-sandia',
  p16: 'gaseosas',
  p17: 'helados-asiaticos',
  p18: 'licuado-melon',
};

export interface OrderLineSeed {
  productId: string;
  quantity: number;
  note?: string;
  /** Precio histórico distinto del actual (para el aviso de "repetir pedido"). */
  unitPrice?: number;
  /** Nombre si el producto ya no existe en el catálogo. */
  name?: string;
}

export interface DeliverySeed {
  provider: 'pedidosya' | 'own';
  status: DeliveryStatus;
  riderId?: string;
  riderName: string;
  reference: string;
  /** Horas locales `HH:mm` del día del pedido. */
  requestedAt: string;
  etaAt: string;
  deliveredAt?: string;
}

export interface OrderSeed {
  id: string;
  /** Minutos antes de la fecha base del reloj. */
  minutesAgo: number;
  branchId: string;
  fulfillment: 'pickup' | 'delivery';
  customer: { name: string; phone: string; email: string };
  address: OrderAddress | null;
  lines: OrderLineSeed[];
  note: string;
  status: DraftOrderStatus;
  rejectionReason?: string;
  payment: { method: PaymentMethod; reference?: string };
  /** Diferencia entre el costo del courier y el envío cobrado (shipNow − ship del prototipo). */
  courierSurcharge?: number;
  delivery?: DeliverySeed;
  incidents?: Omit<Incident, 'orderId'>[];
}

const gt = (zone: string, line: string, references = ''): OrderAddress => ({
  department: 'Guatemala',
  municipality: 'Guatemala',
  zone,
  line,
  references,
});

const L = (bo: string, quantity: number, note?: string): OrderLineSeed => {
  const productId = BACKOFFICE_PRODUCT_MAP[bo];
  if (!productId) throw new Error(`Producto sin mapear: ${bo}`);
  return note ? { productId, quantity, note } : { productId, quantity };
};

const email = (name: string) =>
  `${name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(' ')
    .slice(0, 2)
    .join('.')}@ejemplo.com`;

const c = (name: string, phone: string) => ({ name, phone, email: email(name) });

/** 15 pedidos "de hoy" del backoffice (SEED), a las 14:25 de la fecha base. */
export const BACKOFFICE_ORDER_SEEDS: OrderSeed[] = [
  {
    id: 'MON-307058',
    minutesAgo: 3,
    branchId: 'sucursal-2',
    fulfillment: 'delivery',
    customer: c('Andrea Morales', '+502 5521-3348'),
    address: gt('10', '12 calle 1-25, Zona 10, Edificio Géminis 10, apto. 804'),
    lines: [L('p1', 2), L('p11', 1, 'Sin cebollín')],
    note: 'Por favor tocar el timbre dos veces.',
    status: 'received',
    payment: { method: 'card' },
    courierSurcharge: 4.5,
  },
  {
    id: 'MON-307057',
    minutesAgo: 8,
    branchId: 'sucursal-1',
    fulfillment: 'pickup',
    customer: c('José Pablo Ruiz', '+502 4410-7782'),
    address: null,
    lines: [L('p5', 1), L('p12', 1), L('p14', 2)],
    note: '',
    status: 'received',
    payment: { method: 'cash' },
  },
  {
    id: 'MON-307056',
    minutesAgo: 10,
    branchId: 'sucursal-3',
    fulfillment: 'delivery',
    customer: c('María Fernanda López', '+502 5987-1203'),
    address: gt('11', 'Calzada Roosevelt 22-43, Zona 11, Condominio Arboleda, casa 7'),
    lines: [L('p8', 1), L('p3', 1)],
    note: '',
    status: 'accepted',
    payment: { method: 'card' },
  },
  {
    id: 'MON-307055',
    minutesAgo: 15,
    branchId: 'sucursal-1',
    fulfillment: 'pickup',
    customer: c('Diego Castillo', '+502 3021-5566'),
    address: null,
    lines: [L('p2', 2), L('p16', 2)],
    note: '',
    status: 'accepted',
    payment: { method: 'cash' },
  },
  {
    id: 'MON-307054',
    minutesAgo: 19,
    branchId: 'sucursal-2',
    fulfillment: 'delivery',
    customer: c('Lucía Herrera', '+502 5544-9021'),
    address: gt('9', '6a avenida 9-18, Zona 9'),
    lines: [L('p6', 1), L('p13', 1, 'Salsa aparte'), L('p15', 1)],
    note: '',
    status: 'preparing',
    payment: { method: 'card' },
  },
  {
    id: 'MON-307053',
    minutesAgo: 23,
    branchId: 'sucursal-1',
    fulfillment: 'pickup',
    customer: c('Carlos Méndez', '+502 4789-3310'),
    address: null,
    lines: [L('p10', 1), L('p9', 2)],
    note: 'Sin wasabi, por favor.',
    status: 'preparing',
    payment: { method: 'cash' },
  },
  {
    id: 'MON-307052',
    minutesAgo: 27,
    branchId: 'sucursal-3',
    fulfillment: 'delivery',
    customer: c('Gabriela Pineda', '+502 5612-0098'),
    address: {
      department: 'Guatemala',
      municipality: 'Mixco',
      zone: '',
      line: 'Calzada San Juan 8-50, Condominio Las Luces, casa 14',
      references: '',
    },
    lines: [L('p7', 2), L('p17', 1)],
    note: 'Garita: indicar que va a la casa 14.',
    status: 'ready',
    payment: { method: 'card' },
    courierSurcharge: 6,
  },
  {
    id: 'MON-307051',
    minutesAgo: 30,
    branchId: 'sucursal-1',
    fulfillment: 'delivery',
    customer: c('Rodrigo Estrada', '+502 3398-4471'),
    address: gt('9', 'Avenida Reforma 8-60, Zona 9'),
    lines: [L('p1', 1), L('p4', 1)],
    note: '',
    status: 'ready',
    payment: { method: 'cash' },
  },
  {
    id: 'MON-307050',
    minutesAgo: 33,
    branchId: 'sucursal-2',
    fulfillment: 'pickup',
    customer: c('Sofía Barrios', '+502 5120-6634'),
    address: null,
    lines: [L('p3', 1), L('p11', 1)],
    note: '',
    status: 'ready',
    payment: { method: 'card' },
  },
  {
    id: 'MON-307049',
    minutesAgo: 41,
    branchId: 'sucursal-2',
    fulfillment: 'delivery',
    customer: c('Javier Orellana', '+502 4002-8815'),
    address: gt('10', '4a avenida 15-70, Zona 10, Torre Paladium, nivel 12'),
    lines: [L('p8', 2), L('p14', 2)],
    note: 'Dejar en recepción.',
    status: 'on_the_way',
    payment: { method: 'card' },
    delivery: {
      provider: 'pedidosya',
      status: 'on_the_way',
      riderName: 'Kevin R. · moto',
      reference: 'PY-GT-7731942',
      requestedAt: '14:01',
      etaAt: '14:37',
    },
  },
  {
    id: 'MON-307048',
    minutesAgo: 45,
    branchId: 'sucursal-3',
    fulfillment: 'delivery',
    customer: c('Valeria Cifuentes', '+502 5876-2290'),
    address: gt('13', 'Colonia Aurora, 2a calle 23-80, Zona 13'),
    lines: [L('p5', 1), L('p6', 1), L('p18', 1)],
    note: '',
    status: 'on_the_way',
    payment: { method: 'cash' },
    courierSurcharge: 4,
    delivery: {
      provider: 'pedidosya',
      status: 'picked_up',
      riderName: 'Marvin L. · moto',
      reference: 'PY-GT-7731810',
      requestedAt: '13:57',
      etaAt: '14:41',
    },
  },
  {
    id: 'MON-307047',
    minutesAgo: 54,
    branchId: 'sucursal-2',
    fulfillment: 'pickup',
    customer: c('Fernando Ajú', '+502 3155-7720'),
    address: null,
    lines: [L('p2', 1), L('p12', 1)],
    note: '',
    status: 'delivered',
    payment: { method: 'cash' },
  },
  {
    id: 'MON-307046',
    minutesAgo: 60,
    branchId: 'sucursal-1',
    fulfillment: 'delivery',
    customer: c('Paola Galindo', '+502 5490-1182'),
    address: gt('9', '7a avenida 14-44, Zona 9'),
    lines: [L('p1', 2), L('p13', 1)],
    note: '',
    status: 'delivered',
    payment: { method: 'card' },
    delivery: {
      provider: 'pedidosya',
      status: 'delivered',
      riderName: 'Edwin T. · moto',
      reference: 'PY-GT-7731577',
      requestedAt: '13:42',
      etaAt: '14:07',
      deliveredAt: '14:07',
    },
  },
  {
    id: 'MON-307045',
    minutesAgo: 67,
    branchId: 'sucursal-3',
    fulfillment: 'pickup',
    customer: c('Ricardo Samayoa', '+502 4231-0057'),
    address: null,
    lines: [L('p10', 1)],
    note: '',
    status: 'rejected',
    rejectionReason: 'Producto agotado',
    payment: { method: 'cash' },
  },
  {
    id: 'MON-307044',
    minutesAgo: 75,
    branchId: 'sucursal-2',
    fulfillment: 'delivery',
    customer: c('Daniela Monterroso', '+502 5733-4418'),
    address: gt('10', '15 calle 3-20, Zona 10'),
    lines: [L('p8', 1), L('p2', 1)],
    note: '',
    status: 'delivered',
    payment: { method: 'card' },
    delivery: {
      provider: 'pedidosya',
      status: 'delivered',
      riderName: 'Brenda S. · moto',
      reference: 'PY-GT-7731203',
      requestedAt: '13:27',
      etaAt: '13:52',
      deliveredAt: '13:52',
    },
  },
];

/** Cliente de demostración de la tienda (cuenta "Google" simulada y datos de consulta). */
export const DEMO_CUSTOMER = {
  name: 'Cliente Demo',
  phone: '5555-1234',
  email: 'cliente@ejemplo.com',
};

const DEMO_ADDRESS = gt(
  '10',
  '6a avenida 10-50, Edificio Demo, apto. 3',
  'Portón negro, frente al parque',
);

/** 3 pedidos de la tienda (MON-490217 es el de la consulta de invitado: MON-490217 · 5555-1234). */
export const STORE_ORDER_SEEDS: OrderSeed[] = [
  {
    id: 'MON-490217',
    minutesAgo: 28,
    branchId: 'sucursal-1',
    fulfillment: 'delivery',
    customer: DEMO_CUSTOMER,
    address: DEMO_ADDRESS,
    lines: [
      { productId: 'calientito-roll', quantity: 1 },
      { productId: 'platanito-roll', quantity: 1, note: 'Sin ajonjolí' },
      { productId: 'te-lipton', quantity: 2 },
    ],
    note: '',
    status: 'received',
    payment: { method: 'card', reference: 'NNT-DEMO-71842' },
  },
  {
    id: 'MON-482193',
    minutesAgo: 1440 * 10 + 90,
    branchId: 'sucursal-1',
    fulfillment: 'pickup',
    customer: DEMO_CUSTOMER,
    address: null,
    lines: [
      { productId: 'california-roll', quantity: 2 },
      { productId: 'dumplings', quantity: 1 },
      { productId: 'cerveza-nacional', quantity: 2 },
    ],
    note: '',
    status: 'delivered',
    payment: { method: 'cash' },
  },
  {
    id: 'MON-479850',
    minutesAgo: 1440 * 24 + 300,
    branchId: 'sucursal-1',
    fulfillment: 'delivery',
    customer: DEMO_CUSTOMER,
    address: DEMO_ADDRESS,
    lines: [
      { productId: 'la-suegra-roll', quantity: 1, note: 'Salsa aparte' },
      // Precio histórico (hoy cuesta Q46) → aviso de cambio de precio al repetir.
      { productId: 'loco-ribs', quantity: 1, unitPrice: 42 },
      { productId: 'helados-asiaticos', quantity: 1 },
      // Producto descontinuado → "no se agregará" al repetir.
      { productId: 'roll-de-temporada', quantity: 1, unitPrice: 79, name: 'Roll de Temporada' },
    ],
    note: '',
    status: 'delivered',
    payment: { method: 'card', reference: 'NNT-DEMO-55210' },
    delivery: {
      provider: 'pedidosya',
      status: 'delivered',
      riderName: 'Wendy C. · moto',
      reference: 'PY-GT-7720412',
      requestedAt: '09:15',
      etaAt: '09:55',
      deliveredAt: '10:05',
    },
    incidents: [
      {
        id: 'INC-1042',
        createdAt: '',
        type: 'late',
        items: [],
        description: 'El pedido llegó 40 minutos después del tiempo estimado.',
        resolution: 'credit',
        status: 'resolved',
        answer: {
          es: 'Lo sentimos. Aplicamos un crédito de Q25 para tu próximo pedido (demo).',
          en: 'We’re sorry. We applied a Q25 credit to your next order (demo).',
        },
      },
    ],
  },
];

/** Cuenta de demostración (adaptador local `monsushi-account-v1` del prototipo). */
export const DEMO_ACCOUNT = {
  profile: {
    email: DEMO_CUSTOMER.email,
    fullName: DEMO_CUSTOMER.name,
    phone: DEMO_CUSTOMER.phone,
    defaultAddressId: 'demo-casa',
  },
  addresses: [
    {
      id: 'demo-casa',
      label: 'home' as const,
      customLabel: '',
      ...DEMO_ADDRESS,
      daysAgo: 40,
    },
    {
      id: 'demo-trabajo',
      label: 'work' as const,
      customLabel: '',
      department: 'Guatemala',
      municipality: 'Guatemala',
      zone: '4',
      line: 'Vía 5 4-50, Cuatro Grados Norte, oficina 2',
      references: 'Edificio blanco, preguntar en recepción',
      daysAgo: 20,
    },
  ],
  favorites: ['platanito-roll', 'calientito-roll'],
};

/** Cuentas del selector "Google" simulado. */
export const DEMO_GOOGLE_ACCOUNTS = [
  { email: DEMO_CUSTOMER.email, name: DEMO_CUSTOMER.name },
  { email: 'invitado.nuevo@ejemplo.com', name: 'Invitado Nuevo' },
];

/** Tarjetas de prueba de la pasarela NeoNet SIMULADA. */
export const TEST_CARDS = [
  { number: '4242424242424242', brand: 'Visa', result: 'approved' },
  { number: '5555555555554444', brand: 'Mastercard', result: 'approved' },
  { number: '4000000000000002', brand: 'Visa', result: 'declined' },
  { number: '4000000000000077', brand: 'Visa', result: 'review' },
] as const;
