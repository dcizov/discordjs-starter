import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({
  authorize: vi.fn(),
  origin: vi.fn(),
  limit: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  edit: vi.fn(),
  remove: vi.fn(),
  schedule: vi.fn(),
  cancel: vi.fn(),
  simulate: vi.fn(),
  enqueue: vi.fn(),
  own: vi.fn(),
  preview: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  authorize: deps.authorize,
  HttpError: class extends Error {
    constructor(
      public status: number,
      message: string
    ) {
      super(message);
    }
  },
}));
vi.mock("@/lib/dashboard", () => ({ loadDashboard: vi.fn() }));
vi.mock("@/lib/security", () => ({
  assertOrigin: deps.origin,
  rateLimit: deps.limit,
  body: (req: Request) => req.json(),
}));
vi.mock("@orbit/core/queue", () => ({
  enqueueAction: deps.enqueue,
  createQueue: vi.fn(),
}));
vi.mock("@orbit/db", () => ({
  createCommunityPost: deps.create,
  getCommunityPost: deps.get,
  listCommunityPosts: deps.list,
  editCommunityPost: deps.edit,
  deleteCommunityPost: deps.remove,
  scheduleCommunityPost: deps.schedule,
  cancelCommunityPost: deps.cancel,
  getOwnEconomyHistory: deps.own,
}));
vi.mock("@orbit/db/src/community-demo", () => ({
  simulateCommunityAction: deps.simulate,
}));
vi.mock("@orbit/db/src/news-preview", () => ({
  previewNewsRouting: deps.preview,
}));
import { GET, POST, PATCH, DELETE } from "../apps/web/app/api/[...path]/route";
import { HttpError } from "../apps/web/lib/auth";
import { BotActionUnavailableError } from "@orbit/core/bot-actions";
const gid = "120000000000000001",
  uid = "120000000000000099",
  id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  key = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const request = (
  method: string,
  tail: string,
  payload?: unknown,
  headers: Record<string, string> = {}
) => {
  const [path] = tail.split("?");
  return ({ GET, POST, PATCH, DELETE } as Record<string, typeof GET>)[method](
    new Request(`http://localhost:3000/api/guilds/${gid}/${tail}`, {
      method,
      headers: {
        origin: "http://localhost:3000",
        "content-type": "application/json",
        ...headers,
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    }),
    { params: Promise.resolve({ path: ["guilds", gid, ...path.split("/")] }) }
  );
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEMO_MODE", "false");
  deps.authorize.mockResolvedValue({
    user: { id: uid, name: "Manager" },
    guild: { installed: true },
  });
  deps.get.mockResolvedValue({
    id,
    guildId: gid,
    version: 2,
    state: "draft",
    kind: "poll",
  });
  deps.create.mockResolvedValue({ id, state: "draft" });
  deps.list.mockResolvedValue({
    kind: "poll",
    items: [],
    total: 0,
    page: 1,
    pageSize: 12,
  });
  deps.own.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 5 });
  deps.enqueue.mockResolvedValue({ id: "scoped-job" });
  deps.origin.mockReturnValue(undefined);
  deps.limit.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
