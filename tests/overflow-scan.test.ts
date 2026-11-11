// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import {
  describeOffenders,
  scanOverflowOffenders,
  type OverflowOffender,
} from "../tests/e2e/support/overflow-scan";

/**
 * The overflow scan is what turns "this page scrolls sideways" into the name of
 * the element doing it. A scan that cannot find an element it was written to
 * find is worse than no scan, so these assertions run against a real DOM with
 * controlled geometry rather than against a mocked function.
 */

const VIEWPORT = 390;

/**
 * Give elements a rect from a `data-right` / `data-bottom` attribute.
 *
 * jsdom does no layout, so `getBoundingClientRect` is all zeros and every
 * element would be skipped as unrendered. Geometry is therefore declared by
 * the fixture and read by the scan, which is the only seam that matters here.
 */
function withRects(root: ParentNode) {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const right = Number(this.getAttribute("data-right") ?? "0");
    const bottom = Number(this.getAttribute("data-bottom") ?? "0");
    const width = Number(this.getAttribute("data-width") ?? String(right));
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right,
      bottom,
      width,
      height: bottom,
      toJSON: () => ({}),
    } as DOMRect;
  };
  void root;
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
  document.body.innerHTML = "";
});

function render(html: string) {
  document.body.innerHTML = html;
  restore = withRects(document.body);
}

describe("scanOverflowOffenders", () => {
  it("reports nothing when every element fits", () => {
    render(`<div data-right="390" data-bottom="20">fits</div>`);
    expect(scanOverflowOffenders(VIEWPORT)).toEqual([]);
  });

  it("reports an element whose right edge is past the viewport", () => {
    render(
      `<div data-right="480" data-bottom="20" class="wide-card">too wide</div>`
    );
    const found = scanOverflowOffenders(VIEWPORT);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      tag: "div",
      className: "wide-card",
      text: "too wide",
      right: 480,
    });
  });

  it("ignores a one-pixel excess, because sub-pixel layout is not overflow", () => {
    render(`<div data-right="391" data-bottom="20">rounding</div>`);
    expect(scanOverflowOffenders(VIEWPORT)).toEqual([]);
  });

  it("skips elements that render nothing", () => {
    // No data-right/data-bottom at all: jsdom default, and the real-world
    // display:none case, both of which are zero-sized.
    render(`<div class="hidden-thing">unrendered</div>`);
    expect(scanOverflowOffenders(VIEWPORT)).toEqual([]);
  });

  it("skips a zero-sized element even when its rect says it is off-screen", () => {
    // A hidden element keeps a stale rect in some layouts — a `display:none`
    // node measured before it was hidden still reports a right edge. Reporting
    // it would send the reader looking for an element that is not on screen.
    // Width and height are both zero; only `right` is a leftover.
    render(
      `<div data-right="900" data-bottom="0" data-width="0" class="offscreen">gone</div>`
    );
    expect(scanOverflowOffenders(VIEWPORT)).toEqual([]);
  });

  it("reports a zero-height element that is genuinely wide", () => {
    // The guard is on width *and* height, not on either alone: a wide element
    // with no height (a separator, a collapsed row) is still real overflow.
    render(
      `<hr data-right="900" data-bottom="0" data-width="900" class="rule" />`
    );
    expect(scanOverflowOffenders(VIEWPORT).map((o) => o.className)).toEqual([
      "rule",
    ]);
  });

  it("orders offenders widest-first, so the first line is the one to read", () => {
    render(`
      <div data-right="400" data-bottom="10" class="slightly">a</div>
      <div data-right="900" data-bottom="10" class="way">b</div>
      <div data-right="600" data-bottom="10" class="middling">c</div>
    `);
    expect(scanOverflowOffenders(VIEWPORT).map((o) => o.className)).toEqual([
      "way",
      "middling",
      "slightly",
    ]);
  });

  it("reports the containing path, not only the leaf, so the element is findable", () => {
    render(`
      <main class="dashboard">
        <section class="news-feed">
          <div data-right="500" data-bottom="10" class="row">
            <span class="label">A very long source name</span>
          </div>
        </section>
      </main>
    `);
    const [found] = scanOverflowOffenders(VIEWPORT);
    // html is included: it is the document element, and a reader who sees it
    // knows the path is complete rather than truncated.
    expect(found.path).toBe(
      "html > body > main.dashboard > section.news-feed > div.row"
    );
  });

  it("blames the overflowing ancestor before the child carried along with it", () => {
    // The common real case: the wrapper is too wide and the button inside is
    // innocent, merely pushed over the line. Both are reported, but the
    // ancestor sorts first, so the first line names the element to fix.
    render(`
      <div data-right="700" data-bottom="20" class="toolbar">
        <button data-right="690" data-bottom="20" class="btn">Save</button>
      </div>
    `);
    const found = scanOverflowOffenders(VIEWPORT);
    expect(found.map((o) => o.tag)).toEqual(["div", "button"]);
    expect(found[0].className).toBe("toolbar");
  });

  it("does not report a child that fits inside an overflowing ancestor", () => {
    // Blaming the innocent child would send the reader to the wrong element.
    render(`
      <div data-right="700" data-bottom="20" class="toolbar">
        <button data-right="100" data-bottom="20" class="btn">Save</button>
      </div>
    `);
    expect(scanOverflowOffenders(VIEWPORT).map((o) => o.className)).toEqual([
      "toolbar",
    ]);
  });

  it("keeps the text short enough to read in a failure message", () => {
    render(
      `<p data-right="800" data-bottom="10">${"long unbroken string ".repeat(
        20
      )}</p>`
    );
    expect(scanOverflowOffenders(VIEWPORT)[0].text.length).toBeLessThanOrEqual(
      60
    );
  });

  it("caps how many offenders it reports", () => {
    render(
      Array.from(
        { length: 30 },
        (_, i) =>
          `<div data-right="${400 + i}" data-bottom="10" class="c${i}">x</div>`
      ).join("")
    );
    expect(scanOverflowOffenders(VIEWPORT)).toHaveLength(8);
  });
});

describe("describeOffenders", () => {
  it("names the element, its distance past the line, and its text", () => {
    const offender: OverflowOffender = {
      tag: "div",
      id: "",
      className: "source-row",
      text: "Rock Paper Shotgun",
      right: 512,
      width: 512,
      path: "main > section > div.source-row",
    };
    const message = describeOffenders([offender], VIEWPORT);
    expect(message).toContain("viewport 390");
    expect(message).toContain("over by 122");
    expect(message).toContain("div.source-row");
    expect(message).toContain("Rock Paper Shotgun");
  });

  it("renders an empty list as an empty string", () => {
    expect(describeOffenders([], VIEWPORT)).toBe("");
  });

  it("separates multiple offenders so each is readable on its own line", () => {
    const one: OverflowOffender = {
      tag: "div",
      id: "",
      className: "a",
      text: "first",
      right: 400,
      width: 400,
      path: "div.a",
    };
    const two: OverflowOffender = {
      tag: "span",
      id: "",
      className: "b",
      text: "second",
      right: 500,
      width: 500,
      path: "span.b",
    };
    const lines = describeOffenders([one, two], VIEWPORT).split("\n");
    expect(lines.filter((l) => l.startsWith("  right="))).toHaveLength(2);
    expect(lines.filter((l) => l.includes("first"))).toHaveLength(1);
    expect(lines.filter((l) => l.includes("second"))).toHaveLength(1);
  });
});
