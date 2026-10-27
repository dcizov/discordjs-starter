/**
 * Freshness of a news source, derived only from data Orbit already stores.
 *
 * The dashboard used to label a source "Healthy" because its *saved* health
 * field said so. That field is written by the last successful poll, which may
 * be hours older than the schedule promises — so the badge could claim health
 * that was never observed recently. This module reports what the timestamps
 * actually support:
 *
 * - `never-checked`: no check has been recorded (unknown, not healthy),
 * - `fresh`: the last check is within the configured interval plus a grace
 *   period,
 * - `overdue`: the last check is older than that, with the measured age,
 * - `unknown`: a timestamp exists but cannot be parsed.
 *
 * It deliberately produces no score and makes no claim about delivery success;
 * a fresh check only means the poller reached the source recently.
 */
import type { Resource } from "./types";

/** Allow 50% slack before calling a source overdue (backoff, restarts, drift). */
const GRACE = 1.5;

export type SourceFreshness = {
  state: "never-checked" | "fresh" | "overdue" | "unknown";
  /** Minutes since the last recorded check, when known. */
  ageMinutes: number | null;
  /** Expected minutes between checks, from the source's own schedule. */
  expectedMinutes: number;
  /** Short, non-quantified label for a badge. */
  label: string;
  /** One sentence with the measured facts. */
  detail: string;
};

function minutes(value: number) {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value < 1) return 1;
  return Math.round(value);
}

function humanize(value: number) {
  const m = minutes(value);
  if (m < 60) return `${m} min`;
  const hours = Math.round(m / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} days`;
}

export function sourceFreshness(
  source: Pick<Resource, "data" | "enabled">,
  now: number = Date.now()
): SourceFreshness {
  const expectedMinutes = Math.max(
    1,
    Number(source.data.intervalMinutes) || 30
  );
  const raw = source.data.lastChecked;
  if (!raw)
    return {
      state: "never-checked",
      ageMinutes: null,
      expectedMinutes,
      label: "Never checked",
      detail: `No check has been recorded yet. The schedule expects one every ${humanize(expectedMinutes)}.`,
    };
  const checked = new Date(raw).getTime();
  if (Number.isNaN(checked))
    return {
      state: "unknown",
      ageMinutes: null,
      expectedMinutes,
      label: "Check time unknown",
      detail: `The stored check time could not be read, so freshness is unknown. The schedule expects a check every ${humanize(expectedMinutes)}.`,
    };
  const ageMinutes = Math.max(0, (now - checked) / 60000);
  if (source.enabled === false)
    return {
      state: "unknown",
      ageMinutes,
      expectedMinutes,
      label: "Paused",
      detail: `Paused, so no check is expected. The last recorded check was ${humanize(ageMinutes)} ago.`,
    };
  if (ageMinutes <= expectedMinutes * GRACE)
    return {
      state: "fresh",
      ageMinutes,
      expectedMinutes,
      label: "Checked recently",
      detail: `Last checked ${humanize(ageMinutes)} ago; the schedule expects one every ${humanize(expectedMinutes)}.`,
    };
  return {
    state: "overdue",
    ageMinutes,
    expectedMinutes,
    label: "Check overdue",
    detail: `Last checked ${humanize(ageMinutes)} ago but the schedule expects one every ${humanize(expectedMinutes)}. The poller may be stopped, failing, or backlogged — a saved configuration alone is not proof that it ran.`,
  };
}
