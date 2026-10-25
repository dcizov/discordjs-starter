import type { Client } from "discord.js";
import { emptyMusic, putMusicState, setHealth } from "@orbit/db";
import { errorDiagnostic } from "@orbit/core/diagnostics";
import { logger } from "@orbit/core/logger";
import type { MusicService } from "../features/music/service";
import { syncGuild } from "./guild-sync";

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
  function clear() {
    clearInterval(heartbeat);
    clearInterval(syncTimer);
  }
  signal.addEventListener("abort", clear, { once: true });
  return async () => {
    clear();
    signal.removeEventListener("abort", clear);
    // Do not let a late healthy heartbeat overwrite the final offline state.
    await Promise.allSettled(pending);
  };
}
