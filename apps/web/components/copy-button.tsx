"use client";
import { copyText } from "@/lib/clipboard";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";

export function CopyButton({
  text,
  label = "Copy details",
  success = "Details copied exactly as recorded",
}: {
  text: string;
  label?: string;
  success?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setCopied(false);
    return () => {
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, [text]);
  return (
    <Button
      variant="outline"
      size="sm"
      aria-label={label}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        setCopied(false);
        if (timeout.current) clearTimeout(timeout.current);
        try {
          await copyText(text);
          setCopied(true);
          toast.success(success);
          timeout.current = setTimeout(() => setCopied(false), 2000);
        } catch {
          toast.error("Copy failed. Select the text and copy it manually.");
        } finally {
          setBusy(false);
        }
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Copied!" : label}
    </Button>
  );
}
