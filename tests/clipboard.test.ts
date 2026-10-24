import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "../apps/web/lib/clipboard";

const value =
  "  Exact stored error\r\n\tjava.example.Failure: details\nline 3  ";
afterEach(() => vi.unstubAllGlobals());
function fallback(succeeds: boolean) {
  const dialog = { appendChild: vi.fn() };
  class FakeElement {
    closest = vi.fn(() => dialog);
    focus = vi.fn();
  }
  class FakeHTMLElement extends FakeElement {}
  const previous = new FakeHTMLElement();
  const field = Object.assign(new FakeHTMLElement(), {
    value: "",
    readOnly: false,
    tabIndex: 0,
    style: { cssText: "" },
    setAttribute: vi.fn(),
    select: vi.fn(),
    remove: vi.fn(),
  });
  const range = {};
  const selection = {
    rangeCount: 1,
    getRangeAt: vi.fn(() => ({ cloneRange: () => range })),
    removeAllRanges: vi.fn(),
    addRange: vi.fn(),
  };
  const copied = vi.fn();
  let listener:
    | ((event: {
        clipboardData: { setData: typeof copied };
        preventDefault: () => void;
      }) => void)
    | undefined;
  const doc = {
    activeElement: previous,
    body: { appendChild: vi.fn() },
    createElement: vi.fn(() => field),
    addEventListener: vi.fn((_event, fn) => {
      listener = fn;
    }),
    removeEventListener: vi.fn(),
    execCommand: vi.fn(() => {
      if (succeeds)
        listener?.({
          clipboardData: { setData: copied },
          preventDefault: vi.fn(),
        });
      return succeeds;
    }),
  };
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal("HTMLElement", FakeHTMLElement);
  vi.stubGlobal("document", doc);
  vi.stubGlobal("window", { getSelection: () => selection });
  return { dialog, previous, field, selection, doc, copied };
}
describe("exact clipboard copying", () => {
  it("passes the original string to the clipboard API without trimming, wrapping, or formatting", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await copyText(value);
    expect(writeText).toHaveBeenCalledWith(value);
  });
  it("falls back after a rejected permission, stays inside the dialog, and restores focus/selection", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error("Permission denied");
        }),
      },
    });
    const state = fallback(true);
    await copyText(value);
    expect(state.dialog.appendChild.mock.calls[0]?.[0] === state.field).toBe(
      true
    );
    expect(state.copied).toHaveBeenCalledWith("text/plain", value);
    expect(state.field.remove).toHaveBeenCalledOnce();
    expect(state.previous.focus).toHaveBeenCalledOnce();
    expect(state.selection.addRange).toHaveBeenCalledOnce();
    expect(state.doc.removeEventListener).toHaveBeenCalledWith(
      "copy",
      expect.any(Function)
    );
  });
  it("uses the fallback when clipboard API is absent", async () => {
    vi.stubGlobal("navigator", {});
    const state = fallback(true);
    await copyText(value);
    expect(state.doc.execCommand).toHaveBeenCalledWith("copy");
  });
  it("rejects honestly if both mechanisms fail, while cleaning up temporary fields", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error("Blocked");
        }),
      },
    });
    const state = fallback(false);
    await expect(copyText(value)).rejects.toThrow("Clipboard is unavailable");
    expect(state.field.remove).toHaveBeenCalledOnce();
    expect(state.previous.focus).toHaveBeenCalledOnce();
  });
});
