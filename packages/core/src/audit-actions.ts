/**
 * The verbs the audit log actually records.
 *
 * They were previously unknown to the dashboard, which built its "filter by
 * action" list from the first page of results — so the options changed as you
 * paged and a rare verb could never be filtered for. One list, one set of
 * labels, shared by the filter, the badge and the detail dialog.
 */
export const AUDIT_ACTIONS = [
  "created",
  "updated",
  "deleted",
  "failed",
  "delivered",
  "moderated",
  "scheduled",
  "cancelled",
  "published",
  "tested",
  "publication claimed",
] as const;

export type AuditActionTone =
  "green" | "purple" | "amber" | "red" | "blue" | "neutral";

const LABELS: Record<string, string> = {
  created: "Created",
  updated: "Updated",
  deleted: "Deleted",
  failed: "Failed",
  delivered: "Delivered",
  moderated: "Moderated",
  scheduled: "Scheduled",
  cancelled: "Cancelled",
  published: "Published",
  tested: "Tested",
  "publication claimed": "Publication claimed",
};

const TONES: Record<string, AuditActionTone> = {
  created: "green",
  delivered: "green",
  published: "green",
  updated: "purple",
  tested: "purple",
  moderated: "amber",
  deleted: "red",
  failed: "red",
  scheduled: "blue",
  cancelled: "neutral",
  "publication claimed": "blue",
};

/** An unknown verb keeps its own words; it is never relabelled as something else. */
export function auditActionLabel(action: string) {
  return LABELS[action] ?? action;
}

/** Success and failure are told apart by tone *and* by the word itself. */
export function auditActionTone(action: string): AuditActionTone {
  return TONES[action] ?? "neutral";
}
