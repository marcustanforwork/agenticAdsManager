'use client';
// The fact editor's form: it posts to the saveFacts action, which shows the schema's reasons here when it refuses,
// or goes to the request's page when the facts are recorded.
import { useActionState, type ReactNode } from 'react';
import { type FactsState, saveFacts } from '../../../../actions.ts';

export function FactsEditor({ hidden, children, json }: { hidden: Record<string, string>; children: ReactNode; json: string }) {
  const [state, action, pending] = useActionState<FactsState, FormData>(saveFacts, { issues: [] });
  const hiddenInputs = Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />);
  return (
    <>
      {state.issues.length > 0 && (
        <section className="card">
          <p className="bad">Not saved: the pack&apos;s fact schema refuses these facts.</p>
          <ul className="issues">
            {state.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </section>
      )}
      <form className="card" action={action}>
        {hiddenInputs}
        <input type="hidden" name="mode" value="form" />
        {children}
        <button type="submit" disabled={pending}>
          Save facts
        </button>
      </form>
      <details>
        <summary>Edit as JSON instead</summary>
        <form className="card" action={action}>
          {hiddenInputs}
          <input type="hidden" name="mode" value="json" />
          <textarea name="json" defaultValue={json} style={{ minHeight: '16rem', fontFamily: 'monospace' }} />
          <button type="submit" disabled={pending}>
            Save JSON
          </button>
        </form>
      </details>
    </>
  );
}
