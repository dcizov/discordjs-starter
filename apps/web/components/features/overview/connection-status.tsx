"use client";
import { useState } from "react";
import { Orbit, Radio, Database, Workflow, ArrowUpRight } from "lucide-react";
import { cn, relativeTime } from "@/lib/utils";
import { useWorkspace } from "../../workspace";
import { Badge, Card } from "../../ui/primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
export function ConnectionStatus() {
  const { data } = useWorkspace();
  const [status, setStatus] = useState(false);
  const gateway = data.health.find((health) => health.name === "Discord API");
  const online = gateway?.status === "healthy";
  return (
    <>
      <Card className="flex flex-col">
        <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
          <h2 className="text-xs font-semibold">Bot status</h2>
          <Badge tone={online ? "green" : "amber"}>
            <span
              className={cn(
                "size-1 rounded-full",
                online ? "bg-emerald-500" : "bg-amber-500"
              )}
            />
            {online ? "Online" : "Not connected"}
          </Badge>
        </div>
        <div className="flex items-center gap-3.5 px-5 pb-4 pt-5">
          <div className="relative flex size-10 shrink-0 items-center justify-center rounded-xl border border-violet-100 bg-violet-50 text-primary dark:border-violet-500/20 dark:bg-violet-500/10">
            <Orbit size={25} strokeWidth={1.4} />
            <span
              className={cn(
                "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-card",
                online ? "bg-emerald-400" : "bg-amber-400"
              )}
            />
          </div>
          <div>
            <p className="text-xs font-semibold">
              {online
                ? "Orbit is in good spirits."
                : "No current gateway connection."}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {data.demo
                ? "Simulated services. Real possibilities."
                : "Keeping things running smoothly."}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x border-y border-border/70 px-5 py-3">
          <div>
            <p className="text-[9px] text-muted-foreground">Gateway latency</p>
            <p className="mt-1 text-[14px] font-semibold">
              {online && gateway ? `${gateway.latency} ms` : "Unavailable"}
            </p>
          </div>
          <div className="pl-5">
            <p className="text-[9px] text-muted-foreground">Last heartbeat</p>
            <p className="mt-1 text-[14px] font-semibold">
              {gateway?.updatedAt
                ? relativeTime(gateway.updatedAt, data.presentation.referenceAt)
                : "Unavailable"}
            </p>
          </div>
        </div>
        <div className="space-y-3 px-5 py-4">
          {data.health.slice(0, 3).map((h, i) => {
            const Icon = [Radio, Database, Workflow][i];
            return (
              <div
                className="flex items-center justify-between text-[10px]"
                key={h.name}
              >
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Icon size={12} />
                  {h.name}
                </span>
                <span
                  className={cn(
                    "flex items-center gap-1.5",
                    h.status === "healthy" ? "text-[#77a68e]" : "text-amber-500"
                  )}
                >
                  <span
                    className={cn(
                      "size-1 rounded-full",
                      h.status === "healthy" ? "bg-[#8abd9f]" : "bg-amber-400"
                    )}
                  />
                  {h.status === "healthy"
                    ? "Connected"
                    : h.status === "degraded"
                      ? "Degraded"
                      : "Offline"}
                </span>
              </div>
            );
          })}
        </div>
        <button
          onClick={() => setStatus(true)}
          className="mt-auto flex items-center justify-center gap-2 border-t bg-muted/20 px-5 py-3 text-[10px] font-medium text-muted-foreground transition hover:text-primary"
        >
          View connection details <ArrowUpRight size={11} />
        </button>
      </Card>
      <Dialog open={status} onOpenChange={setStatus}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Everything in its orbit</DialogTitle>
            <DialogDescription>
              {data.demo
                ? "These are simulated health checks. No live connections are made."
                : "Live service heartbeats. A service is marked offline after 2 minutes without an update."}
            </DialogDescription>
          </DialogHeader>
          <div className="divide-y">
            {data.health.map((h) => (
              <div key={h.name} className="py-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{h.name}</span>
                  <Badge
                    tone={
                      h.status === "healthy"
                        ? "green"
                        : h.status === "offline"
                          ? "red"
                          : "amber"
                    }
                  >
                    {/* Same words as the summary card, so "degraded" and
                        "Not connected" are not two names for one state. */}
                    {h.status === "healthy"
                      ? "Connected"
                      : h.status === "degraded"
                        ? "Degraded"
                        : "Offline"}
                  </Badge>
                </div>
                <p className="mt-2 break-words text-[11px] leading-relaxed text-muted-foreground">
                  {h.detail}
                </p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {/* A zero latency is "not measured", not "0 ms": the music
                      backend reports no round trip of its own. */}
                  {h.latency > 0 ? `${h.latency} ms · ` : ""}
                  {relativeTime(h.updatedAt, data.presentation.referenceAt)}
                </p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
