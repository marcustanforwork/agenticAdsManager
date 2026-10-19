// Each review view, rendered from a fixture database (M10b): the loader reads it under the dashboard's role, the
// screen renders to HTML, and the HTML shows the numbers the fixture implies. Platform text stays text.
import type { DbOrTx } from '@ads/db';
import { createTestDatabase, type TestDatabase } from '@ads/db/testing';
import { recordWebRequest } from '@ads/db';
import { sql } from 'drizzle-orm';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Briefs } from '../src/app/products/[slug]/briefs/Briefs.tsx';
import { Changes } from '../src/app/products/[slug]/changes/Changes.tsx';
import { FormNotice, errorOf } from '../src/app/products/[slug]/Tabs.tsx';
import { Checks } from '../src/app/products/[slug]/checks/Checks.tsx';
import { Doc } from '../src/app/products/[slug]/docs/[doc]/Doc.tsx';
import { Overview } from '../src/app/products/[slug]/overview/Overview.tsx';
import { Proposals } from '../src/app/products/[slug]/proposals/Proposals.tsx';
import { loadBriefs, loadChanges, loadChecks, loadDoc, loadOverview, loadProposals } from '../src/lib/reviewViews.ts';
import { type ProductView, getProductView, requestOrigin, sentDocument } from '../src/lib/views.ts';
import { NOW, type World, seedWorld } from './support/world.ts';

let t: TestDatabase;
let w: World;
let product: ProductView;
beforeAll(async () => {
  t = await createTestDatabase();
  w = await seedWorld(t.db);
  product = (await asDashboard((db) => getProductView(w.product.slug, db)))!;
});
afterAll(async () => t.drop());

/** Runs `fn` as the dashboard's role. */
const asDashboard = <T>(fn: (db: DbOrTx) => Promise<T>): Promise<T> =>
  t.db.transaction(async (tx) => {
    await tx.execute(sql`set local role agent_dashboard`);
    return fn(tx);
  });

/** The HTML with tags removed and spaces collapsed, for reading assertions. */
const text = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ');

describe('overview', () => {
  it('shows spend against the ceilings with the projection, the trend, outcomes, attribution and accounts', async () => {
    const data = await asDashboard((db) => loadOverview(db, product, NOW));
    expect(data.day).toBe('2026-10-15');
    const html = renderToStaticMarkup(createElement(Overview, { product, data }));
    const s = text(html);
    expect(s).toContain('Yesterday (2026-10-15) S$10.00 of S$25.00 (40%)');
    expect(s).toContain('Month to date (2026-10) S$150.00 of S$400.00 (37%)');
    expect(s).toContain('Projected for 2026-10 S$310.00 of S$400.00 (77%)');
    expect(s).toContain('the 15 days so far to all 31 days');
    // Four weeks: 18–24 Sep S$12 (no signup), 25 Sep–1 Oct S$10, 2–8 Oct S$70 / 1, 9–15 Oct S$70 / 2.
    expect(s).toContain('S$162.00 spent, 3 signups: S$54.00 each');
    expect(s).toContain('2026-09-18 to 2026-09-24 S$12.00 0 —');
    expect(s).toContain('2026-10-02 to 2026-10-08 S$70.00 1 S$70.00');
    expect(s).toContain('2026-10-09 to 2026-10-15 S$70.00 2 S$35.00');
    expect(data.trend.days).toHaveLength(28);
    // Outcomes: 3 signups (one by UTM: 33.3%), the test signup apart; 1 paid, not credited.
    expect(s).toMatch(
      /Signup · KPI 3 1 33\.3% platform ids 0 · click look-up 0 · UTM 1 · none found 0 · not looked at yet 2 1/,
    );
    expect(s).toMatch(/Paid 1 0 0% .* 0/);
    expect(s).toContain(`${w.account.externalId} “Main account” active 2026-10-16 08:30 (Asia/Singapore)`);
  });

  it('speaks of the KPI by its stage id, so a label with a note reads well', async () => {
    const settings = product.settings!;
    const labelled: ProductView = {
      ...product,
      settings: {
        ...settings,
        outcomes: {
          ...settings.outcomes,
          stages: settings.outcomes.stages.map((x) =>
            x.id === 'signup' ? { ...x, label: 'Signup (email link clicked)' } : x,
          ),
        },
      },
    };
    const data = await asDashboard((db) => loadOverview(db, labelled, NOW));
    const s = text(renderToStaticMarkup(createElement(Overview, { product: labelled, data })));
    expect(s).toContain('Cost per signup, last 28 days');
    expect(s).toContain('S$162.00 spent, 3 signups: S$54.00 each');
    expect(s).toContain('Signup (email link clicked) · KPI');
    expect(s).not.toContain('clicked)s');
  });

  it('says so when no ceiling is set, and when the stored settings are broken', async () => {
    const data = await asDashboard((db) => loadOverview(db, product, NOW));
    const broken: ProductView = { ...product, settings: null, issues: ['spend: required'] };
    const s = text(
      renderToStaticMarkup(
        createElement(Overview, {
          product: broken,
          data: { ...data, spend: { ...data.spend, dailyCeilingMicros: null } },
        }),
      ),
    );
    expect(s).toContain('S$10.00 no ceiling set');
    expect(s).toContain('stored settings have problems');
  });
});

