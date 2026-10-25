import { AuthProblem } from "@/components/auth-problem";
import { Dashboard } from "@/components/dashboard";
import { HttpError } from "@/lib/auth";
import { loadDashboard } from "@/lib/dashboard";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ guildId: string; section?: string[] }>;
}) {
  const { guildId, section } = await params;
  let data;
  try {
    data = await loadDashboard(guildId, undefined, {
      communityKind:
        section?.[0] === "polls"
          ? "poll"
          : section?.[0] === "announcements"
            ? "announcement"
            : undefined,
      ownLedger: section?.[0] === "economy",
    });
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) redirect("/login");
    if (e instanceof HttpError)
      return (
        <AuthProblem
          status={e.status}
          message={e.message}
          retryAfterSeconds={e.retryAfterSeconds}
          retryAt={Date.now() + (e.retryAfterSeconds ?? 0) * 1000}
        />
      );
    throw e;
  }
  return (
    <Dashboard
      key={`${data.guild.id}:${data.user.id}`}
      initial={data}
      section={section?.[0] ?? "overview"}
    />
  );
}
