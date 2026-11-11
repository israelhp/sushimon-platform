'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/Modal';
import { Price } from '@/components/ui/Price';
import { useToast } from '@/components/ui/Toast';
import { useCart } from '@/features/cart/cart-context';
import { useProducts } from '../hooks';
import { productDescription, productName } from '../localized';
import { useProductSheet } from '../product-sheet-context';

/**
 * PUNTO DE MONTAJE de la ficha de producto (ProductSheet).
 *
 * Se renderiza una sola vez dentro de `StoreShell` (`features/store-shell/components/StoreShell.tsx`) y
 * escucha `useProductSheet().productId`; cualquier tarjeta abre la ficha con `openProduct(id)`.
 *
 * STUB: el bloque de Menú lo reemplaza por la ficha completa (ilustración grande, observaciones,
 * cantidad, favorito). Mientras tanto muestra un diálogo mínimo y accesible con nombre, descripción,
 * precio y "Agregar". Conservar la exportación `ProductSheetHost` y el contrato (sin props).
 */
export function ProductSheetHost() {
  const { productId, closeProduct } = useProductSheet();
  const products = useProducts();
  const locale = useLocale();
  const t = useTranslations();
  const cart = useCart();
  const { notify } = useToast();
  const product = productId ? products.data?.find((p) => p.id === productId) : undefined;
  if (!product) return null;
  const name = productName(product, locale);
  return (
    <Modal
      open
      onClose={closeProduct}
      title={name}
      footer={
        <button
          type="button"
          className="btn btn-primary w-full !justify-between !px-5"
          disabled={!product.available}
          onClick={() => {
            cart.add(product.id, 1);
            notify(t('product.added', { a: name }));
            closeProduct();
          }}
        >
          <span>{t('common.add')}</span>
          <Price value={product.price} className="!text-base" />
        </button>
      }
    >
      <p className="m-0 leading-relaxed text-muted">{productDescription(product, locale)}</p>
    </Modal>
  );
}
