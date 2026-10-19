// The product's checks: trust-check history, drift and AI cost (M10b).
import { notFound } from 'next/navigation';
import { loadChecks } from '../../../../lib/reviewViews.ts';
import { db, requireOperator } from '../../../../lib/server.ts';
import { getProductView } from '../../../../lib/views.ts';
import { ProductHeader } from '../Tabs.tsx';
import { Checks } from './Checks.tsx';

export default async function ChecksPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireOperator();
  const product = await getProductView((await params).slug);
  if (product === null) notFound();
  const data = await loadChecks(db(), product, new Date());
  return (
    <>
      <ProductHeader product={product} current="checks" />
      <Checks product={product} data={data} />
    </>
  );
}