describe("community/private history API auth and tenant boundaries, mocked I/O", () => {
  it("authorizes private reads before accessing any records and returns private no-store", async () => {
    const response = await request("GET", "community?kind=poll");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(deps.authorize).toHaveBeenCalledWith(gid, false);
    expect(deps.list).toHaveBeenCalledWith(gid, {
      kind: "poll",
      state: "all",
      page: 1,
      pageSize: 12,
    });
    deps.authorize.mockRejectedValue(new HttpError(403, "Forbidden"));
    deps.list.mockClear();
    expect((await request("GET", "community?kind=poll")).status).toBe(403);
    expect(deps.list).not.toHaveBeenCalled();
  });
  it("blocks failed origin/CSRF checks before authorization, parsing or mutation", async () => {
    deps.origin.mockImplementation(() => {
      throw new HttpError(403, "Origin rejected");
    });
    expect(
      (await request("POST", "community", {}, { "Idempotency-Key": key }))
        .status
    ).toBe(403);
    expect(deps.create).not.toHaveBeenCalled();
    expect(deps.authorize).not.toHaveBeenCalled();
  });
  it("uses a validated idempotency header and the authenticated actor, never a body actor", async () => {
    const input = {
      kind: "poll",
      title: "Draft",
      channelId: "120000000000000201",
      body: "",
      poll: { question: "Choose", answers: ["A", "B"], durationHours: 1 },
    };
    expect((await request("POST", "community", input)).status).toBe(422);
    expect(deps.create).not.toHaveBeenCalled();
    expect(
      (await request("POST", "community", input, { "Idempotency-Key": key }))
        .status
    ).toBe(201);
    expect(deps.create).toHaveBeenCalledWith(gid, uid, input, key);
    expect(deps.authorize).toHaveBeenLastCalledWith(gid, true);
    expect(deps.enqueue).not.toHaveBeenCalled();
  });
  it("does not disclose or mutate a post missing from this guild", async () => {
    deps.get.mockResolvedValue(null);
    for (const method of ["GET", "PATCH", "DELETE"])
      expect(
        (
          await request(
            method,
            `community/${id}`,
            method === "GET" ? undefined : { version: 2, input: {} }
          )
        ).status
      ).toBe(404);
    expect(deps.edit).not.toHaveBeenCalled();
    expect(deps.remove).not.toHaveBeenCalled();
  });
  it("rejects stale revisions and unexpected action fields before queue admission", async () => {
    expect(
      (
        await request("POST", `community/${id}/actions`, {
          action: "publish",
          version: 1,
        })
      ).status
    ).toBe(409);
    expect(
      (
        await request("POST", `community/${id}/actions`, {
          action: "publish",
          version: 2,
          actorId: "forged",
        })
      ).status
    ).toBe(422);
    expect(deps.enqueue).not.toHaveBeenCalled();
  });
  it("returns Accepted, not confirmed delivery, for a scoped live action", async () => {
    const response = await request("POST", `community/${id}/actions`, {
      action: "publish",
      version: 2,
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      accepted: true,
      jobId: "scoped-job",
      demo: false,
    });
    expect(deps.enqueue).toHaveBeenCalledWith(
      gid,
      uid,
      "community",
      { id, version: 2, action: "publish" },
      expect.stringMatching(new RegExp(`^community-${id}-2-publish-`))
    );
    expect(deps.simulate).not.toHaveBeenCalled();
  });
  it("returns 503 when the real bot consumer is unavailable", async () => {
    deps.enqueue.mockRejectedValue(new BotActionUnavailableError());
    expect(
      (
        await request("POST", `community/${id}/actions`, {
          action: "publish",
          version: 2,
        })
      ).status
    ).toBe(503);
    expect(deps.simulate).not.toHaveBeenCalled();
  });
  it("schedules/cancels database revisions without claiming live delivery", async () => {
    deps.schedule.mockResolvedValue({ id, state: "scheduled" });
    const response = await request("POST", `community/${id}/actions`, {
      action: "schedule",
      version: 2,
      scheduledFor: "2026-11-01T18:00:00Z",
    });
    expect(await response.json()).toMatchObject({ deliveryConfirmed: false });
    expect(deps.schedule).toHaveBeenCalledWith(
      gid,
      id,
      2,
      uid,
      "2026-11-01T18:00:00Z"
    );
    await request("POST", `community/${id}/actions`, {
      action: "cancel",
      version: 2,
    });
    expect(deps.cancel).toHaveBeenCalledWith(gid, id, 2, uid);
    expect(deps.enqueue).not.toHaveBeenCalled();
  });
  it("labels demo actions as simulations and cannot reach the live queue", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    deps.simulate.mockResolvedValue({
      id,
      state: "published",
      messageId: null,
    });
    const response = await request("POST", `community/${id}/actions`, {
      action: "publish",
      version: 2,
    });
    expect(await response.json()).toMatchObject({
      demo: true,
      simulated: true,
      post: { messageId: null },
    });
    expect(deps.enqueue).not.toHaveBeenCalled();
  });
  it("hard-scopes own history to the authenticated user even with an attacker-supplied selector", async () => {
    const response = await request(
      "GET",
      `my-transactions?page=2&userId=990000000000000099`
    );
    expect(response.status).toBe(200);
    expect(deps.own).toHaveBeenCalledWith(gid, uid, { page: 2, pageSize: 5 });
    expect((await request("GET", "my-transactions?page=0")).status).toBe(422);
  });
  it("gates the bounded routing preview through the same origin/auth/rate checks", async () => {
    const input = { sourceId: id, title: "Patch release", tags: [] };
    deps.preview.mockResolvedValue({
      fetchPerformed: false,
      sendPerformed: false,
      deliveryVerified: false,
    });
    const response = await request("POST", "news-preview", input);
    expect(response.status).toBe(200);
    expect(deps.preview).toHaveBeenCalledWith(gid, input);
    expect(deps.origin).toHaveBeenCalled();
    expect(deps.authorize).toHaveBeenCalledWith(gid, true);
    expect(deps.limit).toHaveBeenCalledWith(`${uid}:${gid}`);
    expect(deps.enqueue).not.toHaveBeenCalled();
  });
  it("deletes only the stored record and explicitly does not promise Discord recall", async () => {
    const response = await request("DELETE", `community/${id}`, { version: 2 });
    expect(await response.json()).toEqual({
      ok: true,
      discordMessageDeleted: false,
    });
    expect(deps.remove).toHaveBeenCalledWith(gid, id, 2, uid);
    expect(deps.enqueue).not.toHaveBeenCalled();
  });
});
