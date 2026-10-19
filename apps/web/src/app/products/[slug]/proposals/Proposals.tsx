// Proposals: the open ones, each with Approve, Reject (with a reason) and, for a budget or a negative keyword, Edit;
// the approved ones waiting to be made by hand; the latest decisions; and the agree rate the Phase 1 gate measures.
// Every button records a request (approve, reject or edit_approve) on the version shown here.
import { microsToInput } from '../../../../lib/forms.ts';
import { describeAction, editableFields, localTime, ratePct } from '../../../../lib/review.ts';
import { type ProposalItem, type ProposalsData, nameLookup } from '../../../../lib/reviewViews.ts';
import type { ProductView } from '../../../../lib/views.ts';
import type { WriteOp } from '@ads/contracts';
import { decideProposal } from '../../../actions.ts';
import { Back } from '../Tabs.tsx';

function Hidden({ item, slug, verb }: { item: ProposalItem; slug: string; verb: string }) {
  return (
    <>
      <Back slug={slug} screen="proposals" />
      <input type="hidden" name="proposalId" value={item.proposal.id} />
      <input type="hidden" name="version" value={item.proposal.version} />
      <input type="hidden" name="verb" value={verb} />
    </>
  );
}

function Decide({ item, product }: { item: ProposalItem; product: ProductView }) {
  const p = item.proposal;
  const own = p.origin === 'operator';
  const fields = own ? [] : editableFields(p.action);
  const action = p.action;
  return (
    <div className="decide">
      <form action={decideProposal}>
        <Hidden item={item} slug={product.slug} verb="approve" />
        <input type="hidden" name="actionHash" value={p.actionHash} />
        <button type="submit">{own ? 'Confirm' : 'Approve'}</button>
      </form>
      <form action={decideProposal}>
        <Hidden item={item} slug={product.slug} verb="reject" />
        <label>
          <span>{own ? 'Cancel' : 'Reject'}: why?</span>
          <input name="reason" required minLength={3} maxLength={500} placeholder="a few words" />
        </label>
        <button type="submit" className="secondary">
          {own ? 'Cancel it' : 'Reject'}
        </button>
      </form>
      {fields.includes('budget') && action.action === 'adjust_budget' && (
        <form action={decideProposal}>
          <Hidden item={item} slug={product.slug} verb="edit_budget" />
          <label>
            <span>Edit: new daily budget ({product.currency})</span>
            <input
              name="budget"
              required
              inputMode="decimal"
              pattern="[0-9,]*(\.[0-9]{1,6})?"
              defaultValue={microsToInput(action.newDailyBudgetMicros)}
            />
          </label>
          <button type="submit" className="secondary">
            Edit and approve
          </button>
        </form>
      )}
      {fields.includes('negative_text') && action.action === 'add_negative_keyword' && (
        <>
          <form action={decideProposal}>
            <Hidden item={item} slug={product.slug} verb="edit_text" />
            <label>
              <span>Edit: the words to block</span>
              <input name="text" required maxLength={80} defaultValue={action.text} />
            </label>
            <button type="submit" className="secondary">
              Edit and approve
            </button>
          </form>
          <form action={decideProposal}>
            <Hidden item={item} slug={product.slug} verb="edit_match" />
            <label>
              <span>Edit: match type</span>
              <select name="matchType" defaultValue={action.matchType === 'EXACT' ? 'PHRASE' : 'EXACT'}>
                <option value="EXACT">exact</option>
                <option value="PHRASE">phrase</option>
              </select>
            </label>
            <button type="submit" className="secondary">
              Edit and approve
            </button>
          </form>
        </>
      )}
    </div>
  );
}

function Card({ item, data, product }: { item: ProposalItem; data: ProposalsData; product: ProductView }) {
  const p = item.proposal;
  const { headline, change } = describeAction(p.action, product.currency, nameLookup(data.names), p.undo);
  const expired = p.status === 'pending' && !item.open;
  return (
    <section className="card">
      <h2>
        Proposal {p.shortId} <span className="muted">· v{p.version}</span>
        {item.findingType === null ? null : <span className="muted"> · {item.findingType}</span>}
        {p.origin === 'operator' ? <span className="muted"> · your own request</span> : null}
      </h2>
      <p>
        <strong>{headline}</strong>
        {change === null ? null : <span className="muted"> · {change}</span>}
      </p>
      <p>
        <strong>Why:</strong> {p.rationale}
      </p>
      <p>
        <strong>Expected:</strong> {p.expectedEffect}
      </p>
      <p className="muted">
        Created {localTime(p.createdAt, product.timezone)} · expires {localTime(p.expiresAt, product.timezone)} (
        {product.timezone})
      </p>
      {p.status === 'approved' ? (
        <p className="ok">Approved. Phase 1 applies nothing: make this change by hand in the ads manager.</p>
      ) : expired ? (
        <p className="muted">Expired: it can no longer be decided.</p>
      ) : (
        <Decide item={item} product={product} />
      )}
    </section>
  );
}

function AgreeRate({ agree }: { agree: ProposalsData['agree'] }) {
  const decided = agree.approved + agree.rejected;
  const rate = ratePct(agree.approved, decided);
  const expiredPct = ratePct(agree.expired, agree.total);
  return (
    <section className="card">
      <h2>Agree rate, last {agree.days} days</h2>
      <p>
        {rate === null ? 'Nothing decided yet' : `${rate}% agreed`}: {agree.approved} approved (edits included),{' '}
        {agree.rejected} rejected, {agree.expired} expired, {agree.pending} waiting, of {agree.total} agent proposals.
        {expiredPct !== null && expiredPct > 20 ? <span className="bad"> {expiredPct}% expired.</span> : null}
      </p>
      <p className="muted">
        The Phase 1 gate: at least 70% agreed over 3 weeks, with at least 15 agent proposals, and no more than 20%
        expired. Your own requests don&apos;t count.
      </p>
    </section>
  );
}

export function Proposals({ product, data }: { product: ProductView; data: ProposalsData }) {
  const nameOf = nameLookup(data.names);
  return (
    <>
      <AgreeRate agree={data.agree} />
      <h2>Waiting for you ({data.pending.filter((i) => i.open).length})</h2>
      {data.pending.length === 0 ? <p className="muted">No open proposals.</p> : null}
      {data.pending.map((item) => (
        <Card key={item.proposal.id} item={item} data={data} product={product} />
      ))}
      {data.approved.length > 0 && (
        <>
          <h2>Approved, to make by hand ({data.approved.length})</h2>
          {data.approved.map((item) => (
            <Card key={item.proposal.id} item={item} data={data} product={product} />
          ))}
        </>
      )}
      <section className="card">
        <h2>Latest decisions</h2>
        {data.decisions.length === 0 ? (
          <p className="muted">None yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Proposal</th>
                  <th>Decision</th>
                  <th>By</th>
                  <th>Now</th>
                </tr>
              </thead>
              <tbody>
                {data.decisions.map((d) => (
                  <tr key={`${d.proposalId}:${d.version}`}>
                    <td>{localTime(d.decidedAt, product.timezone)}</td>
                    <td>
                      {d.shortId} v{d.version}: {describeAction(d.action as WriteOp, product.currency, nameOf).headline}
                    </td>
                    <td className={d.decision === 'approve' ? 'ok' : 'bad'}>
                      {d.decision === 'approve' ? 'approved' : 'rejected'}
                      {d.reason === null ? null : <span className="muted"> · “{d.reason}”</span>}
                    </td>
                    <td>
                      {d.actor} <span className="muted">via {d.channel}</span>
                    </td>
                    <td>{d.status.replaceAll('_', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
