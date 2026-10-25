import {
  activityWindowStart,
  aggregateActivityRecords,
  calendarKey,
  chartTimeZone,
  type ActivityCount,
} from "@orbit/core/activity";
import { isDemo } from "@orbit/core/environment";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { database } from "./client";
import { demoRead } from "./demo";
import { ledger } from "./schema";

/** Full bounded calendar window, NOT the latest-200 dashboard history sample. */
export async function activityCounts(
  guildId: string,
  configuredTimeZone: string,
  referenceAt: string
): Promise<ActivityCount[]> {
  const timeZone = chartTimeZone(configuredTimeZone);
  if (isDemo())
    return aggregateActivityRecords(
      (await demoRead()).ledger.filter((row) => row.guildId === guildId),
      referenceAt,
      timeZone
    );
  const first = activityWindowStart(referenceAt, timeZone);
  const last = calendarKey(referenceAt, timeZone);
  // A conservative UTC bound makes the index useful; SQL's zoned calendar key
  // supplies the exact boundary, including 23/25-hour days and UTC +/- offsets.
  const earliest = new Date(`${first}T00:00:00Z`);
  earliest.setUTCDate(earliest.getUTCDate() - 2);
  const bucket = sql<string>`to_char(${ledger.createdAt} at time zone ${timeZone}, 'YYYY-MM-DD')`;
  const rows = await database()
    .db.select({
      key: bucket,
      events: sql<number>`count(*)::float8`,
      members: sql<number>`count(distinct ${ledger.userId})::float8`,
    })
    .from(ledger)
    .where(
      and(
        eq(ledger.guildId, guildId),
        eq(ledger.type, "activity"),
        gte(ledger.createdAt, earliest),
        lte(ledger.createdAt, new Date(referenceAt))
      )
    )
    // Group by the selected expression, not a second separately-bound zone parameter.
    .groupBy(sql`1`);
  return rows.filter((row) => row.key >= first && row.key <= last);
}
