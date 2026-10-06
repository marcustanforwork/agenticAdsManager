ALTER TABLE "accounts" ADD COLUMN "trust_signals" jsonb;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "last_sync_error" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "clicks_synced_through" date;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_clicks_synced_through_check" CHECK ("accounts"."clicks_synced_through" is null or "accounts"."platform" = 'google');