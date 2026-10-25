import { rateLimit, readBounded } from "@/lib/security";
import { decrypt, safeText, verifyWebhook } from "@orbit/core";
import { isDemo, required } from "@orbit/core/environment";
import { safeLink } from "@orbit/core/feeds";
import { database, dispatchItems, getResource, schema } from "@orbit/db";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
export const runtime = "nodejs";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ sourceId: string }> }
) {
  if (isDemo())
    return NextResponse.json(
      {
        error:
          "Incoming webhooks are disabled in demo mode. No messages are sent.",
      },
      { status: 409 }
    );
  try {
    const { sourceId } = await params;
    z.string().uuid().parse(sourceId);
    await rateLimit(`webhook:${sourceId}`, 30);
    const raw = await readBounded(req, 65536);
    const [credential] = await database()
      .db.select()
      .from(schema.webhookSecrets)
      .where(eq(schema.webhookSecrets.sourceId, sourceId));
    if (
      !credential ||
      !verifyWebhook(
        raw,
        req.headers.get("x-orbit-timestamp") ?? "",
        req.headers.get("x-orbit-signature") ?? "",
        decrypt(credential.secret, required("APP_SECRET"))
      )
    )
      return NextResponse.json(
        { error: "Invalid signature or expired timestamp" },
        { status: 401 }
      );
    const source = await getResource(credential.guildId, sourceId);
    if (
      !source ||
      source.kind !== "source" ||
      source.data.adapter !== "webhook"
    )
      return NextResponse.json(
        { error: "Webhook source not available" },
        { status: 404 }
      );
    const event = z
      .object({
        id: z.string().min(1).max(250),
        title: z.string().min(1).max(256),
        url: z.string().url().max(2000),
        summary: z.string().max(5000).default(""),
        tags: z.array(z.string().max(30)).max(10).default([]),
        publishedAt: z.string().datetime().optional(),
      })
      .strict()
      .parse(JSON.parse(raw));
    const accepted = await dispatchItems(source, [
      {
        ...event,
        title: safeText(event.title, 256),
        summary: safeText(event.summary, 1000),
        url: safeLink(event.url),
        tags: event.tags.map((t) => safeText(t, 30)),
        publishedAt: event.publishedAt ?? new Date().toISOString(),
      },
    ]);
    return NextResponse.json(
      { accepted, duplicate: accepted === 0 },
      { status: 202 }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        error:
          e instanceof z.ZodError
            ? "Invalid event payload"
            : (e.message ?? "Webhook rejected"),
      },
      { status: e.status ?? 400 }
    );
  }
}
