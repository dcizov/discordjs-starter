CREATE TABLE "xp_events" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xp_reward_grants" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"level" bigint NOT NULL,
	"role_id" text NOT NULL,
	"granted_at" timestamp with time zone,
	"error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xp_reward_grants_guild_id_user_id_level_role_id_pk" PRIMARY KEY("guild_id","user_id","level","role_id")
);
--> statement-breakpoint
CREATE TABLE "xp_totals" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"message_xp" bigint DEFAULT 0 NOT NULL,
	"voice_xp" bigint DEFAULT 0 NOT NULL,
	"adjusted_xp" bigint DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xp_totals_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "xp_voice_sessions" (
	"guild_id" text NOT NULL,
	"user_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_interval_at" timestamp with time zone,
	"intervals_awarded" bigint DEFAULT 0 NOT NULL,
	"broken_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "xp_voice_sessions_guild_id_user_id_pk" PRIMARY KEY("guild_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "xp_events" ADD CONSTRAINT "xp_events_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_reward_grants" ADD CONSTRAINT "xp_reward_grants_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_totals" ADD CONSTRAINT "xp_totals_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_voice_sessions" ADD CONSTRAINT "xp_voice_sessions_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "xp_event_idempotency" ON "xp_events" USING btree ("guild_id","user_id","key");--> statement-breakpoint
CREATE INDEX "xp_events_member_idx" ON "xp_events" USING btree ("guild_id","user_id","created_at");--> statement-breakpoint
CREATE INDEX "xp_reward_grants_guild_idx" ON "xp_reward_grants" USING btree ("guild_id","user_id");--> statement-breakpoint
CREATE INDEX "xp_totals_board_idx" ON "xp_totals" USING btree ("guild_id","total");