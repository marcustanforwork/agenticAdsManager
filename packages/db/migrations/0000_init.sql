CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"external_id" text NOT NULL,
	"name" text,
	"timezone" text,
	"currency" char(3),
	"status" text DEFAULT 'active' NOT NULL,
	"last_synced_at" timestamp with time zone,
	CONSTRAINT "accounts_platform_external_id_unique" UNIQUE("platform","external_id"),
	CONSTRAINT "accounts_platform_check" CHECK (platform in ('google','meta')),
	CONSTRAINT "accounts_status_check" CHECK (status in ('active','paused','disconnected'))
);
--> statement-breakpoint
CREATE TABLE "ad_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"type" text NOT NULL,
	"external_id" text NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"raw_status" text NOT NULL,
	"daily_budget_micros" bigint,
	"budget_shared" boolean DEFAULT false NOT NULL,
	"offering_id" uuid,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by_us" boolean DEFAULT false NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ad_entities_account_id_type_external_id_unique" UNIQUE("account_id","type","external_id"),
	CONSTRAINT "ad_entities_type_check" CHECK (type in ('campaign','ad_group','ad','keyword','budget'))
);
--> statement-breakpoint
CREATE TABLE "ad_entity_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"ad_entity_id" uuid NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"snapshot" jsonb NOT NULL,
	"hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_usage" (
	"platform" text NOT NULL,
	"account_external_id" text NOT NULL,
	"date" date NOT NULL,
	"operations" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "api_usage_platform_account_external_id_date_pk" PRIMARY KEY("platform","account_external_id","date")
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"proposal_version" integer NOT NULL,
	"action_hash" text NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"actor" text NOT NULL,
	"channel" text NOT NULL,
	"request_id" uuid,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_proposal_id_proposal_version_unique" UNIQUE("proposal_id","proposal_version"),
	CONSTRAINT "approvals_decision_check" CHECK (decision in ('approve','reject')),
	CONSTRAINT "approvals_channel_check" CHECK (channel in ('telegram','web','cli','policy')),
	CONSTRAINT "approvals_reject_reason_check" CHECK ("approvals"."decision" <> 'reject' or "approvals"."reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"cycle_id" uuid,
	"kind" text NOT NULL,
	"numbers" jsonb NOT NULL,
	"markdown" text NOT NULL,
	"used_template_fallback" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"feedback_useful" boolean,
	"feedback_new_info" boolean,
	CONSTRAINT "briefs_kind_check" CHECK (kind in ('weekly','diagnostic'))
);
--> statement-breakpoint
CREATE TABLE "change_log" (
	"revision_id" text PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"action" jsonb NOT NULL,
	"undo" jsonb,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by" text NOT NULL,
	"verified" boolean NOT NULL,
	"reverted_by_revision_id" text
);
--> statement-breakpoint
CREATE TABLE "credential_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credential_id" uuid NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"process" text NOT NULL,
	"purpose" text NOT NULL,
	CONSTRAINT "credential_access_process_check" CHECK (process in ('worker','gateway','cli'))
);
--> statement-breakpoint
CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"role" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"data_key_ciphertext" "bytea" NOT NULL,
	"master_key_id" text NOT NULL,
	"rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credentials_account_id_role_unique" UNIQUE("account_id","role"),
	CONSTRAINT "credentials_role_check" CHECK (role in ('read','write','feedback'))
);
--> statement-breakpoint
CREATE TABLE "cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"cycle_date" date NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"stage_reached" text DEFAULT 'started' NOT NULL,
	"trust_result" text,
	"model_cost_micros" bigint DEFAULT 0 NOT NULL,
	"lookups" integer DEFAULT 0 NOT NULL,
	"error" text,
	CONSTRAINT "cycles_kind_check" CHECK (kind in ('daily','weekly','manual')),
	CONSTRAINT "cycles_stage_reached_check" CHECK (stage_reached in ('started','synced','trust_checked','detected','analysed','drafted','reported','done')),
	CONSTRAINT "cycles_trust_result_check" CHECK (trust_result in ('ok','degraded','fail'))
);
--> statement-breakpoint
CREATE TABLE "drift_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"ad_entity_id" uuid NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"field" text NOT NULL,
	"expected" jsonb,
	"observed" jsonb,
	"acknowledged_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"target_entity_id" uuid NOT NULL,
	"analyst_verdict" text,
	"dismissed_reason" text,
	"summary" text NOT NULL,
	"why_now" text,
	"evidence" jsonb NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"params" jsonb,
	"confidence" text,
	"passed_threshold" boolean NOT NULL,
	"proposed_action" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "findings_source_check" CHECK (source in ('detector','analyst')),
	CONSTRAINT "findings_analyst_verdict_check" CHECK (analyst_verdict in ('confirmed','dismissed','added'))
);
--> statement-breakpoint
CREATE TABLE "google_clicks" (
	"product_id" uuid NOT NULL,
	"gclid" text PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"campaign_external_id" text NOT NULL,
	"ad_group_external_id" text
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"queue" text DEFAULT 'worker' NOT NULL,
	"kind" text NOT NULL,
	"product_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"leased_until" timestamp with time zone,
	"leased_by" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_queue_check" CHECK (queue in ('worker','gateway')),
	CONSTRAINT "jobs_status_check" CHECK (status in ('queued','running','done','failed'))
);
--> statement-breakpoint
CREATE TABLE "metrics_daily" (
	"product_id" uuid NOT NULL,
	"ad_entity_id" uuid NOT NULL,
	"date" date NOT NULL,
	"impressions" bigint DEFAULT 0 NOT NULL,
	"clicks" bigint DEFAULT 0 NOT NULL,
	"spend_micros" bigint DEFAULT 0 NOT NULL,
	"platform_conversions" numeric DEFAULT '0' NOT NULL,
	"platform_conversion_value_micros" bigint DEFAULT 0 NOT NULL,
	"restated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "metrics_daily_ad_entity_id_date_pk" PRIMARY KEY("ad_entity_id","date")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "offerings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"facts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"facts_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offerings_product_id_key_unique" UNIQUE("product_id","key")
);
--> statement-breakpoint
CREATE TABLE "operator_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"actor" text NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "operator_requests_channel_check" CHECK (channel in ('telegram','web','cli')),
	CONSTRAINT "operator_requests_status_check" CHECK (status in ('queued','done','refused'))
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"stage" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"value_micros" bigint,
	"currency" char(3),
	"is_test" boolean DEFAULT false NOT NULL,
	"ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"hashed_contact" jsonb,
	"attributed_entity_id" uuid,
	"attribution_method" text,
	"fed_back_google_at" timestamp with time zone,
	"fed_back_meta_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outcomes_product_id_source_id_stage_unique" UNIQUE("product_id","source_id","stage"),
	CONSTRAINT "outcomes_attribution_method_check" CHECK (attribution_method in ('platform_ids','gclid_lookup','utm','none'))
);
--> statement-breakpoint
CREATE TABLE "pack_manifests" (
	"pack_id" text NOT NULL,
	"version" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pack_manifests_pack_id_version_pk" PRIMARY KEY("pack_id","version")
);
--> statement-breakpoint
CREATE TABLE "product_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"doc" text NOT NULL,
	"version" integer NOT NULL,
	"markdown" text NOT NULL,
	"request_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_docs_product_id_doc_version_unique" UNIQUE("product_id","doc","version"),
	CONSTRAINT "product_docs_doc_check" CHECK (doc in ('strategy','playbook','learnings'))
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"pack_id" text NOT NULL,
	"currency" char(3) DEFAULT 'SGD' NOT NULL,
	"timezone" text DEFAULT 'Asia/Singapore' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"settings" jsonb NOT NULL,
	"settings_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_slug_unique" UNIQUE("slug"),
	CONSTRAINT "products_slug_check" CHECK ("products"."slug" ~ '^[a-z][a-z0-9-]*$'),
	CONSTRAINT "products_status_check" CHECK (status in ('active','halted','dormant'))
);
--> statement-breakpoint
CREATE TABLE "proposal_versions" (
	"proposal_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"action" jsonb NOT NULL,
	"action_hash" text NOT NULL,
	"undo" jsonb,
	"precondition_hash" text,
	"request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proposal_versions_proposal_id_version_pk" PRIMARY KEY("proposal_id","version")
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"short_id" text NOT NULL,
	"product_id" uuid NOT NULL,
	"cycle_id" uuid,
	"finding_id" uuid,
	"origin" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"action" jsonb NOT NULL,
	"action_hash" text NOT NULL,
	"undo" jsonb,
	"reverts_revision_id" text,
	"precondition_hash" text,
	"precondition_fields" text[] DEFAULT '{}' NOT NULL,
	"rationale" text NOT NULL,
	"expected_effect" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_detail" jsonb,
	"idempotency_key" text,
	"applying_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "proposals_short_id_unique" UNIQUE("short_id"),
	CONSTRAINT "proposals_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "proposals_origin_check" CHECK (origin in ('agent','operator','policy')),
	CONSTRAINT "proposals_status_check" CHECK (status in ('pending','approved','rejected','expired','blocked','stale','applying','applied','failed','rolled_back','needs_attention','reverted'))
);
--> statement-breakpoint
CREATE TABLE "search_terms" (
	"product_id" uuid NOT NULL,
	"ad_group_entity_id" uuid NOT NULL,
	"date" date NOT NULL,
	"term" text NOT NULL,
	"impressions" bigint NOT NULL,
	"clicks" bigint NOT NULL,
	"spend_micros" bigint NOT NULL,
	"conversions" numeric NOT NULL,
	CONSTRAINT "search_terms_ad_group_entity_id_date_term_pk" PRIMARY KEY("ad_group_entity_id","date","term")
);
--> statement-breakpoint
CREATE TABLE "settings_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"settings" jsonb NOT NULL,
	"request_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_history_product_id_version_unique" UNIQUE("product_id","version")
);
--> statement-breakpoint
CREATE TABLE "system_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" uuid
);
--> statement-breakpoint
CREATE TABLE "trust_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"cycle_id" uuid NOT NULL,
	"account_id" uuid,
	"check_id" text NOT NULL,
	"result" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trust_checks_result_check" CHECK (result in ('pass','warn','fail','no_signal'))
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_entities" ADD CONSTRAINT "ad_entities_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_entities" ADD CONSTRAINT "ad_entities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_entities" ADD CONSTRAINT "ad_entities_offering_id_offerings_id_fk" FOREIGN KEY ("offering_id") REFERENCES "public"."offerings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_entities" ADD CONSTRAINT "ad_entities_parent_id_ad_entities_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."ad_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_entity_snapshots" ADD CONSTRAINT "ad_entity_snapshots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_entity_snapshots" ADD CONSTRAINT "ad_entity_snapshots_ad_entity_id_ad_entities_id_fk" FOREIGN KEY ("ad_entity_id") REFERENCES "public"."ad_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_reverted_by_revision_id_change_log_revision_id_fk" FOREIGN KEY ("reverted_by_revision_id") REFERENCES "public"."change_log"("revision_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_access" ADD CONSTRAINT "credential_access_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drift_events" ADD CONSTRAINT "drift_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drift_events" ADD CONSTRAINT "drift_events_ad_entity_id_ad_entities_id_fk" FOREIGN KEY ("ad_entity_id") REFERENCES "public"."ad_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_target_entity_id_ad_entities_id_fk" FOREIGN KEY ("target_entity_id") REFERENCES "public"."ad_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_clicks" ADD CONSTRAINT "google_clicks_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_daily" ADD CONSTRAINT "metrics_daily_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "metrics_daily" ADD CONSTRAINT "metrics_daily_ad_entity_id_ad_entities_id_fk" FOREIGN KEY ("ad_entity_id") REFERENCES "public"."ad_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offerings" ADD CONSTRAINT "offerings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_requests" ADD CONSTRAINT "operator_requests_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_attributed_entity_id_ad_entities_id_fk" FOREIGN KEY ("attributed_entity_id") REFERENCES "public"."ad_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_docs" ADD CONSTRAINT "product_docs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_terms" ADD CONSTRAINT "search_terms_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_terms" ADD CONSTRAINT "search_terms_ad_group_entity_id_ad_entities_id_fk" FOREIGN KEY ("ad_group_entity_id") REFERENCES "public"."ad_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings_history" ADD CONSTRAINT "settings_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_checks" ADD CONSTRAINT "trust_checks_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_checks" ADD CONSTRAINT "trust_checks_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_checks" ADD CONSTRAINT "trust_checks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_product_id_index" ON "accounts" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "ad_entities_product_id_index" ON "ad_entities" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "ad_entities_parent_id_index" ON "ad_entities" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "ad_entity_snapshots_ad_entity_id_taken_at_index" ON "ad_entity_snapshots" USING btree ("ad_entity_id","taken_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ad_entity_snapshots_product_id_index" ON "ad_entity_snapshots" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "approvals_product_id_decided_at_index" ON "approvals" USING btree ("product_id","decided_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "briefs_product_id_created_at_index" ON "briefs" USING btree ("product_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "change_log_product_id_applied_at_index" ON "change_log" USING btree ("product_id","applied_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "credentials_product_id_index" ON "credentials" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "cycles_product_id_started_at_index" ON "cycles" USING btree ("product_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "cycles_one_scheduled_per_day" ON "cycles" USING btree ("product_id","kind","cycle_date") WHERE "cycles"."kind" <> 'manual';--> statement-breakpoint
CREATE INDEX "drift_events_product_id_detected_at_index" ON "drift_events" USING btree ("product_id","detected_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "findings_product_id_cycle_id_index" ON "findings" USING btree ("product_id","cycle_id");--> statement-breakpoint
CREATE INDEX "google_clicks_product_id_date_index" ON "google_clicks" USING btree ("product_id","date");--> statement-breakpoint
CREATE INDEX "jobs_queue_status_priority_run_at_index" ON "jobs" USING btree ("queue","status","priority" DESC NULLS LAST,"run_at");--> statement-breakpoint
CREATE INDEX "metrics_daily_product_id_date_index" ON "metrics_daily" USING btree ("product_id","date");--> statement-breakpoint
CREATE INDEX "notifications_created_at_index" ON "notifications" USING btree ("created_at") WHERE "notifications"."sent_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_product_id_index" ON "notifications" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "operator_requests_status_created_at_index" ON "operator_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "operator_requests_product_id_index" ON "operator_requests" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "outcomes_product_id_occurred_at_index" ON "outcomes" USING btree ("product_id","occurred_at");--> statement-breakpoint
CREATE INDEX "proposal_versions_product_id_index" ON "proposal_versions" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "proposals_product_id_status_index" ON "proposals" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "search_terms_product_id_date_index" ON "search_terms" USING btree ("product_id","date");--> statement-breakpoint
CREATE INDEX "trust_checks_product_id_cycle_id_index" ON "trust_checks" USING btree ("product_id","cycle_id");