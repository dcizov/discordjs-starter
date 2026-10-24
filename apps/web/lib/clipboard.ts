/** Copy the supplied string verbatim. Resolve only after the browser reports success. */
export async function copyText(text: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Permissions and insecure contexts may block the modern clipboard API.
  }
  const previous = document.activeElement;
  const selection = window.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, i) =>
        selection.getRangeAt(i).cloneRange()
      )
    : [];
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.tabIndex = -1;
  field.setAttribute("aria-hidden", "true");
  field.style.cssText =
    "position:fixed;inset:0 auto auto 0;opacity:0;pointer-events:none";
  // Stay inside a dialog's focus trap when invoked from an audit detail modal.
  const parent =
    previous instanceof Element ? previous.closest('[role="dialog"]') : null;
  (parent ?? document.body).appendChild(field);
  const onCopy = (event: ClipboardEvent) => {
    if (event.clipboardData) {
      event.clipboardData.setData("text/plain", text);
      event.preventDefault();
    }
  };
  document.addEventListener("copy", onCopy);
  try {
    field.focus({ preventScroll: true });
    field.select();
    if (!document.execCommand("copy"))
      throw new Error("Clipboard is unavailable");
  } finally {
    document.removeEventListener("copy", onCopy);
    field.remove();
    if (previous instanceof HTMLElement)
      previous.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
}
