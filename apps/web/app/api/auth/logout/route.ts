import { hash } from "@/lib/auth";
import { assertOrigin } from "@/lib/security";
import { isDemo } from "@orbit/core/environment";
import { database, schema } from "@orbit/db";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
export async function POST(req: Request) {
  try {
    assertOrigin(req);
    const token = (await cookies()).get("orbit_session")?.value;
    if (token && !isDemo())
      await database()
        .db.delete(schema.sessions)
        .where(eq(schema.sessions.id, hash(token)));
    const response = NextResponse.json({ ok: true });
    response.cookies.delete("orbit_session");
    return response;
  } catch {
    return NextResponse.json({ error: "Request denied" }, { status: 403 });
  }
}
