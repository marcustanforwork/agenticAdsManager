// The product's proposals (M10b).
import { notFound } from 'next/navigation';
import { loadProposals } from '../../../../lib/reviewViews.ts';
import { db, requireOperator } from '../../../../lib/server.ts';
import { getProductView } from '../../../../lib/views.ts';
import { FormNotice, ProductHeader, errorOf } from '../Tabs.tsx';
import { Proposals } from './Proposals.tsx';

export default async function ProposalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOperator();
  const product = await getProductView((await params).slug);
  if (product === null) notFound();
  const data = await loadProposals(db(), product, new Date());
  return (
    <>
      <ProductHeader product={product} current="proposals" />
      <FormNotice error={errorOf(await searchParams)} />
      <Proposals product={product} data={data} />
    </>
  );
}
