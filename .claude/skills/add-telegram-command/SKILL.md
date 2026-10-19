---
name: add-telegram-command
description: Add or change a Telegram bot command or button (apps/worker/src/telegram): the command table and its grammar, callback data (≤ 64 bytes, versioned, never changed once sent), the operator request it records, the user-id check, the reply and its tests. Use when a milestone adds a command or a button (M11b's applied/failed card states, M14's /budget, M15b's copy cards), when the menu or help changes, or when Marcus asks "can I do X from Telegram", "add a command", "the bot doesn't understand Y".
---

# Add a Telegram command or button

The bot is a surface: it only reads the database and records **operator requests** through the one processor (`submitRequest`, invariant 9). It never calls a platform, never applies a change and never validates a setting itself (BLUEPRINT §5.4). Layout (M09b):

| File | What |
|---|---|
| `commands.ts` | `COMMANDS`, the one table of commands (name, aliases, usage, help, handler); `parseCommand`, `handleCommand` (faults answered and logged), `MENU`; halt, resume, the quick settings, help |
| `pause.ts` | `/pause` (entity resolution, never a guess), `/pause_all` (one card for the set), their buttons `v1:pick|allok|allno:<uuid>:0` |
| `views.ts` | read-only commands, `/changes`, `/undo`, `changeHtml` (an action in words) |
| `reply.ts` | `reply` (chunked HTML), `submitAsOwner`, `pickProduct` / `splitProduct` (never a guess between products) |
| `cards.ts`, `decide.ts` | proposal cards and their Approve / Reject / Edit (M09a); operator cards show Confirm / Cancel on the same verbs |
| `bot.ts` | `handleCallback` (routes by callback-data shape), the outbox; `feedback.ts` the brief's buttons |
| `grammy.ts` | glue only: polling and `setMyCommands` |

## 1. A command

1. **Name.** Telegram's menu allows only `[a-z0-9_]{1,32}` (`BotCommand`, GOTCHAS), so the canonical name uses underscores; add the plan's spelling (with hyphens) as an alias. Descriptions ≤ 256 characters.
2. **Grammar.** Arguments are words after the name (`/name@bot` is accepted). Products: `pickProduct(ctx, slug)` or `splitProduct` when the product is optional; with no slug only the single non-dormant product is used, otherwise ask. Entities: reuse `findEntities` (ref, then exact id, then name fragment ≥ 2 characters); several matches → buttons. **Never guess.** Bad arguments → reply with the usage and return `'usage'`, recording nothing.
3. **The request.** Build the `OperatorRequest` and call `submitAsOwner(ctx, request)`. Refused → reply with `reasonOf(outcome)`, return `'refused'`. A new request kind needs its handler first (`core/src/requests/handlers.ts` or `operator.ts`; remove it from `NOT_AVAILABLE_UNTIL`; tests in `core/test/requests.test.ts`).
4. **The reply.** HTML, every piece of platform or user text through `escapeHtml` (names, keywords, slugs). Money via `formatMoney` from micros: never floats (invariant 6). Figures come from the database, never from a model.
5. **Register** it in `COMMANDS` (the order is the help's and the menu's). `MENU` and `/help` follow automatically.

## 2. A button

- Callback data is `v1:<verb>:<id>:<n>` and **at most 64 bytes**. Proposal cards use the short id and version (`v1:approve:abcdefgh:3`); others a uuid with `:0`. Write a `…Data` builder and a strict `parse…Data` regex, and route it in `bot.ts` `handleCallback` **before** the brief-feedback fallback.
- **Stable forever:** cards already in Marcus's chat carry old data. Add a verb; never change or reuse one. Bump to `v2:` only with a parser that still accepts `v1:`.
- A press re-checks everything through the processor (version, hash, expiry) and then re-renders its message from the database (`editMessageText`; a failed edit only logs).

## 3. Who may use it

`handleMessage` and `handleCallback` already ignore anything not from `ctx.ownerId` in a private chat, and the processor checks the actor (`telegram:<id>` in the allowed actors). Don't add a second path around them.

## 4. Tests (`apps/worker/test/commands.test.ts`)

With the fake `TelegramApi` and a test database:
- the grammar: parses, aliases, usage on bad arguments (and no request recorded: count `operator_requests`);
- the happy path records the request as Marcus and replies with the result; a refusal shows the processor's reason;
- callback data ≤ 64 bytes and round-trips; garbage parses to null;
- names with `<`, `&` are escaped; nothing is guessed when two things match;
- someone else's message or press is ignored.

Then `preflight`. Update BLUEPRINT M09b's "As built" grammar and the milestone file when the grammar changes.
