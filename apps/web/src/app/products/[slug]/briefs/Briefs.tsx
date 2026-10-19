// Briefs: the latest weekly and diagnostic briefs as they were sent, each with 👍 useful / 💡 new to me (the Phase 0
// gate's measure). Saving records a `brief_feedback` request with both answers.
import type { Brief } from '@ads/db';
import { localTime } from '../../../../lib/review.ts';
import type { ProductView } from '../../../../lib/views.ts';
import { sendBriefFeedback } from '../../../actions.ts';
import { Back } from '../Tabs.tsx';

const answer = (v: boolean | null): string => (v === null ? 'not answered' : v ? 'yes' : 'no');

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
            <label>
              <input type="checkbox" name="useful" defaultChecked={b.feedbackUseful === true} /> 👍 Useful{' '}
              <span className="muted">(now: {answer(b.feedbackUseful)})</span>
            </label>
            <label>
              <input type="checkbox" name="newInfo" defaultChecked={b.feedbackNewInfo === true} /> 💡 New to me{' '}
              <span className="muted">(now: {answer(b.feedbackNewInfo)})</span>
            </label>
            <button type="submit" className="secondary">
              Save feedback
            </button>
          </form>
        </section>
      ))}
    </>
  );
}
