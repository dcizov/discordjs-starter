"use client";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="rounded-2xl bg-amber-50 p-4 text-amber-600">
        <AlertTriangle size={28} />
      </div>
      <h1 className="mt-5 text-xl font-semibold">A small bump in the orbit.</h1>
      <p className="mt-2 max-w-md text-center text-sm text-muted-foreground">
        We couldn’t load this workspace. Check your permissions or service
        connection, then try again.
      </p>
      <div className="mt-6 flex gap-3">
        <Button variant="outline" asChild>
          <Link prefetch={false} href="/">
            Switch workspace
          </Link>
        </Button>
        <Button onClick={reset}>Try again</Button>
      </div>
    </main>
  );
}
