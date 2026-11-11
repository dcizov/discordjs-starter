// @vitest-environment jsdom
/*
 * One rule for vertical rhythm inside a dialog, owned by the container.
 *
 * `DialogContent` used to supply padding and nothing else, while
 * `DialogHeader` carried its own `mb-6`. Everything below the heading was
 * therefore unspaced unless a dialog happened to add its own, so the shape of
 * a dialog depended on whether its author remembered. The member role editor
 * shipped with its role list sitting flush against the search field above it,
 * and the template detail dialog stacked its sections the same way.
 *
 * The container now spaces its own children and the header contributes no
 * margin, so the two cannot compound into a 40px gap under every heading.
 * Without these tests the rule is a comment, and the next dialog is free to
 * reintroduce a local margin that doubles up.
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

function renderDialog() {
  render(
    <Dialog open>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>A heading</DialogTitle>
          <DialogDescription>Some supporting copy.</DialogDescription>
        </DialogHeader>
        <p>first body element</p>
        <p>second body element</p>
      </DialogContent>
    </Dialog>
  );
  return screen.getByRole("dialog");
}

afterEach(cleanup);

describe("dialog vertical rhythm", () => {
  it("spaces the dialog's own children, so no dialog has to", () => {
    const content = renderDialog();
    expect(content.className).toMatch(/\bspace-y-\d/);
  });

  it("gives the header no bottom margin, which would compound with that", () => {
    const content = renderDialog();
    const heading = screen.getByRole("heading", { name: "A heading" });
    const header = heading.parentElement;
    expect(header).not.toBeNull();
    // The header must sit inside the content rather than being the content.
    expect(content.contains(header as Node)).toBe(true);
    expect((header as HTMLElement).className).not.toMatch(/\bmb-\d/);
  });

  it("keeps title and description, which the header spaces internally", () => {
    renderDialog();
    expect(screen.getByRole("heading", { name: "A heading" })).toBeTruthy();
    expect(screen.getByText("Some supporting copy.")).toBeTruthy();
  });
});
