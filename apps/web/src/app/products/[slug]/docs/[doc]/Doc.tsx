// A product document (STRATEGY, PLAYBOOK or LEARNINGS): the editor on the latest version, and its history. Saving
// records a `product_doc_put` on the version shown; if it changed meanwhile, the worker refuses it as stale.
import { localTime } from '@ads/contracts';
import type { DocVersion } from '@ads/db';
import type { DocKind } from '../../../../../lib/reviewViews.ts';
import type { ProductView } from '../../../../../lib/views.ts';
import { saveDoc } from '../../../../actions.ts';
import { Back } from '../../Tabs.tsx';

/** The worker's limit (core PRODUCT_DOC_MAX_CHARS). */
const MAX_CHARS = 20_000;

export const DOC_TITLES: Record<DocKind, string> = {
  strategy: 'STRATEGY',
  playbook: 'PLAYBOOK',
  learnings: 'LEARNINGS',
};

const who = (v: DocVersion): string => (v.actor === null ? 'the seed' : `${v.actor} via ${v.channel ?? '?'}`);

export function Doc({ product, doc, versions }: { product: ProductView; doc: DocKind; versions: DocVersion[] }) {
  const latest = versions[0];
  return (
    <>
      <form className="card" action={saveDoc}>
        <h2>
          {DOC_TITLES[doc]}{' '}
          <span className="muted">
            · {latest === undefined ? 'not written yet' : `version ${latest.version}, by ${who(latest)}`}
          </span>
        </h2>
        <Back slug={product.slug} screen="docs" />
        <input type="hidden" name="productId" value={product.id} />
        <input type="hidden" name="doc" value={doc} />
        <input type="hidden" name="baseVersion" value={latest?.version ?? 0} />
        <textarea name="markdown" rows={24} maxLength={MAX_CHARS} defaultValue={latest?.markdown ?? ''} />
        <p className="muted">Markdown, up to {MAX_CHARS.toLocaleString('en')} characters. The analyst reads it.</p>
        <button type="submit">Save as version {(latest?.version ?? 0) + 1}</button>
      </form>
      <section className="card">
        <h2>History</h2>
        {versions.length === 0 ? <p className="muted">No versions yet.</p> : null}
        {versions.map((v) => (
          <details key={v.version}>
            <summary>
              Version {v.version} · {localTime(v.updatedAt, product.timezone)} · by {who(v)}
            </summary>
            <pre className="brief">{v.markdown}</pre>
          </details>
        ))}
      </section>
    </>
  );
}
