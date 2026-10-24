import type { Resource } from "@orbit/core";
import { evaluateRule, messageContentHash } from "@orbit/core/automod";
import { describe, expect, it } from "vitest";
const rule = (type: string, extra: Record<string, any> = {}): Resource => ({
  id: "r",
  guildId: "g",
  kind: "rule",
  name: "Rule",
  enabled: true,
  createdAt: "",
  updatedAt: "",
  data: {
    type,
    threshold: 3,
    windowSeconds: 10,
    terms: ["blocked phrase"],
    ...extra,
  },
});
const input = {
  content: "Hello there",
  mentions: 0,
  recent: [
    { at: 9000, contentHash: messageContentHash("hello there") },
    { at: 9500, contentHash: messageContentHash("hello there") },
  ],
  now: 10000,
  roleIds: [],
  channelId: "general",
};
describe("automoderation rule evaluation", () => {
  it("uses bounded sliding windows for spam and repetition", () => {
    expect(evaluateRule(rule("spam"), input)).toBe(true);
    expect(evaluateRule(rule("repeated"), input)).toBe(true);
    expect(evaluateRule(rule("spam"), { ...input, now: 30000 })).toBe(false);
  });
  it("applies mention and literal blocked-term thresholds", () => {
    expect(evaluateRule(rule("mentions"), { ...input, mentions: 3 })).toBe(
      true
    );
    expect(
      evaluateRule(rule("blocked_terms"), {
        ...input,
        content: "A BLOCKED PHRASE here",
      })
    ).toBe(true);
  });
  it("honors exemptions and disabled rules", () => {
    expect(
      evaluateRule(rule("spam", { exemptRoleIds: ["staff"] }), {
        ...input,
        roleIds: ["staff"],
      })
    ).toBe(false);
    expect(
      evaluateRule(rule("spam", { exemptChannelIds: ["general"] }), input)
    ).toBe(false);
    expect(evaluateRule({ ...rule("spam"), enabled: false }, input)).toBe(
      false
    );
  });
});
