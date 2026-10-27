"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Clock3, ShieldAlert } from "lucide-react";
import { Button } from "./ui/button";

/** Expected upstream failures must not throw into Next's runtime-error overlay. */
export function AuthProblem({
  status,
  message,
  retryAfterSeconds = 0,
}: {
  status: number;
  message: string;
  retryAfterSeconds?: number;
}) {
  // The first paint shows the server's own number, so the client's first render
  // matches the HTML. The deadline is only resolved in the effect, on the
  // client: the server response says "come back in 30 seconds", not "come back
  // at a fixed instant", and a deadline stamped during the server render would
  // be wrong for any HTML the browser reuses (back/forward restore, prefetch).
  const [remaining, setRemaining] = useState(retryAfterSeconds);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const deadline = useRef(0);
  useEffect(() => {
    if (deadline.current === 0)
      deadline.current = Date.now() + retryAfterSeconds * 1000;
    const tick = () =>
      setRemaining(
        Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000))
      );
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [retryAfterSeconds]);
  const denied = status === 403;
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <section
        className="w-full max-w-lg rounded-2xl border bg-card p-8 text-center shadow-sm"
        aria-labelledby="auth-problem-title"
      >
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-300">
          {denied ? <ShieldAlert size={28} /> : <Clock3 size={28} />}
        </div>
        <h1 id="auth-problem-title" className="text-2xl font-semibold">
          {denied
            ? "Server access denied"
            : status === 429
              ? "Discord needs a moment"
              : "Discord is temporarily unavailable"}
        </h1>
        <p
          className="mt-4 text-sm leading-relaxed text-muted-foreground"
          role="status"
        >
          {message}
        </p>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Nothing was changed. Your server settings remain protected.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Button variant="outline" asChild>
            <Link href="/login" prefetch={false}>
              Sign in again
            </Link>
          </Button>
          <Button
            disabled={remaining > 0 || pending}
            onClick={() => startTransition(() => router.refresh())}
          >
            {pending
              ? "Checking…"
              : remaining > 0
                ? `Try again in ${remaining}s`
                : "Try again"}
          </Button>
        </div>
      </section>
    </main>
  );
}
