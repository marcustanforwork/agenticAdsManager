// Next.js 16's request proxy (the file once called middleware.ts; it always runs on Node.js). Fails closed: every
// request needs a valid Cloudflare Access token. Pages and server actions check it again (lib/operator.ts), so a
// proxy bypass alone opens nothing.
import { NextResponse, type NextRequest } from 'next/server';
import { gate } from './lib/gate.ts';

export async function proxy(request: NextRequest): Promise<Response> {
  return (await gate(request.headers)) ?? NextResponse.next();
}
