// A product's settings, one form per section. Each form sends that section as a settings_patch on the version shown
// here; the worker validates it (a looser guard, an unknown stage or a stale version is refused, with the reason).
import type { ProductSettings } from '@ads/contracts';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { microsToInput } from '../../../../lib/forms.ts';
import { requireOperator } from '../../../../lib/server.ts';
import { ACTIONS, GUARD_FIELDS, TRUST_FIELDS, type Section } from '../../../../lib/settingsForm.ts';
import { type ProductView, getProductView } from '../../../../lib/views.ts';
import { submitSettings, submitStatus } from '../../../actions.ts';
import { ProductHeader } from '../Tabs.tsx';

function SectionForm({
  product,
  section,
  title,
  children,
}: {
  product: ProductView;
  section: Section;
  title: string;
  children: ReactNode;
}) {
  return (
    <form className="card" action={submitSettings}>
      <h2>{title}</h2>
      <input type="hidden" name="section" value={section} />
      <input type="hidden" name="productId" value={product.id} />
      <input type="hidden" name="baseVersion" value={product.settingsVersion} />
      {children}
      <button type="submit">Save {title.toLowerCase()}</button>
    </form>
  );
}

const money = (currency: string) => (currency === 'SGD' ? 'S$' : currency);

function Spend({ product, s }: { product: ProductView; s: ProductSettings }) {
  const c = money(product.currency);
  return (
    <SectionForm product={product} section="spend" title="Spending and digest">
      <label>
        <span>Daily ceiling ({c}, blank = not set)</span>
        <input name="dailyCeiling" inputMode="decimal" defaultValue={microsToInput(s.spend.dailyCeilingMicros)} />
      </label>
      <label>
        <span>Monthly ceiling ({c}, blank = not set)</span>
        <input name="monthlyCeiling" inputMode="decimal" defaultValue={microsToInput(s.spend.monthlyCeilingMicros)} />
      </label>
      <label>
        <span>Pause everything on a monthly breach</span>
        <input type="checkbox" name="autoPauseOnMonthlyBreach" defaultChecked={s.spend.autoPauseOnMonthlyBreach} />
      </label>
      <label>
        <span>Daily digest</span>
        <select name="digest" defaultValue={s.notifications.digest}>
          <option value="auto">auto (only while spending)</option>
          <option value="always">always</option>
          <option value="off">off</option>
        </select>
      </label>
      <p className="muted">Without a daily ceiling, budget increases and new campaigns are blocked.</p>
    </SectionForm>
  );
}

function Trust({ product, s }: { product: ProductView; s: ProductSettings }) {
  return (
    <SectionForm product={product} section="trust" title="Trust checks">
      {TRUST_FIELDS.map(([key, label]) => (
        <label key={key}>
          <span>{label}</span>
          <input name={key} inputMode="decimal" defaultValue={String(s.trust[key])} />
        </label>
      ))}
    </SectionForm>
  );
}

