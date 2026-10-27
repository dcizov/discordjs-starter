"use client";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, BookOpen } from "lucide-react";
import { Button } from "../ui/button";
import { useWorkspace } from "../workspace";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
type Props = { open: boolean; onOpenChange: (open: boolean) => void };
export function ModeInfoDialog({ open, onOpenChange }: Props) {
  const { data } = useWorkspace();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {data.demo
              ? "A real feel. A safe little sandbox."
              : "Your community. Your control."}
          </DialogTitle>
          <DialogDescription>
            {data.demo
              ? "Everything you need to explore Orbit, without connecting your Discord account."
              : "Orbit uses Discord OAuth2 to verify who can manage each server."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-xs leading-relaxed text-muted-foreground">
          {data.demo ? (
            <>
              <p>
                <strong className="text-foreground">
                  Your changes are real.
                </strong>{" "}
                Panels, rules, sources, settings, and the demo economy are saved
                to this environment’s local store.
              </p>
              <p>
                <strong className="text-foreground">
                  Your messages aren’t.
                </strong>{" "}
                No Discord messages, moderation actions, external feed requests,
                or audio playback happen in demo mode. Health and activity
                metrics are clearly simulated.
              </p>
              <p>
                To go live, configure the environment variables in the
                repository’s <code>.env.example</code>, start PostgreSQL and
                Redis, and follow the deployment guide.
              </p>
            </>
          ) : (
            <>
              <p>
                Every configuration change is authorized on the server. Only
                users with <strong>Manage Server</strong> or{" "}
                <strong>Administrator</strong> permission can use this
                workspace.
              </p>
              <p>
                Tokens and integration credentials never leave the server.
                Configuration changes are recorded in your audit log.
              </p>
            </>
          )}
        </div>
        <Button className="mt-6 w-full" onClick={() => onOpenChange(false)}>
          Got it. Let’s explore <ArrowRight />
        </Button>
      </DialogContent>
    </Dialog>
  );
}
export function HelpDialog({
  open,
  onOpenChange,
  onReplayTour,
}: Props & { onReplayTour?: () => void }) {
  const { navigate } = useWorkspace();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>A little help getting into orbit.</DialogTitle>
          <DialogDescription>
            Start small. Make it yours. We’ll handle the busywork.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {[
            {
              title: "1. Put your roles in order",
              text: "Move the Orbit role above any roles you want it to assign. Privileged and integration roles are always protected.",
              page: "roles",
            },
            {
              title: "2. Choose what comes through",
              text: "Connect verified RSS/Atom feeds, Steam app news, or signed webhooks. Test a source before turning on deliveries.",
              page: "news",
            },
            {
              title: "3. Make the rules feel like home",
              text: "Set moderation rules, choose your audit channel, and give your moderators the right permissions.",
              page: "moderation",
            },
          ].map((h) => (
            <button
              key={h.title}
              className="w-full rounded-xl border p-4 text-left transition hover:bg-muted"
              onClick={() => {
                navigate(h.page);
                onOpenChange(false);
              }}
            >
              <h3 className="flex items-center justify-between text-xs font-semibold">
                {h.title}
                <ArrowUpRight size={13} className="text-primary" />
              </h3>
              <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                {h.text}
              </p>
            </button>
          ))}
        </div>
        {onReplayTour && (
          <Button
            variant="outline"
            className="mt-4 w-full"
            onClick={onReplayTour}
          >
            Replay the introduction
          </Button>
        )}
        <div className="mt-5 border-t pt-4">
          <p className="flex items-center gap-2 text-[11px] font-medium">
            <BookOpen size={14} />
            Documentation
          </p>
          <ul className="mt-2 grid grid-cols-2 gap-1.5 text-[11px]">
            {[
              { href: "/docs/start-here", label: "Install and first setup" },
              { href: "/docs/permissions", label: "Permissions" },
              { href: "/docs/dashboard", label: "Dashboard guide" },
              { href: "/docs/music", label: "Music and voice" },
              { href: "/docs/news", label: "News sources" },
              { href: "/docs/deals", label: "Deals and watchlists" },
            ].map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-primary underline-offset-2 hover:underline"
                  onClick={() => onOpenChange(false)}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <Link
            href="/docs"
            className="mt-2 inline-block text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => onOpenChange(false)}
          >
            All user and developer guides
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}
