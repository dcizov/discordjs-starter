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
    data = await loadDashboard(guildId);
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) redirect("/login");
    throw e;
  }
  return <Dashboard initial={data} section={section?.[0] ?? "overview"} />;
}
