// The product's screens: what the agent did (M10b) and its settings (M10a).
import { formErrorText } from '../../../lib/reviewForms.ts';
import type { ProductRow } from '../../../lib/views.ts';

export const TABS = [
  ['overview', 'Overview'],
  ['proposals', 'Proposals'],
  ['changes', 'Changes'],
  ['checks', 'Checks'],
  ['briefs', 'Briefs'],
  ['docs', 'Docs'],
  ['settings', 'Settings'],
  ['history', 'Settings history'],
  ['facts', 'Facts'],
] as const;

export function ProductHeader({ product, current }: { product: ProductRow; current: string }) {
  return (
    <>
      <h1>
        {product.name} <span className="muted">· {product.status}</span>
      </h1>
      <nav className="tabs">
        {TABS.map(([path, label]) =>
          path === current ? (
            <strong key={path}>{label}</strong>
          ) : (
            <a key={path} href={`/products/${product.slug}/${path}`}>
              {label}
            </a>
          ),
        )}
      </nav>
    </>
  );
}

/** A form the worker never saw because it was incomplete. The redirect carries only a code; the words are ours
 *  (`formErrorText`), so a crafted `?error=` shows the generic line, never its own text (F1). */
export function FormNotice({ error }: { error: string | undefined }) {
  if (error === undefined || error === '') return null;
  return (
    <section className="card">
      <p className="bad">Not sent: {formErrorText(error)}</p>
    </section>
  );
}

/** The hidden fields every review form carries: which screen to come back to if the form is incomplete. */
export function Back({ slug, screen }: { slug: string; screen: string }) {
  return (
    <>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="screen" value={screen} />
    </>
  );
}

/** The `?error=` of a review screen's URL. */
export const errorOf = (q: Record<string, string | string[] | undefined>): string | undefined =>
  typeof q['error'] === 'string' ? q['error'] : undefined;
