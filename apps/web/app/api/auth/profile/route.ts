import { HttpError, identity, refreshProfile } from "@/lib/auth";
import { publicUser } from "@/lib/discord-images";
import { assertOrigin, body, rateLimit } from "@/lib/security";
import { logger } from "@orbit/core/logger";
import { NextResponse } from "next/server";
import { z } from "zod";

export async function POST(req: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    assertOrigin(req);
    const user = await identity();
    if (!user) throw new HttpError(401, "Sign in with Discord to continue");
    await rateLimit(`profile:${user.id}`, 5);
    z.object({})
      .strict()
      .parse(await body(req));
    const refreshed = await refreshProfile(user);
    return NextResponse.json({ user: publicUser(refreshed) }, { headers });
  } catch (error) {
    const status =
      error instanceof HttpError
        ? error.status
        : error instanceof z.ZodError
          ? 422
          : 503;
    // Status only: OAuth/parse/transport errors can contain private response data.
    logger.warn({ status }, "Profile metadata refresh did not complete");
    return NextResponse.json(
      {
        error:
          error instanceof HttpError
            ? error.message
            : status === 422
              ? "This action does not accept profile or account selectors."
              : "Profile refresh is temporarily unavailable. Try again shortly.",
      },
      { status, headers }
    );
  }
}
