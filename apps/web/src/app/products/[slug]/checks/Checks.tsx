// Checks: the AI cost, the trust-check history per cycle, and drift (changes made outside the agent).
import { formatUsd, localTime } from '../../../../lib/review.ts';
import type { ChecksData } from '../../../../lib/reviewViews.ts';
import type { ProductView } from '../../../../lib/views.ts';

// A cycle's trust result is ok, degraded or fail; a check's is pass, warn, fail or no_signal (too little data to
// judge: shown, but not as a problem).
const RESULT_CLASS: Record<string, string | undefined> = {
  fail: 'bad',
  warn: 'bad',
  degraded: 'bad',
  ok: 'ok',
  pass: 'ok',
  no_signal: 'muted',
};

/** "all 5 passed", or "4 passed, 1 no signal" when some checks had too little data to judge. */
function allClear(checks: { result: string }[]): string {
  if (checks.length === 0) return 'no checks';
  const quiet = checks.filter((c) => c.result === 'no_signal').length;
  return quiet === 0 ? `all ${checks.length} passed` : `${checks.length - quiet} passed, ${quiet} no signal`;
}

const shown = (v: unknown): string => {
  const inner = v !== null && typeof v === 'object' && 'value' in v ? v.value : v;
  return inner === undefined || inner === null ? '(none)' : JSON.stringify(inner);
};

export function Checks({ product, data }: { product: ProductView; data: ChecksData }) {
  const tz = product.timezone;
  const accountText = (id: string | null): string => {
    if (id === null) return 'product';
    const a = data.accounts.get(id);
    return a === undefined ? 'account' : `${a.platform}:${a.externalId}`;
  };
  return (
    <>
      <section className="card">
        <h2>AI cost, last {data.aiCost.days} days</h2>
        <p>
          {formatUsd(data.aiCost.costMicros)} over {data.aiCost.cycles} cycle{data.aiCost.cycles === 1 ? '' : 's'}{' '}
          that used the AI. <span className="muted">Each cycle&apos;s cost is in the table below; Langfuse has the detail.</span>
        </p>
      </section>

      <section className="card">
        <h2>Trust checks, by cycle</h2>
        {data.cycles.length === 0 ? (
          <p className="muted">No cycle has run yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Cycle</th>
                  <th>Trust</th>
                  <th>Problems</th>
                  <th>AI cost</th>
                </tr>
              </thead>
              <tbody>
                {data.cycles.map(({ cycle, checks }) => {
                  const problems = checks.filter((c) => c.result === 'fail' || c.result === 'warn');
                  return (
                    <tr key={cycle.id}>
                      <td>
                        {cycle.cycleDate} · {cycle.kind}
                        <div className="muted">
                          started {localTime(cycle.startedAt, tz)} · reached {cycle.stageReached.replaceAll('_', ' ')}
                          {cycle.finishedAt === null ? ' · not finished' : ''}
                        </div>
                        {cycle.error === null ? null : <div className="bad">Error: {cycle.error.slice(0, 300)}</div>}
                      </td>
                      <td className={RESULT_CLASS[cycle.trustResult ?? '']}>{cycle.trustResult ?? '—'}</td>
                      <td>
                        {problems.length === 0 ? (
                          <span className="muted">{allClear(checks)}</span>
                        ) : (
                          problems.map((c) => (
                            <div key={c.id} className={RESULT_CLASS[c.result]}>
                              {c.checkId} {c.result} <span className="muted">({accountText(c.accountId)})</span>
                            </div>
                          ))
                        )}
                        {checks.length > 0 && (
                          <details>
                            <summary>Every check</summary>
                            <ul>
                              {checks.map((c) => (
                                <li key={c.id}>
                                  {c.checkId} <span className={RESULT_CLASS[c.result]}>{c.result}</span>{' '}
                                  <span className="muted">({accountText(c.accountId)})</span>
                                  <pre>{JSON.stringify(c.detail, null, 2)}</pre>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </td>
                      <td>
                        {formatUsd(cycle.modelCostMicros)}
                        {cycle.lookups > 0 ? <div className="muted">{cycle.lookups} look-ups</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Drift: changes made outside the agent</h2>
        {data.drift.length === 0 ? (
          <p className="muted">None found.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Found</th>
                  <th>What</th>
                  <th>Change</th>
                  <th>Seen</th>
                </tr>
              </thead>
              <tbody>
                {data.drift.map((d) => (
                  <tr key={d.id}>
                    <td>{localTime(d.detectedAt, tz)}</td>
                    <td>
                      {d.entity.type.replaceAll('_', ' ')} “{d.entity.name}”
                      <div className="muted">
                        {d.entity.platform}:{d.entity.accountId}:{d.entity.type}:{d.entity.externalId}
                      </div>
                    </td>
                    <td>
                      {d.field}: {shown(d.expected)} → {shown(d.observed)}
                    </td>
                    <td>{d.acknowledgedAt === null ? <span className="bad">not yet</span> : localTime(d.acknowledgedAt, tz)}</td>
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
