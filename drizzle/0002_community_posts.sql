CREATE TABLE "community_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"channel_id" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"poll" jsonb,
	"state" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"actor_id" text NOT NULL,
	"request_key" text NOT NULL,
	"scheduled_for" timestamp with time zone,
	"attempted_at" timestamp with time zone,
	"message_id" text,
	"last_error" text,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_kind_valid" CHECK ("community_posts"."kind" in ('poll','announcement')),
	CONSTRAINT "community_state_valid" CHECK ("community_posts"."state" in ('draft','scheduled','sending','published','closed','failed','unconfirmed','cancelled','missed')),
	CONSTRAINT "community_version_positive" CHECK ("community_posts"."version">0)
);
--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_request_key" ON "community_posts" USING btree ("guild_id","request_key");--> statement-breakpoint
CREATE INDEX "community_guild_kind_date_idx" ON "community_posts" USING btree ("guild_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "community_due_idx" ON "community_posts" USING btree ("state","scheduled_for");--> statement-breakpoint
CREATE INDEX "community_retention_idx" ON "community_posts" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "ledger_owner_date_idx" ON "ledger" USING btree ("guild_id","user_id","created_at");