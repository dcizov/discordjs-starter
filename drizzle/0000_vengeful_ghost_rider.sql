CREATE TABLE "guilds" (
	"guild_id" text PRIMARY KEY NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
