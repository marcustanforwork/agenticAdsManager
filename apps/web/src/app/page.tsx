// Home: the products, their status and settings version, and the way to each one's screens.
import { listProductRows } from '../lib/views.ts';
import { requireOperator } from '../lib/server.ts';

export default async function Home() {
  const operator = await requireOperator();
  const products = await listProductRows();
  return (
    <>
      <h1>Products</h1>
      <p className="muted">Signed in as {operator.email}.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Status</th>
              <th>Settings</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.name} <span className="muted">({p.slug})</span>
                </td>
                <td>{p.status}</td>
                <td>v{p.settingsVersion}</td>
                <td>
                  <a href={`/products/${p.slug}/overview`}>Overview</a> ·{' '}
                  <a href={`/products/${p.slug}/proposals`}>Proposals</a> ·{' '}
                  <a href={`/products/${p.slug}/settings`}>Settings</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
