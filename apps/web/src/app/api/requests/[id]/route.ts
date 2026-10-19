// The request page polls this for the worker's verdict (LISTEN doesn't work through Neon's pooler).
import { getRequestStatus, NotFoundError } from '@ads/db';
import { db, requireOperator, UnauthorizedError } from '../../../../lib/server.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    await requireOperator();
  } catch (error) {
    if (error instanceof UnauthorizedError) return new Response('Unauthorized', { status: 401 });
    throw error;
  }
  const { id } = await ctx.params;
  if (!UUID.test(id)) return Response.json({ error: 'not a request id' }, { status: 400 });
  try {
    return Response.json(await getRequestStatus(db(), id), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof NotFoundError) return Response.json({ error: 'no such request' }, { status: 404 });
    throw error;
  }
}
