/**
 * El códec del cursor keyset `(placed_at, id)` se extrajo a `../order-cursor.ts` (F23, spec 024 §1) para compartirlo con el
 * historial del cliente SIN cambiar su comportamiento. Este módulo conserva las rutas de importación de F22.
 */
export { decodeCursor, encodeCursor, type OrderCursor } from '../order-cursor.js';
