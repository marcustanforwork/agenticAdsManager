// The Telegram bot's conversation state (BLUEPRINT §5.15): one row per chat, e.g. "waiting for the reason to reject
// proposal X v2". The bot validates the state it reads (it may be from an older build); this layer only stores it,
// with an expiry: a state past it reads as none.
import { eq, sql } from 'drizzle-orm';
import type { DbOrTx } from '../client.ts';
import { telegramConversations } from '../schema.ts';

/** How long a conversation state lasts (§5.15). */
export const CONVERSATION_TTL_MS = 10 * 60_000;

/** The chat's state, or null if there is none or it has expired. */
export async function getConversation(db: DbOrTx, chatId: number, now: Date = new Date()): Promise<unknown> {
  const [row] = await db
    .select({ json: sql<string>`${telegramConversations.state}::text`, expiresAt: telegramConversations.expiresAt })
    .from(telegramConversations)
    .where(eq(telegramConversations.chatId, chatId));
  if (row === undefined || row.expiresAt.getTime() <= now.getTime()) return null;
  return JSON.parse(row.json) as unknown;
}

/** Sets the chat's state (replacing any other), valid for `ttlMs` from `now`. */
export async function setConversation(
  db: DbOrTx,
  chatId: number,
  state: Record<string, unknown>,
  opts: { now?: Date; ttlMs?: number } = {},
): Promise<void> {
  const now = opts.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (opts.ttlMs ?? CONVERSATION_TTL_MS));
  await db
    .insert(telegramConversations)
    .values({ chatId, state, expiresAt, updatedAt: now })
    .onConflictDoUpdate({ target: telegramConversations.chatId, set: { state, expiresAt, updatedAt: now } });
}

/** Ends the chat's conversation. Returns whether there was a live state. */
export async function clearConversation(db: DbOrTx, chatId: number, now: Date = new Date()): Promise<boolean> {
  const rows = await db
    .delete(telegramConversations)
    .where(eq(telegramConversations.chatId, chatId))
    .returning({ expiresAt: telegramConversations.expiresAt });
  return rows.some((r) => r.expiresAt.getTime() > now.getTime());
}