function Outcomes({ product, s }: { product: ProductView; s: ProductSettings }) {
  const stages = [...s.outcomes.stages, { id: '', label: '', tier: 'success' as const, valueMicros: undefined }];
  const routes = [
    ...s.outcomes.feedback,
    { stage: '', platform: 'meta' as const, destinationId: null, eventName: undefined },
  ];
  return (
    <SectionForm product={product} section="outcomes" title="Outcomes">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Stage id</th>
              <th>Label</th>
              <th>Tier</th>
              <th>Value ({money(product.currency)})</th>
              <th>Remove</th>
            </tr>
          </thead>
          <tbody>
            {stages.map((st, i) => (
              <tr key={i}>
                <td>
                  <input name={`stage.${i}.id`} defaultValue={st.id} placeholder={st.id === '' ? 'add a stage' : ''} />
                </td>
                <td>
                  <input name={`stage.${i}.label`} defaultValue={st.label} />
                </td>
                <td>
                  <select name={`stage.${i}.tier`} defaultValue={st.tier}>
                    <option value="soft">soft</option>
                    <option value="success">success</option>
                    <option value="hard">hard</option>
                  </select>
                </td>
                <td>
                  <input name={`stage.${i}.value`} inputMode="decimal" defaultValue={microsToInput(st.valueMicros)} />
                </td>
                <td>{i < s.outcomes.stages.length && <input type="checkbox" name={`stage.${i}.remove`} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label>
        <span>The KPI is cost per</span>
        <select name="primaryKpiStage" defaultValue={s.outcomes.primaryKpiStage}>
          {s.outcomes.stages.map((st) => (
            <option key={st.id} value={st.id}>
              {st.label} ({st.id})
            </option>
          ))}
        </select>
      </label>
      <h3>Feedback: which stages are uploaded where</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Stage id</th>
              <th>Platform</th>
              <th>Destination id (blank = not set up)</th>
              <th>Meta event name</th>
              <th>Remove</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r, i) => (
              <tr key={i}>
                <td>
                  <input name={`feedback.${i}.stage`} defaultValue={r.stage} placeholder={r.stage === '' ? 'add a route' : ''} />
                </td>
                <td>
                  <select name={`feedback.${i}.platform`} defaultValue={r.platform}>
                    <option value="meta">meta</option>
                    <option value="google">google</option>
                  </select>
                </td>
                <td>
                  <input name={`feedback.${i}.destinationId`} defaultValue={r.destinationId ?? ''} />
                </td>
                <td>
                  <input name={`feedback.${i}.eventName`} defaultValue={r.eventName ?? ''} />
                </td>
                <td>{i < s.outcomes.feedback.length && <input type="checkbox" name={`feedback.${i}.remove`} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionForm>
  );
}

function Copy({ product, s }: { product: ProductView; s: ProductSettings }) {
  return (
    <SectionForm product={product} section="copy" title="Ad copy">
      <label>
        <span>Copy tier</span>
        <select name="tier" defaultValue={s.copy.tier}>
          <option value="fragments">fragments (the agent arranges approved pieces)</option>
          <option value="reword">reword (the agent may reword, then checks)</option>
        </select>
      </label>
      <label>
        Required strings, one per line
        <textarea name="requiredStrings" defaultValue={s.copy.requiredStrings.join('\n')} />
      </label>
      <label>
        Banned phrases, one per line
        <textarea name="bannedPhrases" defaultValue={s.copy.bannedPhrases.join('\n')} />
      </label>
    </SectionForm>
  );
}

function TestTraffic({ product, s }: { product: ProductView; s: ProductSettings }) {
  return (
    <SectionForm product={product} section="testTraffic" title="Test traffic">
      <label>
        Email domains whose signups are tests (never counted or uploaded), one per line
        <textarea name="emailDomains" defaultValue={s.testTraffic.emailDomains.join('\n')} />
      </label>
    </SectionForm>
  );
}

function Guards({ product, s }: { product: ProductView; s: ProductSettings }) {
  const o = s.guardOverrides;
  return (
    <SectionForm product={product} section="guards" title="Guards">
      <p className="muted">
        Overrides can only tighten the built-in limits: a looser one is refused. A blank field keeps what is there; an
        override can&apos;t be removed here.
      </p>
      {GUARD_FIELDS.map(([key, label, kind]) => {
        const v = o[key];
        const value = v === undefined ? '' : kind === 'money' ? microsToInput(String(v)) : String(v);
        return (
          <label key={key}>
            <span>{label}</span>
            <input name={key} inputMode="decimal" defaultValue={value} placeholder="built-in" />
          </label>
        );
      })}
      <label>
        <span>Budget-neutral by default</span>
        <select
          name="budgetNeutralByDefault"
          defaultValue={o.budgetNeutralByDefault === undefined ? '' : String(o.budgetNeutralByDefault)}
        >
          <option value="">built-in</option>
          <option value="true">yes</option>
          <option value="false">no</option>
        </select>
      </label>
      <fieldset>
        <legend>Actions the agent may not propose</legend>
        {ACTIONS.map((a) => (
          <label key={a}>
            <input type="checkbox" name="disabledActions" value={a} defaultChecked={s.disabledActions.includes(a as never)} />{' '}
            {a}
          </label>
        ))}
      </fieldset>
    </SectionForm>
  );
}

function Status({ product }: { product: ProductView }) {
  const options: [string, string][] =
    product.status === 'active'
      ? [
          ['halted', 'Halt the agent (your own pauses still run)'],
          ['dormant', 'Make dormant (no scheduled cycles)'],
        ]
      : product.status === 'halted'
        ? [
            ['resume', 'Resume the agent'],
            ['dormant', 'Make dormant'],
          ]
        : [['active', 'Make active (scheduled cycles start)']];
  return (
    <section className="card">
      <h2>Status: {product.status}</h2>
      {options.map(([to, label]) => (
        <form key={to} action={submitStatus} style={{ display: 'inline-block', marginRight: 8 }}>
          <input type="hidden" name="productId" value={product.id} />
          <input type="hidden" name="to" value={to} />
          <button type="submit" className="secondary">
            {label}
          </button>
        </form>
      ))}
    </section>
  );
}

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireOperator();
  const product = await getProductView((await params).slug);
  if (product === null) notFound();
  const s = product.settings;
  return (
    <>
      <ProductHeader product={product} current="settings" />
      <p className="muted">
        Settings version {product.settingsVersion}. Each save is a request: the worker checks it and makes a new version,
        or refuses it with the reason.
      </p>
      <Status product={product} />
      {s === null ? (
        <section className="card">
          <p className="bad">The stored settings don&apos;t pass validation:</p>
          <ul className="issues">
            {product.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
          <pre>{JSON.stringify(product.stored, null, 2)}</pre>
        </section>
      ) : (
        <>
          <Spend product={product} s={s} />
          <Trust product={product} s={s} />
          <Outcomes product={product} s={s} />
          <Copy product={product} s={s} />
          <TestTraffic product={product} s={s} />
          <Guards product={product} s={s} />
          <details>
            <summary>The whole settings document</summary>
            <pre>{JSON.stringify(s, null, 2)}</pre>
          </details>
        </>
      )}
    </>
  );
}
