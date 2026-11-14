CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"hash" text NOT NULL,
	"scopes" jsonb DEFAULT '["inference"]'::jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nonce" text NOT NULL,
	"message" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"network" text NOT NULL,
	"tx_hash" text NOT NULL,
	"kind" text NOT NULL,
	"signer_id" text NOT NULL,
	"receiver_id" text NOT NULL,
	"amount_yocto" numeric(40, 0) DEFAULT '0' NOT NULL,
	"status" text NOT NULL,
	"block_hash" text,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_balances" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"available" bigint DEFAULT 0 NOT NULL,
	"reserved" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposit_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_yocto" numeric(40, 0) NOT NULL,
	"network" text NOT NULL,
	"receiver_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"chain_tx_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_yocto" numeric(40, 0) NOT NULL,
	"usd_micro" bigint NOT NULL,
	"price_snapshot_id" uuid,
	"credited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "economic_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" text NOT NULL,
	"interval_start" timestamp with time zone NOT NULL,
	"interval_end" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"hash" text NOT NULL,
	"status" text NOT NULL,
	"network" text NOT NULL,
	"tx_hash" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "economic_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text DEFAULT 'real' NOT NULL,
	"state" text NOT NULL,
	"treasury" bigint NOT NULL,
	"liabilities" bigint NOT NULL,
	"payables" bigint NOT NULL,
	"liquidity" bigint NOT NULL,
	"revenue_window" bigint NOT NULL,
	"expense_window" bigint NOT NULL,
	"rolling_margin_bp" integer,
	"reserve_coverage_bp" integer NOT NULL,
	"runway_seconds" integer,
	"requests_window" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"source" text NOT NULL,
	"scope" text DEFAULT 'real' NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"entity_id" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_id" uuid NOT NULL,
	"scope" text DEFAULT 'real' NOT NULL,
	"account" text NOT NULL,
	"user_id" uuid,
	"debit" bigint DEFAULT 0 NOT NULL,
	"credit" bigint DEFAULT 0 NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" text,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "policy_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair" text DEFAULT 'NEAR/USD' NOT NULL,
	"micro_per_unit" bigint NOT NULL,
	"source" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_health" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"ok" boolean NOT NULL,
	"latency_ms" integer,
	"error_class" text,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routing_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text DEFAULT 'real' NOT NULL,
	"usage_request_id" uuid,
	"kind" text NOT NULL,
	"state" text NOT NULL,
	"chosen_model_id" text,
	"tier" text,
	"candidates" jsonb NOT NULL,
	"explanation" text NOT NULL,
	"est_cost" bigint,
	"est_charge" bigint,
	"policy_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"public_key" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "simulation_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"params" jsonb NOT NULL,
	"state" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "state_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text DEFAULT 'real' NOT NULL,
	"from_state" text NOT NULL,
	"to_state" text NOT NULL,
	"trigger" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"policy_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"api_key_id" uuid,
	"idempotency_key" text NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"model_id" text,
	"provider" text,
	"tier" text,
	"in_tokens" integer DEFAULT 0 NOT NULL,
	"out_tokens" integer DEFAULT 0 NOT NULL,
	"est_cost" bigint DEFAULT 0 NOT NULL,
	"cost" bigint DEFAULT 0 NOT NULL,
	"cost_is_estimated" boolean DEFAULT false NOT NULL,
	"reserved" bigint DEFAULT 0 NOT NULL,
	"charge" bigint DEFAULT 0 NOT NULL,
	"latency_ms" integer,
	"error" text,
	"partial" boolean DEFAULT false NOT NULL,
	"conversation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finalized_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"near_account_id" text NOT NULL,
	"role" text DEFAULT 'customer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposit_intents" ADD CONSTRAINT "deposit_intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_chain_tx_id_chain_transactions_id_fk" FOREIGN KEY ("chain_tx_id") REFERENCES "public"."chain_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_price_snapshot_id_price_snapshots_id_fk" FOREIGN KEY ("price_snapshot_id") REFERENCES "public"."price_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD CONSTRAINT "usage_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_uq" ON "api_keys" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "api_keys_user_idx" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_nonces_uq" ON "auth_nonces" USING btree ("nonce");--> statement-breakpoint
CREATE UNIQUE INDEX "chain_tx_uq" ON "chain_transactions" USING btree ("network","tx_hash");--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "deposits_tx_uq" ON "deposits" USING btree ("chain_tx_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_id_uq" ON "economic_receipts" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "snapshots_scope_created_idx" ON "economic_snapshots" USING btree ("scope","created_at");--> statement-breakpoint
CREATE INDEX "events_scope_seq_idx" ON "events" USING btree ("scope","seq");--> statement-breakpoint
CREATE INDEX "ledger_scope_account_idx" ON "ledger_entries" USING btree ("scope","account");--> statement-breakpoint
CREATE INDEX "ledger_journal_idx" ON "ledger_entries" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "ledger_created_idx" ON "ledger_entries" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_version_uq" ON "policy_configs" USING btree ("version");--> statement-breakpoint
CREATE INDEX "price_snapshots_obs_idx" ON "price_snapshots" USING btree ("observed_at");--> statement-breakpoint
CREATE INDEX "provider_health_idx" ON "provider_health" USING btree ("provider","observed_at");--> statement-breakpoint
CREATE INDEX "routing_scope_created_idx" ON "routing_decisions" USING btree ("scope","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_uq" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "transitions_scope_created_idx" ON "state_transitions" USING btree ("scope","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_idem_uq" ON "usage_requests" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "usage_user_created_idx" ON "usage_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_created_idx" ON "usage_requests" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_account_uq" ON "users" USING btree ("near_account_id");