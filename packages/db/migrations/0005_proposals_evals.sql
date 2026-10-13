CREATE TABLE "analyst_runs" (
	"cycle_id" uuid PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"record" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"finding_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"finding_type" text NOT NULL,
	"target" text NOT NULL,
	"negative_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_cases_proposal_id_unique" UNIQUE("proposal_id"),
	CONSTRAINT "eval_cases_decision_check" CHECK (decision in ('approve','reject'))
);
--> statement-breakpoint
ALTER TABLE "analyst_runs" ADD CONSTRAINT "analyst_runs_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyst_runs" ADD CONSTRAINT "analyst_runs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analyst_runs_product_id_created_at_index" ON "analyst_runs" USING btree ("product_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "eval_cases_product_id_created_at_index" ON "eval_cases" USING btree ("product_id","created_at" DESC NULLS LAST);