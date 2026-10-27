import type { Client } from "discord.js";
import { emptyMusic, putMusicState, setHealth } from "@orbit/db";
import { errorDiagnostic } from "@orbit/core/diagnostics";
import { logger } from "@orbit/core/logger";
import type { MusicService } from "../features/music/service";
import {
  breakSessionsAfterRestart,
  tickVoiceXp,
  VOICE_TICK_MS,
} from "../features/leveling/earn";
import { syncGuild } from "./guild-sync";
import { reconcileRosters } from "./roster-sync";

/** Snapshot initialization and owned periodic work, not Discord/queue readiness. */
export async function startMaintenance(
  client: Client,
  music: MusicService,
  signal: AbortSignal
) {
  for (const guild of client.guilds.cache.values()) {
    if (signal.aborted) return;
    await syncGuild(guild).catch((error) =>
      logger.warn(
        { guildId: guild.id, error: errorDiagnostic(error) },
        "Initial guild sync failed; scheduled sync will retry"
      )
    );
    if (signal.aborted) return;
    await putMusicState(guild.id, emptyMusic());
  }
  if (signal.aborted) return;
  async function beat() {
    if (signal.aborted) return;
    const ready = client.isReady();
    await setHealth(
      "Discord API",
      ready ? "healthy" : "offline",
      Math.max(0, client.ws.ping),
      ready
        ? "Discord.js gateway connected"
        : "Discord gateway disconnected; commands cannot be acknowledged"
    );
    if (!signal.aborted) await music.heartbeat();
  }
  await beat();
  if (signal.aborted) return;
  const pending = new Set<Promise<void>>();
  function track(work: Promise<void>, message: string) {
    const task = work
      .catch((error) => logger.warn({ error: errorDiagnostic(error) }, message))
      .finally(() => pending.delete(task));
    pending.add(task);
  }
  const heartbeat = setInterval(
    () => track(beat(), "Bot heartbeat failed"),
    30000
  );
  const syncTimer = setInterval(() => {
    for (const guild of client.guilds.cache.values())
      track(syncGuild(guild), "Scheduled guild sync failed");
  }, 300000);
  /*
    Roster reconciliation: bounded, and only for guilds whose copy is missing or
    stale. It runs once at startup (after the gateway has the guild list) and then
    hourly, which is far longer than the 6-hour staleness threshold so a restart
    heals a missed join or a crashed sweep without touching every guild each time.
  */
  const reconcile = () =>
    reconcileRosters(client.guilds.cache.values()).then(
      (swept) => {
        if (swept) logger.info({ swept }, "Roster reconciliation swept guilds");
      },
      (error) =>
        logger.warn(
          { error: errorDiagnostic(error) },
          "Roster reconciliation failed"
        )
    );
  track(reconcile(), "Roster reconciliation failed");
  /*
    Voice XP has to be restarted honestly. Every open session is marked broken
    before the first tick, because nothing that happened while the process was
    down can be vouched for — paying it out would credit offline hours. The
    next award then waits for a whole interval that was actually observed.
  */
  track(
    breakSessionsAfterRestart(client).then((broken) => {
      if (broken)
        logger.info(
          { broken },
          "Voice XP sessions marked unobserved after start"
        );
    }),
    "Voice XP restart reconciliation failed"
  );
  const voiceTimer = setInterval(
    () =>
      track(
        tickVoiceXp(client).then(() => undefined),
        "Voice XP tick failed"
      ),
    VOICE_TICK_MS
  );
  const rosterTimer = setInterval(
    () => track(reconcile(), "Roster reconciliation failed"),
    3600000
  );
  function clear() {
    clearInterval(heartbeat);
    clearInterval(syncTimer);
    clearInterval(rosterTimer);
    clearInterval(voiceTimer);
  }
  signal.addEventListener("abort", clear, { once: true });
  return async () => {
    clear();
    signal.removeEventListener("abort", clear);
    // Do not let a late healthy heartbeat overwrite the final offline state.
    await Promise.allSettled(pending);
  };
}
