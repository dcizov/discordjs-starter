"use client";
import { moduleSetup } from "@orbit/core/module-setup";
import type { ModuleKey } from "@orbit/core";
import { Badge, Card } from "./ui/primitives";
import { Button } from "./ui/button";
import { useWorkspace } from "./workspace";
import Link from "next/link";

/**
 * Contextual help: the guide for the module the member is looking at, not a
 * generic docs home page. Modules without a dedicated page stay unlinked
 * rather than pointing at an unrelated document.
 */
const MODULE_GUIDE: Partial<
  Record<ModuleKey, { href: string; label: string }>
> = {
  music: { href: "/docs/music", label: "Music and voice guide" },
  news: { href: "/docs/news", label: "News source guide" },
  deals: { href: "/docs/deals", label: "Deals guide" },
  roles: { href: "/docs/permissions", label: "Permissions guide" },
  polls: { href: "/docs/community", label: "Polls and announcements" },
  announcements: { href: "/docs/community", label: "Polls and announcements" },
};
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
          Configuration only — not a live delivery or playback test.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate("channels")}
        >
          Channels & permissions
        </Button>
        {MODULE_GUIDE[module] && (
          <Link
            href={MODULE_GUIDE[module]!.href}
            className="text-[11px] text-primary underline-offset-2 hover:underline"
          >
            {MODULE_GUIDE[module]!.label}
          </Link>
        )}
      </div>
    </Card>
  );
}
