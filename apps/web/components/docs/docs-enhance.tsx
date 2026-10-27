"use client";
import { copyText } from "@/lib/clipboard";
import { useEffect } from "react";
import { toast } from "sonner";

/**
 * Progressive enhancement for rendered Markdown.
 *
 * The guide HTML is produced at build time and injected as a string, so the two
 * interactive affordances cannot be React components inside it. This component
 * wires them after hydration, and only then reveals them:
 *
 * - **Copy** on a fenced code block copies the block exactly as written.
 * - **Clicking a section's `#` anchor** copies the absolute deep link (the
 *   navigation itself is a normal link and still works with JavaScript off).
 *
 * Nothing here removes or rewrites markup, filters console output or touches
 * extension-injected attributes; it only adds behaviour to controls this app
 * rendered itself.
 */
export function DocsEnhance({
  targetId = "docs-article",
}: {
  targetId?: string;
}) {
  useEffect(() => {
    const root = document.getElementById(targetId);
    if (!root) return;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const cleanups: (() => void)[] = [];

    const buttons = Array.from(
      root.querySelectorAll<HTMLButtonElement>("[data-docs-copy]")
    );
    for (const button of buttons) {
      const onClick = async () => {
        const code = button.closest(".docs-code")?.querySelector("pre");
        const text = code?.textContent ?? "";
        if (!text.trim()) return;
        try {
          await copyText(text);
          button.dataset.copied = "true";
          button.textContent = "Copied";
          toast.success("Code copied");
          const timer = setTimeout(() => {
            button.dataset.copied = "false";
            button.textContent = "Copy";
            timers.delete(timer);
          }, 2000);
          timers.add(timer);
        } catch {
          toast.error("Copy failed. Select the code and copy it manually.");
        }
      };
      button.addEventListener("click", onClick);
      cleanups.push(() => button.removeEventListener("click", onClick));
    }

    // Revealed only once the handlers above are attached, so a reader without
    // JavaScript never sees a control that cannot work.
    if (buttons.length) root.dataset.docsCopyReady = "true";

    const onAnchorClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor = (
        event.target as Element | null
      )?.closest<HTMLAnchorElement>("a[data-docs-anchor]");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href?.startsWith("#")) return;
      const url = new URL(href, window.location.href).href;
      void copyText(url)
        .then(() => toast.success("Section link copied"))
        .catch(() => undefined);
    };
    root.addEventListener("click", onAnchorClick);
    cleanups.push(() => root.removeEventListener("click", onAnchorClick));

    return () => {
      for (const clear of cleanups) clear();
      for (const timer of timers) clearTimeout(timer);
      delete root.dataset.docsCopyReady;
    };
  }, [targetId]);
  return null;
}
