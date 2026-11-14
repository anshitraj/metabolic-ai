CREATE TABLE "spend_passes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"agent_name" text NOT NULL,
	"total_budget" bigint NOT NULL,
	"max_per_request" bigint NOT NULL,
	"spent" bigint DEFAULT 0 NOT NULL,
	"reserved" bigint DEFAULT 0 NOT NULL,
	"allowed_models" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_providers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"allowed_tiers" jsonb DEFAULT '["premium","standard","economy"]'::jsonb NOT NULL,
	"policy_version" integer DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "spend_pass_id" uuid;--> statement-breakpoint
ALTER TABLE "deposit_intents" ADD COLUMN "method" text;--> statement-breakpoint
ALTER TABLE "deposit_intents" ADD COLUMN "consumed_tx_hash" text;--> statement-breakpoint
ALTER TABLE "deposits" ADD COLUMN "intent_id" uuid;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD COLUMN "spend_pass_id" uuid;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD COLUMN "pass_policy_version" integer;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD COLUMN "reservation_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD COLUMN "provider_cost_source" text;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD COLUMN "provider_overage" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD COLUMN "recovery_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "spend_passes" ADD CONSTRAINT "spend_passes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "spend_pass_owner_idx" ON "spend_passes" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_spend_pass_id_spend_passes_id_fk" FOREIGN KEY ("spend_pass_id") REFERENCES "public"."spend_passes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_intent_id_deposit_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."deposit_intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_requests" ADD CONSTRAINT "usage_requests_spend_pass_id_spend_passes_id_fk" FOREIGN KEY ("spend_pass_id") REFERENCES "public"."spend_passes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deposits_intent_uq" ON "deposits" USING btree ("intent_id");