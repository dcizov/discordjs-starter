"use client";
import { Trash2 } from "lucide-react";
import { Button } from "./button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./dialog";
import { Spinner } from "./primitives";

/**
 * Confirmation dialog for a destructive action.
 *
 * Orbit has two of these (delete a shop item, delete a configuration) and both
 * previously hand-rolled the same footer: an outline "keep" button, a
 * destructive button with a spinner, and an `open`/`busy` dance the caller had to
 * remember. Centralising it keeps the one thing that matters consistent — the
 * destructive button is disabled while the request is in flight, the dialog
 * cannot be dismissed by overlay/escape mid-request, and the consequence is
 * stated in `description` — without inventing a generic dialog framework.
 *
 * The caller still owns the request and the error handling: `onConfirm` resolves
 * when the action succeeded, and only then does the dialog close.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  busy = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** What will happen, including what is *not* deleted. Never omit this. */
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // A half-finished destructive request must not be dismissed into an
        // unknown state: the result would arrive with no visible owner.
        if (busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => {
              void onConfirm();
            }}
          >
            {busy ? <Spinner /> : <Trash2 size={13} />}
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
