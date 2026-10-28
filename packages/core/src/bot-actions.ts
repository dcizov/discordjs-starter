/** Shared protocol for the dashboard's live bot action bridge. No Discord I/O. */
export const MUSIC_ACTION_MAX_AGE_MS = 30_000;
/**
 * How long any other queued action stays valid.
 *
 * Music is 30 seconds because a queue is live state: playing a track someone
 * asked for before a restart is a surprise, not a service. The rest — publishing
 * a panel, applying a template, editing roles — are deliberate configuration
 * changes, so they get a generous window that survives a worker restart without
 * letting an operator's click from last Tuesday execute now.
 *
 * This used to apply to `music` alone, which meant every other action had no
 * bound at all: a job queued during an outage executed whenever the worker came
 * back, however long that took.
 */
export const BOT_ACTION_MAX_AGE_MS = 15 * 60_000;

export class BotActionUnavailableError extends Error {
  readonly status = 503;
  readonly code = "BOT_UNAVAILABLE";
  constructor(
    message = "The Discord bot is offline or its action consumer is not ready. Start the bot service (npm run dev:bot), not just the web dashboard (npm run dev). No action was queued."
  ) {
    super(message);
    this.name = "BotActionUnavailableError";
  }
}

/** Never replay an old play/skip request when a stopped bot eventually returns. */
export function assertFreshBotAction(
  name: string,
  timestamp: number,
  now = Date.now()
) {
  if (!Number.isFinite(timestamp)) {
    throw new Error(
      name === "music"
        ? "This music request expired while waiting for the bot. Nothing was played by this request. Check the current queue and submit a fresh request."
        : "This request has no usable timestamp, so it was not run. Submit it again."
    );
  }
  const maxAge =
    name === "music" ? MUSIC_ACTION_MAX_AGE_MS : BOT_ACTION_MAX_AGE_MS;
  if (now - timestamp <= maxAge) return;
  throw new Error(
    name === "music"
      ? "This music request expired while waiting for the bot. Nothing was played by this request. Check the current queue and submit a fresh request."
      : "This request waited too long for the bot and was not run. Nothing was changed. Refresh the page and try again."
  );
}

export type BotActionStatus = {
  state: string;
  error?: string | null;
  result?: unknown;
};

export class BotActionPendingError extends Error {
  constructor(
    readonly jobId: string,
    readonly state: string
  ) {
    super(
      "The bot has not confirmed this request yet. It may still be processing; do not resubmit it blindly. Check the queue/Audit log or the bot's logs. Execution is not confirmed."
    );
    this.name = "BotActionPendingError";
  }
}

/** Only a completed job is success; accepted/waiting/active are not completion. */
export async function waitForBotAction(
  jobId: string,
  read: () => Promise<BotActionStatus>,
  options: {
    attempts?: number;
    intervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {}
): Promise<BotActionStatus> {
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let state = "waiting";
  for (let n = 0; n < (options.attempts ?? 30); n++) {
    const job = await read();
    state = job.state;
    if (state === "completed") return job;
    if (state === "failed")
      throw new Error(job.error || "The bot could not complete this action.");
    if (["unknown", "removed", "cancelled"].includes(state))
      throw new Error(
        "This bot request is no longer available. Completion was not confirmed; check the current queue before retrying."
      );
    if (n + 1 < (options.attempts ?? 30))
      await sleep(options.intervalMs ?? 1000);
  }
  throw new BotActionPendingError(jobId, state);
}
