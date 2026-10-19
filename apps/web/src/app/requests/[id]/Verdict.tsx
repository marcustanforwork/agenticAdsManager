'use client';
// Polls the request until the worker has decided it, then shows the verdict. The worker picks dashboard requests up
// within seconds (NOTIFY, with a 30-second poll as a backstop); after two minutes the page says so and stops.
import { useEffect, useState } from 'react';

interface Status {
  status: 'queued' | 'done' | 'refused';
  result: Record<string, unknown> | null;
}

const POLL_MS = 1_000;
const GIVE_UP_MS = 120_000;

export function Verdict({ id, initial }: { id: string; initial: Status }) {
  const [status, setStatus] = useState<Status>(initial);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    if (status.status !== 'queued') return;
    const started = Date.now();
    let stopped = false;
    const tick = async (): Promise<void> => {
      if (stopped) return;
      if (Date.now() - started > GIVE_UP_MS) {
        setGaveUp(true);
        return;
      }
      try {
        const res = await fetch(`/api/requests/${id}`, { cache: 'no-store' });
        if (res.ok) {
          const next = (await res.json()) as Status;
          if (next.status !== 'queued') {
            setStatus(next);
            return;
          }
        }
      } catch {
        // A network blip: try again on the next tick.
      }
      setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      stopped = true;
    };
  }, [id, status.status]);

  if (status.status === 'queued') {
    return gaveUp ? (
      <p className="bad">
        Still waiting after two minutes. Is the worker running? The request stays queued and will be processed when it
        is; reload this page to check.
      </p>
    ) : (
      <p className="muted">Waiting for the worker to check it…</p>
    );
  }
  const result = status.result ?? {};
  if (status.status === 'refused') {
    const issues = Array.isArray(result['issues']) ? (result['issues'] as unknown[]).map(String) : [];
    return (
      <>
        <p className="bad">
          <strong>Refused:</strong> {typeof result['reason'] === 'string' ? result['reason'] : 'no reason given'}
        </p>
        {issues.length > 0 && (
          <ul className="issues">
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        )}
        <p className="muted">Nothing was changed.</p>
      </>
    );
  }
  return (
    <>
      <p className="ok">
        <strong>Done.</strong>
      </p>
      <pre>{JSON.stringify(result, null, 2)}</pre>
    </>
  );
}
