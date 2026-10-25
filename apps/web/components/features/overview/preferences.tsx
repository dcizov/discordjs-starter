"use client";
import { useState } from "react";
import { Check, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useWorkspace } from "../../workspace";
import { Button } from "../../ui/button";
import { Switch } from "../../ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../ui/dialog";
export function OverviewPreferences() {
  const { data, saveConfig } = useWorkspace();
  const config = data.guild.config;
  const [customize, setCustomize] = useState(false);
  const [customizeBusy, setCustomizeBusy] = useState(false);
  return (
    <>
      <Button
        variant="outline"
        className="h-[34px] text-[11px]"
        onClick={() => setCustomize(true)}
      >
        <SlidersHorizontal size={13} />
        Customize
      </Button>
      <Dialog
        open={customize}
        onOpenChange={(open) => {
          if (!customizeBusy) setCustomize(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your overview, your way.</DialogTitle>
            <DialogDescription>
              Choose what welcomes you when you open your workspace.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            {[
              {
                key: "showHero",
                title: "A little welcome",
                text: "A calm moment before the details.",
              },
              {
                key: "showActivity",
                title: "Community activity & bot health",
                text: "The pulse of your community, at a glance.",
              },
              {
                key: "showToolkit",
                title: "Your community toolkit",
                text: "Quick access to the things that keep you connected.",
              },
            ].map((c) => (
              <div
                className="flex items-center justify-between gap-4"
                key={c.key}
              >
                <div>
                  <h3 className="text-xs font-medium">{c.title}</h3>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {c.text}
                  </p>
                </div>
                <Switch
                  aria-label={c.title}
                  disabled={customizeBusy}
                  checked={
                    config.dashboard[c.key as keyof typeof config.dashboard]
                  }
                  onCheckedChange={async (v) => {
                    setCustomizeBusy(true);
                    try {
                      await saveConfig({
                        ...config,
                        dashboard: { ...config.dashboard, [c.key]: v },
                      });
                      toast.success("Overview updated");
                    } catch (e) {
                      toast.error(
                        e instanceof Error
                          ? e.message
                          : "Overview update failed"
                      );
                    } finally {
                      setCustomizeBusy(false);
                    }
                  }}
                />
              </div>
            ))}
          </div>
          <Button
            className="mt-7 w-full"
            disabled={customizeBusy}
            onClick={() => setCustomize(false)}
          >
            Looks like home
            <Check />
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
