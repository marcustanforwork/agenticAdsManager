// The product's screens.
import type { ProductRow } from '../../../lib/views.ts';

export function ProductHeader({ product, current }: { product: ProductRow; current: string }) {
  const tabs = [
    ['settings', 'Settings'],
    ['history', 'Settings history'],
    ['facts', 'Facts'],
  ] as const;
  return (
    <>
      <h1>
        {product.name} <span className="muted">· {product.status}</span>
      </h1>
      <nav className="tabs">
        {tabs.map(([path, label]) =>
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
