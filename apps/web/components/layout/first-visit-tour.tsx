"use client";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  Compass,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { useWorkspace } from "../workspace";
import {
  saveTourProgress,
  shouldShowTour,
  stepIndex,
  type TourOutcome,
} from "./tour-model";

type Step = {
  title: string;
  body: string;
  page?: string;
  action?: string;
};

/**
 * An introduction that explains the workspace instead of pointing spotlights at
 * selectors. Nothing here reads or writes server configuration, so a missing
 * module, channel or permission can never break it.
 */
export function FirstVisitTour({ replay = 0 }: { replay?: number }) {
  const { data, navigate } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const steps = useMemo<Step[]>(
    () => [
      {
        title: "Start with the right server",
        body: "Everything you see belongs to one Discord server. Switch servers from the sidebar; Orbit only lists servers where you can manage settings.",
      },
      {
        title: "Switch on only what you need",
        body: "Settings → modules decides which features are active. Nothing runs while a module is off, and switching one back on never replays missed deliveries.",
        page: "settings",
        action: "Open settings",
      },
      {
        title: "Give it the channels and permissions it needs",
        body: "Channels shows what Orbit can actually see and post to, based on the last sync. Missing permissions appear there rather than failing silently at posting time.",
        page: "channels",
        action: "Review channels",
      },
      {
        title: "Bring in news and game deals",
        body: "Add a source, test it to preview the exact cards, then route it to a channel. A test flight never sends anything to Discord.",
        page: "news",
        action: "Set up news",
      },
      {
        title: "Music plays in Discord, not here",
        body: "The dashboard only asks the bot for actions such as play, skip or volume. Audio needs a running bot in a voice channel plus a configured music backend, so the dashboard can show what is playing without producing sound itself.",
        page: "music",
        action: "Visit the listening room",
      },
      {
        title: "Check status and ask for help",
        body: "The overview shows saved configuration, connection state and delivery health separately, because those are different things. A little help? in the footer has the setup guides, and you can replay this tour from there.",
      },
    ],
    []
  );

  // Only look at local storage after mount: the server render has no notion of
  // this browser's completion state, and guessing would cause hydration drift.
  useEffect(() => {
    // Storage may be unavailable (private mode). Seeing the tour twice is a
    // better failure than an unusable dashboard.
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    if (shouldShowTour(storage, data.user.id)) setOpen(true);
  }, [data.user.id]);

  useEffect(() => {
    if (replay > 0) {
      setIndex(0);
      setOpen(true);
    }
  }, [replay]);

  function close(outcome: TourOutcome) {
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    saveTourProgress(storage, data.user.id, outcome);
    setOpen(false);
  }

  const step = steps[index];
  const last = index === steps.length - 1;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Escape and the close button are dismissals, not silent completions.
        if (!next) close("skipped");
      }}
    >
      <DialogContent aria-describedby="tour-description">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Compass size={17} className="text-primary" aria-hidden="true" />
            {step.title}
          </DialogTitle>
          <DialogDescription id="tour-description">
            Step {index + 1} of {steps.length} · a two-minute introduction. It
            changes nothing in your server.
          </DialogDescription>
        </DialogHeader>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          {step.body}
        </p>
        {data.demo && (
          <p className="mt-4 rounded-lg border border-violet-200/60 bg-violet-50/70 px-3 py-2 text-[11px] leading-relaxed text-violet-600 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300">
            Demo preview: this is simulated data. Nothing here reaches Discord.
          </p>
        )}
        <div
          className="mt-5 h-1 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Introduction progress"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={index + 1}
        >
          <div
            className="h-full rounded-full bg-primary/60 transition-[width] duration-300 motion-reduce:transition-none"
            style={{ width: `${((index + 1) / steps.length) * 100}%` }}
          />
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" onClick={() => close("skipped")}>
            Skip
          </Button>
          <div className="flex items-center gap-2">
            {step.page && (
              <Button
                variant="outline"
                onClick={() => {
                  navigate(step.page!);
                  close("finished");
                }}
              >
                {step.action ?? "Take me there"}
                <ArrowUpRight size={13} />
              </Button>
            )}
            <Button
              variant="outline"
              disabled={index === 0}
              onClick={() => setIndex((i) => stepIndex(i, -1, steps.length))}
            >
              <ArrowLeft size={13} />
              Back
            </Button>
            {last ? (
              <Button onClick={() => close("finished")}>
                <Check size={13} />
                Finish
              </Button>
            ) : (
              <Button
                onClick={() => setIndex((i) => stepIndex(i, 1, steps.length))}
              >
                Next
                <ArrowRight size={13} />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
