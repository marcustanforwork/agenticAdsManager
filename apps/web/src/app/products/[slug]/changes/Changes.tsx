// The change log: every change the gateway made, with its undo. "Request undo" records an `undo` request; the worker
// answers with the change's stored undo (in Phase 1 you make it by hand; from M11b the gateway makes it).
import type { Change } from '@ads/db';
import { describeAction, localTime } from '../../../../lib/review.ts';
import { nameLookup } from '../../../../lib/reviewViews.ts';
import type { ProductView } from '../../../../lib/views.ts';
import { requestUndo } from '../../../actions.ts';
import { Back } from '../Tabs.tsx';

export function Changes({
  product,
  data,
}: {
  product: ProductView;
  data: { changes: Change[]; names: Map<string, { name: string; status: string }> };
}) {
  const nameOf = nameLookup(data.names);
  if (data.changes.length === 0) {
    return (
      <section className="card">
        <h2>Change log</h2>
        <p className="muted">
          No changes yet. Phase 1 applies nothing: the log fills from Phase 2, when the gateway makes the changes you
          approve.
        </p>
      </section>
    );
  }
  return (
    <section className="card">
      <h2>Change log</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Applied</th>
              <th>Change</th>
              <th>Approved by</th>
              <th>Undo</th>
            </tr>
          </thead>
          <tbody>
            {data.changes.map((c) => {
              const { headline, change } = describeAction(c.action, product.currency, nameOf, c.undo);
              return (
                <tr key={c.revisionId}>
                  <td>
                    {localTime(c.appliedAt, product.timezone)}
                    <div className="muted">{c.revisionId}</div>
                  </td>
                  <td>
                    {headline}
                    {change === null ? null : <div className="muted">{change}</div>}
                    {c.verified ? null : <div className="bad">Not verified after applying</div>}
                  </td>
                  <td>{c.approvedBy}</td>
                  <td>
                    {c.revertedByRevisionId !== null ? (
                      <span className="muted">Undone by {c.revertedByRevisionId}</span>
                    ) : c.undo === null ? (
                      <span className="muted">Can&apos;t be undone</span>
                    ) : (
                      <form action={requestUndo}>
                        <Back slug={product.slug} screen="changes" />
                        <input type="hidden" name="revisionId" value={c.revisionId} />
                        <button type="submit" className="secondary">
                          Request undo
                        </button>
                        <div className="muted">{describeAction(c.undo, product.currency, nameOf).headline}</div>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
