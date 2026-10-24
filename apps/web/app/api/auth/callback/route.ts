import { createSession } from "@/lib/auth";
import { isDemo, required, timingSafeStringEqual } from "@orbit/core";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
export async function GET(req: Request) {
  if (isDemo())
    return NextResponse.json(
      { error: "OAuth is disabled in demo mode" },
      { status: 400 }
    );
  const u = new URL(req.url),
    state = u.searchParams.get("state") ?? "",
    expected = (await cookies()).get("orbit_oauth_state")?.value ?? "",
    code = u.searchParams.get("code");
  if (!code || !expected || !timingSafeStringEqual(state, expected))
    return NextResponse.json(
      { error: "Invalid or expired OAuth state. Start sign-in again." },
      { status: 400 }
    );
  try {
    const r = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: required("DISCORD_CLIENT_ID"),
        client_secret: required("DISCORD_CLIENT_SECRET"),
        code,
        grant_type: "authorization_code",
        redirect_uri: `${required("APP_URL")}/api/auth/callback`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw new Error("Code exchange failed");
    const token = await r.json();
    const me = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bearer ${token.access_token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!me.ok) throw new Error("Identity lookup failed");
    const session = await createSession(token, await me.json());
    const response = NextResponse.redirect(new URL("/", required("APP_URL")));
    response.cookies.set("orbit_session", session, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 86400,
    });
    response.cookies.delete("orbit_oauth_state");
    return response;
  } catch {
    return NextResponse.redirect(
      new URL("/login?error=oauth", required("APP_URL"))
    );
  }
}
