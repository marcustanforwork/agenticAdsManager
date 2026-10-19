// The product's offerings (projects, plans…), each with its fact base.
import { notFound } from 'next/navigation';
import { requireOperator } from '../../../../lib/server.ts';
import { getProductView, listOfferingRows } from '../../../../lib/views.ts';
import { ProductHeader } from '../Tabs.tsx';

export default async function FactsPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireOperator();
  const product = await getProductView((await params).slug);
  if (product === null) notFound();
  const offerings = await listOfferingRows(product.id);
  return (
    <>
      <ProductHeader product={product} current="facts" />
      <p className="muted">
        What ads and the analyst may state about what {product.name} sells. Edits are checked against the{' '}
        {product.packId} pack&apos;s fact schema, here and again by the worker.
      </p>
      {offerings.length === 0 ? (
        <p>No offerings yet. They are created by the seed or the CLI.</p>
      ) : (
        <ul>
          {offerings.map((o) => (
            <li key={o.key}>
              <a href={`/products/${product.slug}/facts/${encodeURIComponent(o.key)}`}>{o.name}</a>{' '}
              <span className="muted">
                ({o.kind}, facts v{o.factsVersion}, updated {o.updatedAt.toISOString().slice(0, 10)})
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