describe('proposals', () => {
  it('shows each open proposal with its buttons, the decisions and the agree rate', async () => {
    const data = await asDashboard((db) => loadProposals(db, product, NOW));
    expect(data.pending.map((i) => i.proposal.shortId).sort()).toEqual(
      [w.proposals.pausePending, w.proposals.budgetPending, w.proposals.negativePending].map((p) => p.shortId).sort(),
    );
    expect(data.agree).toEqual({ days: 21, total: 5, approved: 1, rejected: 1, expired: 0, pending: 3 });
    const html = renderToStaticMarkup(createElement(Proposals, { product, data }));
    const s = text(html);
    expect(s).toContain('50% agreed: 1 approved (edits included), 1 rejected, 0 expired, 3 waiting, of 5');
    expect(s).toContain('Waiting for you (3)');
    expect(s).toContain(`Proposal ${w.proposals.pausePending.shortId} · v1 · zero_outcome_spend`);
    expect(s).toContain('Evidence (2026-10-05 to 2026-10-11, 7 days): spend S$20.00 · 40 clicks · 600 impressions');
    expect(s).toContain(
      `Pause ad group “Pool group” (google:${w.account.externalId}:ad_group:222) · status active → paused`,
    );
    expect(s).toContain('Cut the daily budget of campaign “Pool <b>Search</b>”');
    expect(s).toContain('S$20.00 → S$15.00 a day');
    expect(s).toContain('+ “free pool” (phrase match) blocked');
    // Platform text is escaped, never markup.
    expect(html).toContain('Pool &lt;b&gt;Search&lt;/b&gt;');
    expect(html).not.toContain('<b>Search</b>');
    // The buttons: approve carries the version and hash shown; edit only where the action takes one.
    expect(html).toContain(`value="${w.proposals.budgetPending.actionHash}"`);
    expect(html.match(/name="verb" value="approve"/g)).toHaveLength(3);
    expect(html.match(/name="verb" value="reject"/g)).toHaveLength(3);
    expect(html.match(/name="verb" value="edit_budget"/g)).toHaveLength(1);
    expect(html).toContain('name="budget"');
    expect(html).toContain('value="15"');
    expect(html.match(/name="verb" value="edit_text"/g)).toHaveLength(1);
    expect(html.match(/name="verb" value="edit_match"/g)).toHaveLength(1);
    // The decisions, newest first.
    expect(s).toContain('approved web:marcus@example.com via web applied');
    expect(s).toContain('rejected · “still learning” telegram:1001 via telegram rejected');
  });

  it('shows an expired proposal without buttons', async () => {
    const later = new Date('2026-10-30T00:00:00Z');
    const data = await asDashboard((db) => loadProposals(db, product, later));
    const html = renderToStaticMarkup(createElement(Proposals, { product, data }));
    expect(text(html)).toContain('Waiting for you (0)');
    expect(text(html)).toContain('Expired: it can no longer be decided.');
    expect(html).not.toContain('name="verb"');
  });
});

describe('changes', () => {
  it('lists the change log with a request-undo button for a change that can be undone', async () => {
    const data = await asDashboard((db) => loadChanges(db, product));
    const html = renderToStaticMarkup(createElement(Changes, { product, data }));
    const s = text(html);
    expect(s).toContain(
      `Add a negative keyword to ad group “Pool group” (google:${w.account.externalId}:ad_group:222)`,
    );
    expect(s).toContain('+ “jobs” (exact match) blocked');
    expect(s).toContain('web:marcus@example.com');
    expect(s).toContain('Request undo');
    expect(s).toContain('Remove a negative keyword from ad group “Pool group”');
    expect(html).toContain(`name="revisionId" value="${w.revisionId}"`);
  });

  it('explains an empty change log', () => {
    const s = text(renderToStaticMarkup(createElement(Changes, { product, data: { changes: [], names: new Map() } })));
    expect(s).toContain('No changes yet. Phase 1 applies nothing');
  });
});

describe('checks', () => {
  it('shows the trust-check history, the AI cost and drift', async () => {
    const data = await asDashboard((db) => loadChecks(db, product, NOW));
    const s = text(renderToStaticMarkup(createElement(Checks, { product, data })));
    expect(s).toContain('US$0.0234 over 1 cycle that used the AI');
    expect(s).toContain('2026-10-12 · weekly');
    expect(s).toContain(`id_capture warn (google:${w.account.externalId})`);
    expect(s).toContain('"capturedPct": 40');
    expect(s).toContain('daily_budget: "20000000" → "30000000"');
    expect(s).toContain('campaign “Pool <b>Search</b>”');
    expect(s).toContain('not yet');
  });

  it('marks a degraded cycle, and counts checks without a signal apart from passes', async () => {
    const data = await asDashboard((db) => loadChecks(db, product, NOW));
    const [first] = data.cycles;
    const quiet = {
      ...data,
      cycles: [
        {
          cycle: { ...first!.cycle, trustResult: 'degraded' as const },
          checks: first!.checks.map((c) => ({ ...c, result: c.result === 'warn' ? ('no_signal' as const) : c.result })),
        },
      ],
    };
    const html = renderToStaticMarkup(createElement(Checks, { product, data: quiet }));
    expect(html).toContain('<td class="bad">degraded</td>');
    expect(text(html)).toContain('1 passed, 1 no signal');
  });
});

