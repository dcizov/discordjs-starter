"use client";
import { moduleSetup } from "@orbit/core/module-setup";
import type { ModuleKey } from "@orbit/core";
import { Badge, Card } from "./ui/primitives";
import { Button } from "./ui/button";
import { useWorkspace } from "./workspace";
export function ModuleSetupBanner({ module }: { module: ModuleKey }) {
  const { data, navigate } = useWorkspace();
  const setup = moduleSetup(data, module);
  return (
    <Card
      className="mb-5 flex flex-wrap items-start justify-between gap-4 p-4"
      data-module-setup={module}
    >
      <div className="min-w-0 flex-1 basis-64">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xs font-semibold">Setup guidance</h2>
          <Badge
            tone={
              setup.state === "needs-setup"
                ? "amber"
                : setup.state === "configured"
                  ? "green"
                  : "neutral"
            }
          >
            {setup.label}
          </Badge>
          {data.demo && <Badge tone="blue">Sample configuration</Badge>}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {setup.detail}
        </p>
        <p className="mt-1 text-[10px] text-muted-foreground">
          Configuration + synced metadata only, not an authorization or live
          delivery/playback test.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={() => navigate("channels")}>
        Channels & permissions
      </Button>
    </Card>
  );
}
