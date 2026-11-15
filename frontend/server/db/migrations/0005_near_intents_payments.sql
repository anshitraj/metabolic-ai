CREATE TABLE "intent_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"origin_asset" text NOT NULL,
	"origin_symbol" text NOT NULL,
	"origin_chain" text NOT NULL,
	"destination_asset" text NOT NULL,
	"recipient" text NOT NULL,
	"amount_in" numeric(78, 0) NOT NULL,
	"amount_in_formatted" text NOT NULL,
	"refund_to" text NOT NULL,
	"deposit_address" text NOT NULL,
	"deposit_memo" text,
	"quoted_usd_micro" bigint NOT NULL,
	"quote" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING_DEPOSIT' NOT NULL,
	"deposit_tx_hash" text,
	"settled_usd_micro" bigint,
	"credited_usd_micro" bigint,
	"credited_at" timestamp with time zone,
	"deadline" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "intent_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "intent_payments" ADD CONSTRAINT "intent_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "intent_payments_deposit_uq" ON "intent_payments" USING btree ("deposit_address");--> statement-breakpoint
CREATE INDEX "intent_payments_user_idx" ON "intent_payments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "intent_payments_status_idx" ON "intent_payments" USING btree ("status");