describe('briefs', () => {
  it('shows each brief as text with its feedback form', async () => {
    const briefs = await asDashboard((db) => loadBriefs(db, product));
    const html = renderToStaticMarkup(createElement(Briefs, { product, briefs }));
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; is just text');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain(`name="briefId" value="${w.brief.id}"`);
    // What the page showed travels with the form, so only a changed answer is sent (F1).
    expect(html).toContain('name="usefulShown" value=""');
    expect(html).toContain('name="newInfoShown" value=""');
    expect(text(html)).toContain('👍 Useful: yes no (now: not answered)');
    expect(html).toContain('type="radio" name="useful" value="no"');
    expect(html).not.toMatch(/name="useful" value="(yes|no)" checked/); // unanswered: nothing preset
    expect(text(html)).toContain('Not sent to Telegram');
  });
});

describe('the form notice (F1)', () => {
  const notice = (q: Record<string, string | string[] | undefined>) =>
    text(renderToStaticMarkup(createElement(FormNotice, { error: errorOf(q) }))).trim();

  it('shows our words for a code, and never the text of a crafted ?error=', () => {
    expect(notice({ error: 'reject_reason' })).toBe(
      'Not sent: Reject: say why, in a few words (at least 3 characters).',
    );
    const crafted = notice({ error: 'Session expired: sign in again at evil.example' });
    expect(crafted).not.toContain('evil.example');
    expect(crafted).toBe('Not sent: The form was incomplete or out of date. Reload the page and try again.');
    expect(notice({})).toBe('');
    expect(notice({ error: ['reject_reason', 'x'] })).toBe('');
  });
});

describe('documents', () => {
  it('shows the editor on the latest version, and the history with who wrote each', async () => {
    const data = await asDashboard((db) => loadDoc(db, product, 'strategy'));
    const html = renderToStaticMarkup(createElement(Doc, { product, doc: 'strategy', versions: data.versions }));
    const s = text(html);
    expect(s).toContain('STRATEGY · version 1, by the seed');
    expect(html).toContain('name="baseVersion" value="1"');
    expect(html).toContain('# Strategy\nGrow.</textarea>');
    expect(s).toContain('Save as version 2');
    const empty = await asDashboard((db) => loadDoc(db, product, 'learnings'));
    expect(
      text(renderToStaticMarkup(createElement(Doc, { product, doc: 'learnings', versions: empty.versions }))),
    ).toContain('LEARNINGS · not written yet');
  });
});

describe('requestOrigin', () => {
  it('sends each request back to the screen it came from', async () => {
    const at = async (request: Parameters<typeof recordWebRequest>[1]['request']) => {
      const id = await asDashboard((db) => recordWebRequest(db, { request, email: 'marcus@example.com' }));
      return asDashboard((db) => requestOrigin(id, db));
    };
    const base = `/products/${w.product.slug}`;
    const p = w.proposals.budgetPending;
    expect(await at({ kind: 'approve', proposalId: p.id, version: 1, actionHash: p.actionHash })).toBe(
      `${base}/proposals`,
    );
    expect(await at({ kind: 'reject', proposalId: p.id, version: 1, reason: 'not now' })).toBe(`${base}/proposals`);
    expect(await at({ kind: 'undo', revisionId: w.revisionId })).toBe(`${base}/changes`);
    expect(await at({ kind: 'brief_feedback', briefId: w.brief.id, useful: true, newInfo: false })).toBe(
      `${base}/briefs`,
    );
    expect(
      await at({ kind: 'product_doc_put', productId: w.product.id, doc: 'playbook', baseVersion: 0, markdown: 'x' }),
    ).toBe(`${base}/docs/playbook`);
    expect(await at({ kind: 'facts_put', productId: w.product.id, offeringKey: 'a b', facts: {} })).toBe(
      `${base}/facts/a%20b`,
    );
    expect(await at({ kind: 'halt', productId: w.product.id })).toBe(`${base}/settings`);
    expect(await at({ kind: 'undo', revisionId: 'rev_unknown' })).toBe('/');
  });

  it("keeps a document request's text for its page, and nothing for other requests", async () => {
    const record = (request: Parameters<typeof recordWebRequest>[1]['request']) =>
      asDashboard((db) => recordWebRequest(db, { request, email: 'marcus@example.com' }));
    const doc = await record({
      kind: 'product_doc_put',
      productId: w.product.id,
      doc: 'strategy',
      baseVersion: 0,
      markdown: '# Ten minutes of edits',
    });
    const halt = await record({ kind: 'halt', productId: w.product.id });
    expect(await asDashboard((db) => sentDocument(doc, db))).toBe('# Ten minutes of edits');
    expect(await asDashboard((db) => sentDocument(halt, db))).toBeNull();
  });
});
