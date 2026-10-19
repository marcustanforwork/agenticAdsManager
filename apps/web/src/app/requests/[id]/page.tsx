// A recorded request and the worker's verdict on it.
import { getRequestStatus, NotFoundError } from '@ads/db';
import { notFound } from 'next/navigation';
import { db, requireOperator } from '../../../lib/server.ts';
import { requestOrigin } from '../../../lib/views.ts';
import { Verdict } from './Verdict.tsx';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  await requireOperator();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  let status;
  try {
    status = await getRequestStatus(db(), id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const back = await requestOrigin(id);
  return (
    <>
      <h1>Request: {status.kind}</h1>
      <p className="muted">
        Recorded {status.createdAt.toISOString()} · id {status.id}
      </p>
      <section className="card">
        <Verdict id={status.id} initial={{ status: status.status, result: status.result }} />
      </section>
      <p>
        <a href={back}>← Back</a>
      </p>
    </>
  );
}
