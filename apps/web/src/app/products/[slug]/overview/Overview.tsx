// The overview: spend against the ceilings with the month's projection, the KPI trend, outcomes by stage with the
// attribution rate, and the accounts with their last sync. Numbers only, all from SQL (reviewViews.ts).
import { costPer, countOf, formatMoney, localTime, percentOf, stageWord } from '@ads/contracts';
import { type OverviewData, TREND_DAYS } from '../../../../lib/reviewViews.ts';
import { type TrendRow } from '../../../../lib/review.ts';
import type { ProductView } from '../../../../lib/views.ts';

function OfCeiling({ part, ceiling, currency }: { part: bigint; ceiling: bigint | null; currency: string }) {
  if (ceiling === null) return <span className="muted">no ceiling set</span>;
  const pct = percentOf(part, ceiling);
  return (
    <span className={part > ceiling ? 'bad' : undefined}>
      of {formatMoney(ceiling, currency)}
      {pct === null ? '' : ` (${pct}%)`}
      {part > ceiling ? ' — over the ceiling' : ''}
    </span>
  );
}

function TrendTable({ rows, label, currency }: { rows: TrendRow[]; label: string; currency: string }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Days</th>
            <th>Spend</th>
            <th>{label}</th>
            <th>Cost per one</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.from}>
              <td>{r.from === r.to ? r.from : `${r.from} to ${r.to}`}</td>
              <td>{formatMoney(r.spendMicros, currency)}</td>
              <td>{r.kpi}</td>
              <td>{r.costMicros === null ? <span className="muted">—</span> : formatMoney(r.costMicros, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Overview({ product, data }: { product: ProductView; data: OverviewData }) {
  const c = product.currency;
  const { spend, kpi, trend } = data;
  const p = spend.projection;
  const total = trend.weeks.reduce(
    (t, w) => ({ spend: t.spend + w.spendMicros, kpi: t.kpi + w.kpi }),
    { spend: 0n, kpi: 0 },
  );
  const totalCost = costPer(total.spend, total.kpi);
  return (
    <>
      {product.settings === null && (
        <section className="card">
          <p className="bad">
            This product&apos;s stored settings have problems, so its ceilings and outcome stages aren&apos;t shown.
            See Settings.
          </p>
        </section>
      )}

      <section className="card">
        <h2>Spend</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              <tr>
                <th>Yesterday ({data.day})</th>
                <td>{formatMoney(spend.dayMicros, c)}</td>
                <td>
                  <OfCeiling part={spend.dayMicros} ceiling={spend.dailyCeilingMicros} currency={c} />
                </td>
              </tr>
              <tr>
                <th>Month to date ({p.month})</th>
                <td>{formatMoney(spend.monthMicros, c)}</td>
                <td>
                  <OfCeiling part={spend.monthMicros} ceiling={spend.monthlyCeilingMicros} currency={c} />
                </td>
              </tr>
              <tr>
                <th>Projected for {p.month}</th>
                <td>{formatMoney(p.projectedMicros, c)}</td>
                <td>
                  <OfCeiling part={p.projectedMicros} ceiling={spend.monthlyCeilingMicros} currency={c} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted">
          The projection carries on the average of the {countOf(p.daysElapsed, 'day')} so far to all {p.daysInMonth}{' '}
          days of the month.
        </p>
      </section>

      <section className="card">
        <h2>
          Cost per {stageWord(kpi.stage) || 'outcome'}, last {TREND_DAYS} days
        </h2>
        <p>
          {formatMoney(total.spend, c)} spent, {countOf(total.kpi, kpi.stage || 'outcome')}
          {totalCost === null ? '' : `: ${formatMoney(totalCost, c)} each`}.
        </p>
        <TrendTable rows={trend.weeks} label={kpi.label || 'Outcomes'} currency={c} />
        <details>
          <summary>Day by day</summary>
          <TrendTable rows={trend.days} label={kpi.label || 'Outcomes'} currency={c} />
        </details>
      </section>

      <section className="card">
        <h2>Outcomes by stage, last {TREND_DAYS} days</h2>
        <p className="muted">
          Attributed = credited to a campaign (platform ids, a Google click look-up or UTM tags). Test traffic never
          counts.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Stage</th>
                <th>Outcomes</th>
                <th>Attributed</th>
                <th>Rate</th>
                <th>By method</th>
                <th>Test (left out)</th>
              </tr>
            </thead>
            <tbody>
              {data.stages.map((s) => (
                <tr key={s.stage}>
                  <td>
                    {s.label ?? s.stage}
                    {s.kpi ? <strong> · KPI</strong> : null}
                    {s.label === null ? <span className="muted"> (not in the settings)</span> : null}
                  </td>
                  <td>{s.outcomes}</td>
                  <td>{s.attributed}</td>
                  <td>{s.ratePct === null ? <span className="muted">—</span> : `${s.ratePct}%`}</td>
                  <td className="muted">
                    platform ids {s.byMethod.platform_ids} · click look-up {s.byMethod.gclid_lookup} · UTM{' '}
                    {s.byMethod.utm} · none found {s.byMethod.none} · not looked at yet {s.byMethod.pending}
                  </td>
                  <td>{s.test}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>Accounts</h2>
        {data.accounts.length === 0 ? (
          <p className="muted">No ad account is linked yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>Account</th>
                  <th>Status</th>
                  <th>Last sync</th>
                </tr>
              </thead>
              <tbody>
                {data.accounts.map((a) => (
                  <tr key={a.id}>
                    <td>{a.platform}</td>
                    <td>
                      {a.externalId}
                      {a.name === null ? null : <span className="muted"> “{a.name}”</span>}
                    </td>
                    <td>{a.status}</td>
                    <td>
                      {a.lastSyncedAt === null ? (
                        <span className="muted">never</span>
                      ) : (
                        `${localTime(a.lastSyncedAt, product.timezone)} (${product.timezone})`
                      )}
                      {a.lastSyncError === null ? null : (
                        <div className="bad">Last attempt failed: {a.lastSyncError.slice(0, 300)}</div>
                      )}
                    </td>
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
