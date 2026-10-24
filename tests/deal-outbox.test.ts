import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dealItem } from "../packages/core/src/deals";
import { deal, policy } from "./fixtures/deals";
import type { Resource } from "../packages/core/src/types";
const deps = vi.hoisted(() => ({
  getGuild: vi.fn(),
  getResource: vi.fn(),
  listResources: vi.fn(),
  reserveDelivery: vi.fn(),
  add: vi.fn(),
}));
vi.mock("../packages/db/src/store", () => deps);
vi.mock("@orbit/core/queue", () => ({
  createQueue: () => ({ add: deps.add }),
}));
import { dispatchItems } from "../packages/db/src/outbox";
const guildId = "120000000000000001",
  channelId = "120000000000000010";
const source = (): Resource => ({
  id: "12000000-0000-4000-8000-000000000009",
  guildId,
  name: "Popular games",
  kind: "deal",
  enabled: true,
  data: { ...policy, channelId },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEMO_MODE", "false");
  deps.getGuild.mockResolvedValue({
    id: guildId,
    installed: true,
    config: { modules: { deals: true }, notificationRoleId: "" },
    channels: [{ id: channelId, type: "text" }],
  });
  deps.getResource.mockResolvedValue(source());
  deps.listResources.mockResolvedValue([]);
  deps.reserveDelivery.mockResolvedValue({ id: "new-delivery" });
  deps.add.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("automatic deal routing/deduplication boundary", () => {
  it("applies the posting cap after existing-offer deduplication so later games are not starved", async () => {
    deps.reserveDelivery.mockResolvedValueOnce(null);
    const items = Array.from({ length: 6 }, (_, index) =>
      dealItem(
        deal(`12000000-0000-4000-8000-${String(index).padStart(12, "0")}`)
      )
    );
    expect(await dispatchItems(source(), items)).toBe(3);
    expect(deps.reserveDelivery).toHaveBeenCalledTimes(4);
    expect(deps.add).toHaveBeenCalledTimes(3);
    expect(
      deps.reserveDelivery.mock.calls[0][0].payload.deal.game.reviews[0].count
    ).toBe(50000);
    expect(deps.reserveDelivery.mock.calls[0][0].url).toBe(items[0].url); // affiliate URL is not rewritten
  });
  it("uses current configuration/destination rather than the stale poll snapshot", async () => {
    const current = source();
    current.data.channelId = "120000000000000011";
    deps.getResource.mockResolvedValue(current);
    deps.getGuild.mockResolvedValue({
      id: guildId,
      installed: true,
      config: { modules: { deals: true }, notificationRoleId: "" },
      channels: [{ id: current.data.channelId, type: "text" }],
    });
    await dispatchItems(source(), [dealItem(deal())]);
    expect(deps.reserveDelivery.mock.calls[0][0]).toMatchObject({
      guildId,
      channelId: current.data.channelId,
    });
  });
  it("does not dispatch insufficient evidence, unverified legacy items, or a paused module", async () => {
    const obscure = deal();
    obscure.game.reviews[0].count = 2;
    expect(
      await dispatchItems(source(), [
        dealItem(obscure),
        { ...dealItem(deal()), deal: undefined },
      ])
    ).toBe(0);
    deps.getGuild.mockResolvedValue({
      installed: true,
      config: { modules: { deals: false } },
    });
    expect(await dispatchItems(source(), [dealItem(deal())])).toBe(0);
    expect(deps.reserveDelivery).not.toHaveBeenCalled();
  });
  it("never accesses live routing in demo mode", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    await expect(dispatchItems(source(), [dealItem(deal())])).rejects.toThrow(
      "disabled in demo"
    );
    expect(deps.getGuild).not.toHaveBeenCalled();
    expect(deps.add).not.toHaveBeenCalled();
  });
});
