import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS, auditActionLabel, auditActionTone } from "@orbit/core";

describe("audit action vocabulary", () => {
  it("labels every recorded verb in human words rather than the storage token", () => {
    for (const action of AUDIT_ACTIONS) {
      const label = auditActionLabel(action);
      expect(label).not.toBe(action);
      expect(label[0]).toBe(label[0].toUpperCase());
    }
  });

  it("tells success and failure apart by tone, and the word is always present too", () => {
    expect(auditActionTone("failed")).toBe("red");
    expect(auditActionTone("deleted")).toBe("red");
    expect(auditActionTone("delivered")).toBe("green");
    expect(auditActionTone("created")).toBe("green");
    expect(auditActionTone("moderated")).toBe("amber");
  });

  it("never relabels a verb it does not know", () => {
    // A future writer's verb stays readable as itself instead of being folded
    // into "Updated" or hidden behind a generic badge.
    expect(auditActionLabel("reconciled")).toBe("reconciled");
    expect(auditActionTone("reconciled")).toBe("neutral");
  });

  it("offers a filter option for every canonical verb", () => {
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    expect(AUDIT_ACTIONS).toContain("failed");
    expect(AUDIT_ACTIONS).toContain("publication claimed");
  });
});
