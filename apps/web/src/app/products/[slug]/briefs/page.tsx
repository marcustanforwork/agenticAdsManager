// The product's briefs (M10b).
import { notFound } from 'next/navigation';
import { loadBriefs } from '../../../../lib/reviewViews.ts';
import { db, requireOperator } from '../../../../lib/server.ts';
import { getProductView } from '../../../../lib/views.ts';
import { FormNotice, ProductHeader, errorOf } from '../Tabs.tsx';
import { Briefs } from './Briefs.tsx';

export default async function BriefsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOperator();
  const product = await getProductView((await params).slug);
  if (product === null) notFound();
  const briefs = await loadBriefs(db(), product);
  return (
    <>
      <ProductHeader product={product} current="briefs" />
      <FormNotice error={errorOf(await searchParams)} />
      <Briefs product={product} briefs={briefs} />
    </>
  );
}
