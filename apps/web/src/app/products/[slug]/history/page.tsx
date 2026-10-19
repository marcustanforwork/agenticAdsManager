// Every settings version, newest first: who asked for it, from where, and what changed from the version before.
import { localTime } from '@ads/contracts';
import { listSettingsChanges } from '@ads/db';
import { notFound } from 'next/navigation';
import { changedPaths } from '../../../../lib/history.ts';
import { db, requireOperator } from '../../../../lib/server.ts';
import { getProductView } from '../../../../lib/views.ts';
import { ProductHeader } from '../Tabs.tsx';

const show = (v: unknown): string => (v === undefined ? '(not set)' : JSON.stringify(v));

export default async function HistoryPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireOperator();
  const product = await getProductView((await params).slug);
  if (product === null) notFound();
  const versions = await listSettingsChanges(db(), product.id);
  return (
    <>
      <ProductHeader product={product} current="history" />
      {versions.map((v, i) => {
        const previous = versions[i + 1];
        const changes = previous === undefined ? [] : changedPaths(previous.settings, v.settings);
        return (
          <section className="card" key={v.version}>
            <h2>
              Version {v.version} <span className="muted">· {localTime(v.changedAt, product.timezone)}</span>
            </h2>
            <p className="muted">
              {v.requestId === null ? 'Initial settings (seed)' : `By ${v.actor ?? '?'} via ${v.channel ?? '?'}`}
            </p>
            {previous === undefined ? (
              <details>
                <summary>The settings</summary>
                <pre>{JSON.stringify(v.settings, null, 2)}</pre>
              </details>
            ) : changes.length === 0 ? (
              <p className="muted">No change from version {previous.version}.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Setting</th>
                      <th>Before</th>
                      <th>After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changes.map((c) => (
                      <tr key={c.path}>
                        <td>{c.path}</td>
                        <td>
                          <code>{show(c.before)}</code>
                        </td>
                        <td>
                          <code>{show(c.after)}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
