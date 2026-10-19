// The product's overview (M10b).
import { notFound } from 'next/navigation';
import { loadOverview } from '../../../../lib/reviewViews.ts';
import { db, requireOperator } from '../../../../lib/server.ts';
import { getProductView } from '../../../../lib/views.ts';
import { ProductHeader } from '../Tabs.tsx';
import { Overview } from './Overview.tsx';

export default async function OverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireOperator();
  const product = await getProductView((await params).slug);
  if (product === null) notFound();
  const data = await loadOverview(db(), product, new Date());
  return (
    <>
      <ProductHeader product={product} current="overview" />
      <Overview product={product} data={data} />
    </>
  );
}
