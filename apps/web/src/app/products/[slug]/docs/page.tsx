// The product's documents: STRATEGY, PLAYBOOK and LEARNINGS, which the analyst reads (M10b). A form that comes back
// incomplete lands here with its reason.
import { getProductDoc } from '@ads/db';
import { notFound } from 'next/navigation';
import { localTime } from '../../../../lib/review.ts';
import { DOCS } from '../../../../lib/reviewViews.ts';
import { db, requireOperator } from '../../../../lib/server.ts';
import { getProductView } from '../../../../lib/views.ts';
import { FormNotice, ProductHeader, errorOf } from '../Tabs.tsx';
import { DOC_TITLES } from './[doc]/Doc.tsx';

export default async function DocsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOperator();
  const product = await getProductView((await params).slug);
  if (product === null) notFound();
  const latest = await Promise.all(DOCS.map((d) => getProductDoc(db(), product.id, d)));
  return (
    <>
      <ProductHeader product={product} current="docs" />
      <FormNotice error={errorOf(await searchParams)} />
      {DOCS.map((d, i) => {
        const doc = latest[i];
        return (
          <section className="card" key={d}>
            <h2>
              <a href={`/products/${product.slug}/docs/${d}`}>{DOC_TITLES[d]}</a>
            </h2>
            <p className="muted">
              {doc == null
                ? 'Not written yet.'
                : `Version ${doc.version}, ${localTime(doc.updatedAt, product.timezone)} · ${doc.markdown.length.toLocaleString('en')} characters`}
            </p>
          </section>
        );
      })}
    </>
  );
}
