'use client';
// The fact editor's form: it posts to the saveFacts action, which shows the schema's reasons here when it refuses
// (with what was typed, rebuilt into the fields), or goes to the request's page when the facts are recorded.
import { useActionState } from 'react';
import type { FactNode } from '../../../../../lib/factsForm.ts';
import { type FactsState, saveFacts } from '../../../../actions.ts';
import { FactFields } from './FactFields.tsx';

export function FactsEditor({
  hidden,
  node,
  facts,
}: {
  hidden: Record<string, string>;
  node: FactNode;
  facts: Record<string, unknown>;
}) {
  const [state, action, pending] = useActionState<FactsState, FormData>(saveFacts, { issues: [], attempt: 0 });
  const shown = state.submitted?.facts ?? facts;
  const json = state.submitted?.json ?? JSON.stringify(shown, null, 2);
  const hiddenInputs = Object.entries(hidden).map(([name, value]) => (
    <input key={name} type="hidden" name={name} value={value} />
  ));
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
      <form className="card" action={action} key={`form-${state.attempt}`}>
        {hiddenInputs}
        <input type="hidden" name="mode" value="form" />
        <FactFields node={node} value={shown} path={[]} name="" required />
        <button type="submit" disabled={pending}>
          Save facts
        </button>
      </form>
      <details open={state.submitted?.json !== null && state.submitted?.json !== undefined}>
        <summary>Edit as JSON instead</summary>
        <form className="card" action={action} key={`json-${state.attempt}`}>
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
