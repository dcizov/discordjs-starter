/** Shared protocol for the dashboard's live bot action bridge. No Discord I/O. */
export const MUSIC_ACTION_MAX_AGE_MS = 30_000;

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
  if (
    name === "music" &&
    (!Number.isFinite(timestamp) || now - timestamp > MUSIC_ACTION_MAX_AGE_MS)
  )
    throw new Error(
      "This music request expired while waiting for the bot. Nothing was played by this request. Check the current queue and submit a fresh request."
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
      "The bot has not confirmed this request yet. It may still be processing; do not resubmit it blindly. Check the queue/Audit log or the bot's logs. Playback is not confirmed."
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
  for (let n = 0; n < (options.attempts ?? 60); n++) {
    const job = await read();
    state = job.state;
    if (state === "completed") return job;
    if (state === "failed")
      throw new Error(job.error || "The bot could not complete this action.");
    if (["unknown", "removed", "cancelled"].includes(state))
      throw new Error(
        "This bot request is no longer available. Completion was not confirmed; check the current queue before retrying."
      );
    if (n + 1 < (options.attempts ?? 60))
      await sleep(options.intervalMs ?? 500);
  }
  throw new BotActionPendingError(jobId, state);
}
