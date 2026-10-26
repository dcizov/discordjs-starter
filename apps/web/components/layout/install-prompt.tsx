"use client";
import { ArrowUpRight, Orbit, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "../ui/primitives";
import { Button } from "../ui/button";
import { useWorkspace } from "../workspace";
export function InstallPrompt() {
  const { data, api } = useWorkspace();
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center text-center">
      <div className="mb-5 flex size-20 items-center justify-center rounded-3xl bg-violet-100 text-violet-700 dark:text-violet-300">
        <Orbit size={42} />
      </div>
      <Badge tone="purple">A new orbit awaits</Badge>
      <h1 className="mt-4 text-3xl font-semibold">
        Let’s connect {data.guild.name}.
      </h1>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
        Invite Orbit to give your community a little more structure, a lot more
        possibilities, and a home for all the details.
      </p>
      <Button
        className="mt-7"
        onClick={async () => {
          if (data.demo) {
            toast.info(
              "Invites are disabled in demo mode. Choose The Cozy Corner to explore."
            );
            return;
          }
          try {
            const r = await api("/invite");
            if (r.url) window.location.href = r.url;
            else toast.error("The Discord application ID is not configured.");
          } catch (e: any) {
            toast.error(e.message);
          }
        }}
      >
        <Plus />
        Invite Orbit to your server
        <ArrowUpRight />
      </Button>
      <p className="mt-4 text-[11px] text-muted-foreground">
        No Administrator permission requested. You choose what Orbit can do.
      </p>
    </div>
  );
}
