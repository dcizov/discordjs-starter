import { identity, manageableGuilds } from "@/lib/auth";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await identity();
  if (!user) redirect("/login");
  const guilds = await manageableGuilds(user);
  const first = guilds.find((g) => g.installed) ?? guilds[0];
  if (!first) redirect("/login?empty=1");
  redirect(`/dashboard/${first.id}/overview`);
}
