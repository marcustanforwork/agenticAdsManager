// Briefs: the latest weekly and diagnostic briefs as they were sent, each with 👍 useful / 💡 new to me (the Phase 0
// gate's measure). Saving records a `brief_feedback` request with only the answers changed on the page (F1).
import { localTime } from '@ads/contracts';
import type { Brief } from '@ads/db';
import type { ProductView } from '../../../../lib/views.ts';
import { sendBriefFeedback } from '../../../actions.ts';
import { Back } from '../Tabs.tsx';

const answer = (v: boolean | null): string => (v === null ? 'not answered' : v ? 'yes' : 'no');
/** An answer as the form carries it: `yes`, `no`, or empty when unanswered (reviewForms.ts compares against it). */
const shown = (v: boolean | null): string => (v === null ? '' : v ? 'yes' : 'no');

/** One answer as a yes / no choice, preset to what is stored; left alone, it sends nothing (F1). */
function Choice({ name, label, value }: { name: string; label: string; value: boolean | null }) {
  return (
    <p>
      {label}:{' '}
      <label>
        <input type="radio" name={name} value="yes" defaultChecked={value === true} /> yes
      </label>{' '}
      <label>
        <input type="radio" name={name} value="no" defaultChecked={value === false} /> no
      </label>{' '}
      <span className="muted">(now: {answer(value)})</span>
    </p>
  );
}

export function Briefs({ product, briefs }: { product: ProductView; briefs: Brief[] }) {
  if (briefs.length === 0) {
    return (
      <section className="card">
        <p className="muted">No brief yet. The weekly brief arrives on Mondays once the worker runs live.</p>
      </section>
    );
  }
  return (
    <>
      {briefs.map((b) => (
        <section className="card" key={b.id}>
          <h2>
            {b.kind === 'weekly' ? 'Weekly brief' : 'Diagnostic brief'}{' '}
            <span className="muted">· {localTime(b.createdAt, product.timezone)}</span>
          </h2>
          <p className="muted">
            {b.sentAt === null ? 'Not sent to Telegram' : `Sent ${localTime(b.sentAt, product.timezone)}`}
            {b.usedTemplateFallback ? ' · written from the template (the AI wording failed its number check)' : ''}
          </p>
          <pre className="brief">{b.markdown}</pre>
          <form action={sendBriefFeedback}>
            <Back slug={product.slug} screen="briefs" />
            <input type="hidden" name="briefId" value={b.id} />
            <input type="hidden" name="usefulShown" value={shown(b.feedbackUseful)} />
            <input type="hidden" name="newInfoShown" value={shown(b.feedbackNewInfo)} />
            <Choice name="useful" label="👍 Useful" value={b.feedbackUseful} />
            <Choice name="newInfo" label="💡 New to me" value={b.feedbackNewInfo} />
            <button type="submit" className="secondary">
              Save feedback
            </button>
          </form>
        </section>
      ))}
    </>
  );
}
