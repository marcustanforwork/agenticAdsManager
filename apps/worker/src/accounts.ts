// `ads accounts …`: link a product's ad accounts and mark them paused or active. Setup, like `credentials`:
// these write the accounts table only, and never touch an ad account.
import {
  schema,
  findAccount,
  findProductBySlug,
  listAccounts,
  NotFoundError,
  setAccountLoginCustomerId,
  setAccountStatus,
  upsertAccount,
  type DbOrTx,
} from '@ads/db';
import { ACCOUNT_ID_HINTS, ACCOUNT_ID_PATTERNS } from '@ads/contracts';
import { Command, InvalidArgumentError, Option } from 'commander';

type Platform = 'meta' | 'google';
type AccountStatus = (typeof schema.ACCOUNT_STATUSES)[number];

export function checkAccountId(platform: Platform, id: string): string {
  if (!ACCOUNT_ID_PATTERNS[platform].test(id)) throw new InvalidArgumentError(ACCOUNT_ID_HINTS[platform]);
  return id;
}

async function productId(db: DbOrTx, slug: string): Promise<string> {
  const product = await findProductBySlug(db, slug);
  if (!product) throw new NotFoundError('product', slug);
  return product.id;
}

/** Google only: the manager account to act through (`login-customer-id`, M03). */
export function checkManager(platform: Platform, manager: string | null | undefined): string | null | undefined {
  if (manager === undefined) return undefined;
  if (platform !== 'google') throw new InvalidArgumentError('--manager is for Google accounts only');
  if (manager === null) return null; // --no-manager: act on the account directly
  if (!ACCOUNT_ID_PATTERNS.google.test(manager))
    throw new InvalidArgumentError(`--manager: ${ACCOUNT_ID_HINTS.google}`);
  return manager;
}

export async function linkAccount(
  db: DbOrTx,
  input: { product: string; platform: Platform; account: string; manager?: string | null },
): Promise<string> {
  const id = await productId(db, input.product);
  const externalId = checkAccountId(input.platform, input.account);
  const manager = checkManager(input.platform, input.manager);
  const via = manager === undefined ? '' : manager === null ? ', with direct access' : ` through manager ${manager}`;
  const existing = await findAccount(db, input.platform, externalId);
  if (existing && existing.productId !== id)
    throw new Error(`${input.platform}:${externalId} is linked to another product`);
  if (existing) {
    if (manager === undefined || manager === existing.loginCustomerId) {
      return `${input.platform}:${externalId} is already linked to ${input.product} (${existing.status})`;
    }
    await setAccountLoginCustomerId(db, existing.id, manager);
    return `${input.platform}:${externalId} is linked to ${input.product}${via}`;
  }
  const account = await upsertAccount(db, { productId: id, platform: input.platform, externalId });
  if (manager !== undefined && manager !== null) await setAccountLoginCustomerId(db, account.id, manager);
  return `linked ${input.platform}:${externalId} to ${input.product}${via}`;
}

export async function listProductAccounts(db: DbOrTx, product: string): Promise<string[]> {
  const rows = await listAccounts(db, await productId(db, product));
  if (rows.length === 0) return [`no accounts are linked to ${product}`];
  return rows.map(
    (a) =>
      `${a.platform}:${a.externalId}  ${a.status}  ${a.timezone ?? '-'}  ${a.currency ?? '-'}  last synced ${a.lastSyncedAt?.toISOString() ?? 'never'}${a.loginCustomerId ? `  via manager ${a.loginCustomerId}` : ''}`,
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
    .option('--manager <id>', 'Google only: the manager account (MCC) id to act through, 10 digits')
    .option('--no-manager', 'Google only: forget the stored manager and act on the account directly')
    .action(async (opts: { platform: Platform; account: string; manager?: string | false }) => {
      const manager = checkManager(opts.platform, opts.manager === false ? null : opts.manager);
      const input = {
        product: product(),
        platform: opts.platform,
        account: checkAccountId(opts.platform, opts.account),
        ...(manager === undefined ? {} : { manager }),
      };
      print(await withDb((db) => linkAccount(db, input)));
    });

  accounts
    .command('list')
    .description("list the product's accounts")
    .action(async () => {
      const slug = product();
      for (const line of await withDb((db) => listProductAccounts(db, slug))) print(line);
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
      const input = { product: product(), ...opts, account: checkAccountId(opts.platform, opts.account) };
      print(await withDb((db) => setStatus(db, input)));
    });

  return accounts;
}
