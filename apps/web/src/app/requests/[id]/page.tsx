// A recorded request and the worker's verdict on it.
import { localTime } from '@ads/contracts';
import { getRequestStatus, NotFoundError } from '@ads/db';
import { notFound } from 'next/navigation';
import { db, requireOperator } from '../../../lib/server.ts';
import { requestOrigin, sentDocument } from '../../../lib/views.ts';
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
  const sent = await sentDocument(id);
  return (
    <>
      <h1>Request: {status.kind}</h1>
      <p className="muted">
        Recorded {localTime(status.createdAt, 'UTC')} UTC · id {status.id}
      </p>
      <section className="card">
        <Verdict id={status.id} initial={{ status: status.status, result: status.result }} />
      </section>
      {sent === null ? null : (
        <section className="card">
          <details open={status.status === 'refused'}>
            <summary>The text you sent (copy it if the save was refused)</summary>
            <pre className="brief">{sent}</pre>
          </details>
        </section>
      )}
      <p>
        <a href={back}>← Back</a>
      </p>
    </>
  );
}
