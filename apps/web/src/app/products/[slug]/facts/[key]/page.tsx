// One offering's fact base, edited through a form generated from the pack's published fact schema.
import { getLatestPackManifest } from '@ads/db';
import { notFound } from 'next/navigation';
import { nodeOf } from '../../../../../lib/factsForm.ts';
import { db, requireOperator } from '../../../../../lib/server.ts';
import { getProductView, listOfferingRows } from '../../../../../lib/views.ts';
import { ProductHeader } from '../../Tabs.tsx';
import { FactFields } from './FactFields.tsx';
import { FactsEditor } from './FactsEditor.tsx';

export default async function OfferingFactsPage({ params }: { params: Promise<{ slug: string; key: string }> }) {
  await requireOperator();
  const { slug, key } = await params;
  const product = await getProductView(slug);
  if (product === null) notFound();
  const offering = (await listOfferingRows(product.id)).find((o) => o.key === decodeURIComponent(key));
  if (offering === undefined) notFound();
  const manifest = await getLatestPackManifest(db(), product.packId);
  const jsonSchema = (manifest?.manifest['facts'] as { jsonSchema?: unknown } | undefined)?.jsonSchema;
  return (
    <>
      <ProductHeader product={product} current="facts" />
      <h2>
        {offering.name} <span className="muted">· facts v{offering.factsVersion}</span>
      </h2>
      {jsonSchema === undefined ? (
        <p className="bad">
          The {product.packId} pack hasn&apos;t published its fact schema yet (the worker publishes it when it starts).
        </p>
      ) : (
        <FactsEditor
          hidden={{ slug: product.slug, offeringKey: offering.key }}
          json={JSON.stringify(offering.facts, null, 2)}
        >
          <FactFields node={nodeOf(jsonSchema)} value={offering.facts} path={[]} name="" required />
        </FactsEditor>
      )}
      <p className="muted">From the {product.packId} pack, version {manifest?.version ?? '?'}.</p>
    </>
  );
}
