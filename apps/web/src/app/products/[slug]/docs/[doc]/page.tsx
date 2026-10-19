// One product document: editor and history (M10b).
import { notFound } from 'next/navigation';
import { isDoc, loadDoc } from '../../../../../lib/reviewViews.ts';
import { db, requireOperator } from '../../../../../lib/server.ts';
import { getProductView } from '../../../../../lib/views.ts';
import { FormNotice, ProductHeader, errorOf } from '../../Tabs.tsx';
import { Doc } from './Doc.tsx';

export default async function DocPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; doc: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOperator();
  const { slug, doc } = await params;
  if (!isDoc(doc)) notFound();
  const product = await getProductView(slug);
  if (product === null) notFound();
  const data = await loadDoc(db(), product, doc);
  return (
    <>
      <ProductHeader product={product} current="docs" />
      <FormNotice error={errorOf(await searchParams)} />
      <Doc product={product} doc={doc} versions={data.versions} />
    </>
  );
}
