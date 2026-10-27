CREATE TABLE "members" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"username" text,
	"global_name" text,
	"nickname" text,
	"display_name" text NOT NULL,
	"avatar" text,
	"guild_avatar" text,
	"bot" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone,
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"present" boolean DEFAULT true NOT NULL,
	"departed_at" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "roster_sync" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'never' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"pages_fetched" integer DEFAULT 0 NOT NULL,
	"synced_count" integer DEFAULT 0 NOT NULL,
	"expected_count" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "server_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_guild_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'both' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"data" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" text NOT NULL,
	"template_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"plan" jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_sync" ADD CONSTRAINT "roster_sync_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_templates" ADD CONSTRAINT "server_templates_source_guild_id_guilds_id_fk" FOREIGN KEY ("source_guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_runs" ADD CONSTRAINT "template_runs_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template_runs" ADD CONSTRAINT "template_runs_template_id_server_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."server_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "members_guild_name_idx" ON "members" USING btree ("guild_id","display_name");--> statement-breakpoint
CREATE INDEX "members_guild_joined_idx" ON "members" USING btree ("guild_id","joined_at");--> statement-breakpoint
CREATE INDEX "members_guild_present_idx" ON "members" USING btree ("guild_id","present");--> statement-breakpoint
CREATE INDEX "server_templates_source_idx" ON "server_templates" USING btree ("source_guild_id","created_at");--> statement-breakpoint
CREATE INDEX "template_runs_guild_date_idx" ON "template_runs" USING btree ("guild_id","created_at");