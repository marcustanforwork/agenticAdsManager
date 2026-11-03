// What the agent's read-only login on SnapPool's database may read of SnapPool's purchases (F4, D-096,
// SNAPPOOL-TRACKING §2.1). Marcus runs it once on SnapPool's production branch (a live step; T6a made the login and
// granted it `pool_requests`, `hosts` and `events`). Columns only: never card references or URLs, fees, net amounts,
// the buyer's country, or anything else on these tables. The adapter's tests run as a role with exactly this grant,
// so a query that needs one more column fails there first.

/** The login T6a created on SnapPool's database. */
export const SNAPPOOL_READ_ROLE = 'ads_agent_ro';

/** The columns the adapter reads, per table. */
export const PURCHASE_COLUMNS = {
  orders: [
    'id',
    'host_id',
    'currency',
    'amount_minor',
    'livemode',
    'paid_at',
    'attribution',
    'subscription_id',
    'deferred_charge_id',
  ],
  refunds: ['id', 'order_id', 'status', 'currency', 'amount_minor', 'created_at'],
  deferred_event_charges: ['id', 'host_id', 'pool_request_id', 'livemode', 'saved_at'],
  billing_subscriptions: ['id', 'host_id', 'pool_request_id', 'livemode', 'status', 'created_at'],
} as const;

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/** The `grant` statements, one per table, for `role` (default: the agent's login). */
export function purchasesGrantSql(role: string = SNAPPOOL_READ_ROLE): string {
  if (!IDENTIFIER.test(role)) throw new Error(`not a plain role name: ${role}`);
  return Object.entries(PURCHASE_COLUMNS)
    .map(([table, columns]) => `grant select (${columns.join(', ')}) on ${table} to ${role};`)
    .join('\n');
}
