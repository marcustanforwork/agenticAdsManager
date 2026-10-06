// The Google quota meter (BLUEPRINT §5.7 "Quota", M03 build 4): every Google request first counts itself in
// `api_usage`, and a soft cap on the day's total across every Google account stops the sync with a clear error.
import { GOOGLE_SYNC_SOFT_CAP, GoogleQuotaError, type QuotaMeter, quotaDay } from '@ads/connector-google';
import { type DbOrTx, addApiUsage, sumApiUsage } from '@ads/db';
import { sql } from 'drizzle-orm';

export interface ApiUsageMeterInput {
  db: DbOrTx;
  /** The account the requests are made for (whose `api_usage` row counts them). */
  accountExternalId: string;
  cap?: number;
  now?: () => Date;
}

export function apiUsageMeter(input: ApiUsageMeterInput): QuotaMeter {
  const cap = input.cap ?? GOOGLE_SYNC_SOFT_CAP;
  const now = input.now ?? (() => new Date());
  return {
    async consume(operations: number): Promise<void> {
      const date = quotaDay(now());
      // One transaction under an advisory lock, so two processes can't both pass the check at the cap.
      await input.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('api_usage:google'))`);
        const used = await sumApiUsage(tx, { platform: 'google', date });
        if (used + operations > cap) {
          throw new GoogleQuotaError(
            `the soft cap is reached: ${used} of ${cap} operations used on ${date} (UTC) across all Google accounts; ` +
              'the sync stops and resumes tomorrow',
          );
        }
        await addApiUsage(tx, { platform: 'google', accountExternalId: input.accountExternalId, date, operations });
      });
    },
  };
}
