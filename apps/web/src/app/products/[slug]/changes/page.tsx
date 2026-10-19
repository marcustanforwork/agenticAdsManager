// The product's change log (M10b).
import { notFound } from 'next/navigation';
import { loadChanges } from '../../../../lib/reviewViews.ts';
import { db, requireOperator } from '../../../../lib/server.ts';
import { getProductView } from '../../../../lib/views.ts';
import { FormNotice, ProductHeader, errorOf } from '../Tabs.tsx';
import { Changes } from './Changes.tsx';

export default async function ChangesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOperator();
  const product = await getProductView((await params).slug);
  if (product === null) notFound();
  const data = await loadChanges(db(), product);
  return (
    <>
      <ProductHeader product={product} current="changes" />
      <FormNotice error={errorOf(await searchParams)} />
      <Changes product={product} data={data} />
    </>
  );
}
