import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { FoodArt } from '@/components/art/FoodArt';

/** 404 de la tienda ("Este roll no existe") con enlace de vuelta al inicio. */
export default async function StoreNotFound() {
  const t = await getTranslations();
  return (
    <div className="wrap flex flex-col items-center gap-4 py-24 text-center">
      <span className="tile-cream inline-flex rounded-full p-5">
        <FoodArt kind="roll" className="h-[120px] w-[120px]" />
      </span>
      <h1 className="disp text-[44px]">{t('notFound.title')}</h1>
      <p className="m-0 text-muted">{t('notFound.sub')}</p>
      <Link href="/" className="btn btn-primary no-underline">
        {t('common.backHome')}
      </Link>
    </div>
  );
}
