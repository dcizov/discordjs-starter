--> statement-breakpoint
-- Per-step record of what an apply run actually did.
--
-- A template apply creates Discord resources one at a time, and each one takes
-- a round trip that can fail or outlive the process. `template_runs.result` was
-- rewritten after every step, which is enough to show progress but not enough
-- to resume: it records names and ids as a flat list, with nothing saying which
-- template key produced which Discord id, and nothing recording a step that
-- failed.
--
-- This table is that mapping. It is what lets an interrupted run pick up where
-- it stopped and reuse exactly the resources the first attempt created, instead
-- of guessing by name — which breaks as soon as anything was renamed.
--
-- One row per (run, key). `key` is the template's own addressing scheme
-- (`role:moderator`, `channel:general`, `channel:general#overwrites`), never a
-- Discord id, so the mapping survives being applied to a different server.
CREATE TABLE "template_run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"action" text NOT NULL,
	"target_id" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "template_run_steps" ADD CONSTRAINT "template_run_steps_run_id_template_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."template_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- A resumed run re-records the steps it redoes; the unique index makes that an
-- update of the existing row rather than a second row for the same key.
CREATE UNIQUE INDEX "template_run_steps_run_key_idx" ON "template_run_steps" USING btree ("run_id","key");
