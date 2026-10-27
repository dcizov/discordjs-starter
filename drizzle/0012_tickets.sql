CREATE TABLE "tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"number" integer NOT NULL,
	"channel_id" text,
	"opener_id" text NOT NULL,
	"claimer_id" text,
	"state" text DEFAULT 'open' NOT NULL,
	"subject" text,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"closer_id" text,
	"close_reason" text,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"transcript" text,
	"transcript_truncated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_state_valid" CHECK ("tickets"."state" in ('open','claimed','closed')),
	CONSTRAINT "tickets_number_positive" CHECK ("tickets"."number">0)
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_guild_number_key" ON "tickets" USING btree ("guild_id","number");--> statement-breakpoint
CREATE INDEX "tickets_guild_state_idx" ON "tickets" USING btree ("guild_id","state");--> statement-breakpoint
CREATE INDEX "tickets_guild_opener_idx" ON "tickets" USING btree ("guild_id","opener_id","state");--> statement-breakpoint
CREATE INDEX "tickets_channel_idx" ON "tickets" USING btree ("guild_id","channel_id");--> statement-breakpoint
CREATE INDEX "tickets_activity_idx" ON "tickets" USING btree ("state","last_activity_at");--> statement-breakpoint
CREATE INDEX "tickets_retention_idx" ON "tickets" USING btree ("state","closed_at");