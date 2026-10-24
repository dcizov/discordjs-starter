import { createHash } from "node:crypto";
import type { Resource } from "./types";
export type RecentMessage = { at: number; contentHash: string };
export function messageContentHash(content: string) {
  return createHash("sha256")
    .update(
      content.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim()
    )
    .digest("hex");
}
export function evaluateRule(
  rule: Resource,
  input: {
    content: string;
    mentions: number;
    recent: RecentMessage[];
    now: number;
    roleIds: string[];
    channelId: string;
  }
) {
  const d = rule.data;
  if (
    !rule.enabled ||
    d.exemptRoleIds?.some((id: string) => input.roleIds.includes(id)) ||
    d.exemptChannelIds?.includes(input.channelId)
  )
    return false;
  const recent = input.recent.filter(
    (m) => input.now - m.at <= d.windowSeconds * 1000
  );
  const content = input.content
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  switch (d.type) {
    case "spam":
      return recent.length + 1 >= d.threshold;
    case "repeated":
      return (
        !!content &&
        recent.filter((m) => m.contentHash === messageContentHash(content))
          .length +
          1 >=
          d.threshold
      );
    case "mentions":
      return input.mentions >= d.threshold;
    case "blocked_terms":
      return (d.terms ?? []).some((t: string) =>
        content.includes(t.normalize("NFKC").toLocaleLowerCase())
      );
    default:
      return false;
  }
}
