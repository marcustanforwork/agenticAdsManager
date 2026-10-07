ALTER TABLE "findings" ALTER COLUMN "target_entity_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "target_account_id" uuid;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_target_account_id_accounts_id_fk" FOREIGN KEY ("target_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_one_target_check" CHECK ("findings"."target_entity_id" is null or "findings"."target_account_id" is null);