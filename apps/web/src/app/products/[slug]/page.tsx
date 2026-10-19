// A product opens on its overview.
import { redirect } from 'next/navigation';
import { requireOperator } from '../../../lib/server.ts';

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireOperator();
  redirect(`/products/${encodeURIComponent((await params).slug)}/overview`);
}
