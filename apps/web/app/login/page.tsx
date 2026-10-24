import { Button } from "@/components/ui/button";
import { DEMO_GUILD_ID, isDemo } from "@orbit/core";
import { ArrowUpRight, Orbit, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
export const dynamic = "force-dynamic";
export default function Login() {
  const demo = isDemo();
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6">
      <div className="absolute -top-48 left-1/2 -z-10 h-[650px] w-[650px] -translate-x-1/2 rounded-full bg-violet-200/30 blur-3xl" />
      <Link
        prefetch={false}
        href="/"
        className="mb-12 flex items-center gap-2 text-3xl font-semibold tracking-tight"
      >
        <Orbit className="text-primary" size={34} />
        orbit<span className="mb-4 text-primary">.</span>
      </Link>
      <div className="w-full max-w-md rounded-2xl border bg-card p-10 text-center shadow-xl shadow-violet-100/20">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-50 text-violet-500">
          <Sparkles size={25} />
        </div>
        <h1 className="text-[28px] font-semibold leading-tight">
          Good communities
          <br />
          start with a little space.
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Meet your community’s new co-pilot. A calmer way to manage everything
          that brings you together.
        </p>
        <Button className="mt-8 w-full" size="lg" asChild>
          <a
            href={
              demo ? `/dashboard/${DEMO_GUILD_ID}/overview` : "/api/auth/login"
            }
          >
            {demo ? "Explore the demo workspace" : "Continue with Discord"}
            <ArrowUpRight size={16} />
          </a>
        </Button>
        <p className="mt-4 text-[10px] leading-relaxed text-muted-foreground">
          {demo
            ? "No account needed. Your demo changes persist locally. No real Discord messages are sent."
            : "Only servers you own or have Manage Server permission for will appear."}
        </p>
        <div className="mt-7 flex items-center justify-center gap-2 border-t pt-5 text-[11px] text-muted-foreground">
          <ShieldCheck size={14} className="text-emerald-500" />
          Your community. Your control.
        </div>
      </div>
      <p className="mt-8 text-xs text-muted-foreground">
        A little structure. A lot more community.
      </p>
    </main>
  );
}
