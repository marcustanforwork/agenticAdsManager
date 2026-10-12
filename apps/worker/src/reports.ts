// `ads digest` and `ads brief` (M07): read-only previews. The digest is built now, from the database, and printed
// with the send rule's answer; nothing is queued. The brief is the latest one stored (or a given cycle's), as the
// markdown Telegram gets, with how its prose was written. Sending is the worker's job.
import { buildDigest, renderDigest, shouldSendDigest } from '@ads/core';
import { type Db, NotFoundError, findCycleBrief, findProductBySlug, listBriefs } from '@ads/db';
import { Command, InvalidArgumentError } from 'commander';

const uuid = (value: string): string => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new InvalidArgumentError('a cycle id (a UUID, as `ads cycle` prints it)');
  }
  return value;
};

export function reportCommands(
  withDb: <T>(run: (db: Db) => Promise<T>) => Promise<T>,
  requireProduct: () => string,
  deps: { print: (line: string) => void; now: () => Date },
): Command[] {
  const digest = new Command('digest')
    .description(
      "preview today's digest from the database (no AI, nothing sent or queued): its text and whether the " +
        "product's notifications.digest setting would send it",
    )
    .action(async () => {
      const slug = requireProduct();
      await withDb(async (db) => {
        const product = await findProductBySlug(db, slug);
        if (!product) throw new NotFoundError('product', slug);
        const data = await buildDigest(db, { product, now: deps.now(), cycle: null });
        const setting = product.settings.notifications.digest;
        deps.print(
          JSON.stringify(
            {
              product: slug,
              day: data.day,
              setting,
              wouldSend: shouldSendDigest(setting, data),
              text: renderDigest(data),
            },
            null,
            2,
          ),
        );
      });
    });

  const brief = new Command('brief')
    .description(
      "print the product's latest brief (or a cycle's) as stored: its markdown and how its prose was written",
    )
    .option('--cycle <id>', 'the cycle whose brief to print', uuid)
    .action(async (opts: { cycle?: string }) => {
      const slug = requireProduct();
      await withDb(async (db) => {
        const product = await findProductBySlug(db, slug);
        if (!product) throw new NotFoundError('product', slug);
        const row =
          opts.cycle === undefined
            ? ((await listBriefs(db, product.id, 1))[0] ?? null)
            : await findCycleBrief(db, opts.cycle);
        if (row === null || row.productId !== product.id) {
          throw new NotFoundError('brief', opts.cycle === undefined ? `${slug} (none yet)` : `cycle ${opts.cycle}`);
        }
        const numbers = row.numbers as { writer?: unknown };
        deps.print(
          JSON.stringify(
            {
              product: slug,
              briefId: row.id,
              cycleId: row.cycleId,
              kind: row.kind,
              createdAt: row.createdAt.toISOString(),
              sentAt: row.sentAt?.toISOString() ?? null,
              usedTemplateFallback: row.usedTemplateFallback,
              writer: numbers.writer ?? null,
              feedback: { useful: row.feedbackUseful, newInfo: row.feedbackNewInfo },
              markdown: row.markdown,
            },
            null,
            2,
          ),
        );
      });
    });
  return [digest, brief];
}
