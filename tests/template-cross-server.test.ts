import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cross-server applies, at the API boundary.
 *
 * A template is portable — it addresses its own roles and channels by key, not
 * by Discord id — so the server it is applied to need not be the server whose
 * dashboard started the apply. That splits "the workspace the browser is in"
 * from "the server the run belongs to", which is exactly where authorization
 * usually gets lost. These tests hold the line: a run is readable only by
 * someone who manages the server it ran against.
 */

const deps = vi.hoisted(() => ({
  authorize: vi.fn(),
  getTemplateRun: vi.fn(),
  getGuild: vi.fn(),
  getTemplate: vi.fn(),
  origin: vi.fn(),
  limit: vi.fn(),
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
vi.mock("@/lib/security", () => ({
  assertOrigin: deps.origin,
  rateLimit: deps.limit,
  body: (req: Request) => req.json(),
}));
vi.mock("@/lib/dashboard", () => ({ loadDashboard: vi.fn() }));
vi.mock("@orbit/db", () => ({
  getTemplateRun: deps.getTemplateRun,
  getGuild: deps.getGuild,
  getTemplate: deps.getTemplate,
}));

import { GET } from "../apps/web/app/api/[...path]/route";
// Imported from the mocked module, so the route's catch recognises it as an
// HttpError and turns it into the status it carries rather than a generic 400.
import { HttpError } from "@/lib/auth";

const RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
/** The workspace the dashboard is open on, where the apply was started. */
const HOME = "120000000000000001";
/** The server the template is applied to. */
const TARGET = "120000000000000002";
/** A server this user has nothing to do with. */
const ELSEWHERE = "120000000000000003";

/** Every guild this user administers, as Discord reported it. */
const managed = [
  { id: HOME, name: "Home", installed: true },
  { id: TARGET, name: "Target", installed: true },
];

const runOnTarget = { id: RUN_ID, guildId: TARGET, state: "running" };

const read = (workspace: string) =>
  GET(
    new Request(
      `http://localhost:3000/api/guilds/${workspace}/templates/runs/${RUN_ID}`,
      { method: "GET", headers: { origin: "http://localhost:3000" } }
    ),
    {
      params: Promise.resolve({
        path: ["guilds", workspace, "templates", "runs", RUN_ID],
      }),
    }
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEMO_MODE", "false");
  deps.authorize.mockResolvedValue({
    user: { id: "120000000000000099", name: "Manager" },
    guild: { id: HOME, installed: true },
    guilds: managed,
  });
  deps.getTemplateRun.mockResolvedValue(runOnTarget);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("reading an apply run across servers", () => {
  it("follows a run from the workspace that started it", async () => {
    // The run lives on the target, not on the workspace the browser is in.
    // Without this the operator loses the apply the moment they start one
    // against another server.
    const res = await read(HOME);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ guildId: TARGET });
  });

  it("serves the run from its own server", async () => {
    const res = await read(TARGET);
    expect(res.status).toBe(200);
  });

  it("refuses a workspace the user does not manage", async () => {
    // `authorize` is the boundary that stops this before the run is ever read.
    deps.authorize.mockRejectedValueOnce(
      new HttpError(403, "You need Manage Server permission")
    );
    const res = await read(ELSEWHERE);
    expect(res.status).toBe(403);
    expect(deps.getTemplateRun).not.toHaveBeenCalled();
  });

  it("hides a run whose server the user does not manage", async () => {
    // Defence in depth: if the guild list ever disagreed with `authorize`, the
    // run is reported as missing rather than forbidden, so the endpoint does
    // not confirm that it exists.
    deps.authorize.mockResolvedValue({
      user: { id: "120000000000000099", name: "Manager" },
      guild: { id: HOME, installed: true },
      guilds: [{ id: HOME, name: "Home", installed: true }],
    });
    const res = await read(HOME);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.any(String),
    });
  });

  it("never falls back to returning a run just because its id was guessed", async () => {
    deps.getTemplateRun.mockResolvedValue(null);
    const res = await read(HOME);
    expect(res.status).toBe(404);
  });
});
