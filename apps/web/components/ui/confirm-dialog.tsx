"use client";
import { Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";
import { Spinner } from "./primitives";

/**
 * Confirmation for a destructive action.
 *
 * Orbit has two of these (delete a shop item, delete a configuration) and both
 * previously hand-rolled the same footer: an outline "keep" button, a
 * destructive button with a spinner, and an `open`/`busy` dance the caller had to
 * remember. Centralising it keeps the one thing that matters consistent — the
 * destructive button is disabled while the request is in flight, the dialog
 * cannot be dismissed by overlay/escape mid-request, and the consequence is
 * stated in `description` — without inventing a generic dialog framework.
 *
 * It is an **alert dialog**, not a plain dialog: the role is `alertdialog`,
 * initial focus goes to the keep button (never to the destructive one), and
 * clicking the backdrop does not dismiss it, so an irreversible choice cannot be
 * made by accident.
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
  // A half-finished destructive request must not be dismissed into an unknown
  // state: the result would arrive with no visible owner.
  const close = () => {
    if (!busy) onOpenChange(false);
  };
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (busy && !next) return;
        onOpenChange(next);
      }}
    >
      <AlertDialogContent
        // Escape keeps working when nothing is in flight; while it is, the
        // dialog stays put like every other dismissal route.
        onEscapeKeyDown={(event) => {
          // Escape is handled here rather than by Radix so it follows the same
          // rule as every other dismissal route: ignored while a request is in
          // flight, a plain close otherwise.
          event.preventDefault();
          close();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} onClick={close}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            onClick={(event) => {
              // Keep the dialog open until the caller closes it on success.
              event.preventDefault();
              void onConfirm();
            }}
          >
            {busy ? <Spinner /> : <Trash2 size={13} />}
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
