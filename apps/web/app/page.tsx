import { AuthProblem } from "@/components/auth-problem";
import { HttpError, identity, manageableGuilds } from "@/lib/auth";
import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
export default async function Home() {
  let guilds;
  try {
    const user = await identity();
    if (!user) redirect("/login");
    guilds = await manageableGuilds(user);
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
  const first = guilds.find((g) => g.installed) ?? guilds[0];
  if (!first) redirect("/login?empty=1");
  redirect(`/dashboard/${first.id}/overview`);
}
