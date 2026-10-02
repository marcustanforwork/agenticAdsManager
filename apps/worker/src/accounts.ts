// `ads accounts …`: link a product's ad accounts and mark them paused or active. Setup, like `credentials`:
// these write the accounts table only, and never touch an ad account.
import {
  schema,
  findAccount,
  findProductBySlug,
  listAccounts,
  NotFoundError,
  setAccountStatus,
  upsertAccount,
  type DbOrTx,
} from '@ads/db';
import { Command, InvalidArgumentError, Option } from 'commander';

type Platform = 'meta' | 'google';
type AccountStatus = (typeof schema.ACCOUNT_STATUSES)[number];

const ACCOUNT_ID: Record<Platform, RegExp> = { meta: /^act_\d+$/, google: /^\d{10}$/ };

function checkAccountId(platform: Platform, id: string): string {
  if (!ACCOUNT_ID[platform].test(id)) {
    throw new InvalidArgumentError(
      platform === 'meta' ? 'a Meta ad account id looks like act_<digits>' : 'a Google customer id is 10 digits',
    );
  }
  return id;
}

async function productId(db: DbOrTx, slug: string): Promise<string> {
  const product = await findProductBySlug(db, slug);
  if (!product) throw new NotFoundError('product', slug);
  return product.id;
}

export async function linkAccount(
  db: DbOrTx,
  input: { product: string; platform: Platform; account: string },
): Promise<string> {
  const id = await productId(db, input.product);
  const externalId = checkAccountId(input.platform, input.account);
  const existing = await findAccount(db, input.platform, externalId);
  if (existing && existing.productId !== id)
    throw new Error(`${input.platform}:${externalId} is linked to another product`);
  if (existing) return `${input.platform}:${externalId} is already linked to ${input.product} (${existing.status})`;
  await upsertAccount(db, { productId: id, platform: input.platform, externalId });
  return `linked ${input.platform}:${externalId} to ${input.product}`;
}

export async function listProductAccounts(db: DbOrTx, product: string): Promise<string[]> {
  const rows = await listAccounts(db, await productId(db, product));
  if (rows.length === 0) return [`no accounts are linked to ${product}`];
  return rows.map(
    (a) =>
      `${a.platform}:${a.externalId}  ${a.status}  ${a.timezone ?? '-'}  ${a.currency ?? '-'}  last synced ${a.lastSyncedAt?.toISOString() ?? 'never'}`,
  );
}

export async function setStatus(
  db: DbOrTx,
  input: { product: string; platform: Platform; account: string; status: AccountStatus },
): Promise<string> {
  const id = await productId(db, input.product);
  const existing = await findAccount(db, input.platform, checkAccountId(input.platform, input.account));
  if (!existing || existing.productId !== id)
    throw new NotFoundError(`${input.product} account`, `${input.platform}:${input.account}`);
  await setAccountStatus(db, existing.id, input.status);
  return `${input.platform}:${input.account} is now ${input.status}`;
}

/** The commands. `withDb` opens and closes the database; `product` reads the global --product option. */
export function accountsCommand(
  withDb: <T>(run: (db: DbOrTx) => Promise<T>) => Promise<T>,
  product: () => string,
  print: (line: string) => void,
): Command {
  const accounts = new Command('accounts').description("link a product's ad accounts (setup; needs DATABASE_URL)");
  const platform = () =>
    new Option('--platform <platform>', 'which platform').choices(['meta', 'google']).makeOptionMandatory();

  accounts
    .command('link')
    .description('link an ad account to the product')
    .addOption(platform())
    .requiredOption('--account <id>', 'Meta act_<digits> or Google customer id')
    .action(async (opts: { platform: Platform; account: string }) => {
      print(await withDb((db) => linkAccount(db, { product: product(), ...opts })));
    });

  accounts
    .command('list')
    .description("list the product's accounts")
    .action(async () => {
      for (const line of await withDb((db) => listProductAccounts(db, product()))) print(line);
    });

  accounts
    .command('set-status')
    .description('mark an account paused (syncs skip it), active, or disconnected')
    .addOption(platform())
    .requiredOption('--account <id>', 'Meta act_<digits> or Google customer id')
    .addOption(
      new Option('--status <status>', 'the new status').choices([...schema.ACCOUNT_STATUSES]).makeOptionMandatory(),
    )
    .action(async (opts: { platform: Platform; account: string; status: AccountStatus }) => {
      print(await withDb((db) => setStatus(db, { product: product(), ...opts })));
    });

  return accounts;
}
