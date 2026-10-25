import { DEMO_GUILD_ID } from "@orbit/core";
import { isDemo, required } from "@orbit/core/environment";
import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
export async function GET(req: Request) {
  if (isDemo())
    return NextResponse.redirect(
      new URL(`/dashboard/${DEMO_GUILD_ID}/overview`, req.url)
    );
  const state = randomBytes(32).toString("base64url");
  const u = new URL("https://discord.com/oauth2/authorize");
  u.search = new URLSearchParams({
    client_id: required("DISCORD_CLIENT_ID"),
    redirect_uri: `${required("APP_URL")}/api/auth/callback`,
    response_type: "code",
    scope: "identify guilds",
    state,
  }).toString();
  const response = NextResponse.redirect(u);
  response.cookies.set("orbit_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return response;
}
