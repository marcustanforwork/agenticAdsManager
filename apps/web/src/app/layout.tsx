// The dashboard's frame. Every page is rendered per request (no caching: it shows live settings), and checks the
// signed-in operator itself, besides the proxy.
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = { title: 'Ads Agent', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <a href="/" className="brand">
            Ads Agent
          </a>
          <span className="muted">settings · every change is a request the worker checks</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
