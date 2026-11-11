/**
 * Finding what makes a narrow page scroll sideways.
 *
 * `documentElement.scrollWidth <= window.innerWidth` returns one bit. When it
 * is false, every reader — including CI — is left to open a browser and bisect
 * by hand, which in practice means the failure sits until someone has a spare
 * hour. Naming the element over the line, and by how many pixels, is the whole
 * value of the check; the boolean is only the trigger.
 *
 * `scanOverflowOffenders` has to satisfy two callers whose needs pull apart:
 *
 * - `page.evaluate` serialises the function and runs the text of it in the
 *   page. Anything the function body names from module scope — a constant, a
 *   helper, another type — does not exist there. The first version of this
 *   file was written as if "a free function of one argument" meant it closed
 *   over nothing, and CI answered `OVERFLOW_TOLERANCE_PX is not defined`. It
 *   closed over seven module-level bindings.
 * - A unit test has to import it and run it against jsdom, which means it has
 *   to be a normal exported function.
 *
 * Both are met by making the body self-contained: every constant and helper
 * lives *inside* the function, so the source is complete on its own and
 * `new Function("return " + fn.toString())` can run it. A test asserts exactly
 * that, because the failure mode is invisible any other way — the module
 * imports cleanly and the unit tests pass while the page copy throws.
 */

export type OverflowOffender = {
  tag: string;
  id: string;
  className: string;
  text: string;
  right: number;
  width: number;
  path: string;
};

/**
 * Elements whose right edge sits past `viewportWidth`, widest first.
 *
 * Self-contained on purpose: see the note at the top of this file. Runs
 * against the ambient `document`, so `page.evaluate(scanOverflowOffenders, w)`
 * and a jsdom test exercise the same code with no seam between them.
 */
export function scanOverflowOffenders(
  viewportWidth: number
): OverflowOffender[] {
  // How far past the viewport counts as overflow. Sub-pixel layout is not.
  const OVERFLOW_TOLERANCE_PX = 1;
  // Deepest path kept per offender — enough to place it, short enough to read.
  const MAX_PATH_DEPTH = 6;
  // Classes kept per path segment.
  const MAX_CLASSES_PER_SEGMENT = 3;
  // Offenders reported, widest first.
  const MAX_REPORTED = 8;
  // Characters of text kept per offender.
  const MAX_TEXT = 60;
  /*
   * `overflow-x` values meaning "this element is meant to be wider than it
   * looks": the content is scrolled or clipped on purpose.
   */
  const SCROLLABLE_X = ["auto", "scroll", "hidden", "clip"];
  type Offender = {
    tag: string;
    id: string;
    className: string;
    text: string;
    right: number;
    width: number;
    path: string;
  };

  function segment(el: Element): string {
    const classes = (el.getAttribute("class") ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, MAX_CLASSES_PER_SEGMENT)
      .join(".");
    return el.tagName.toLowerCase() + (classes ? "." + classes : "");
  }

  function describePath(el: Element): string {
    const parts: string[] = [];
    let node: Element | null = el;
    while (node && parts.length < MAX_PATH_DEPTH) {
      parts.unshift(segment(node));
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  /*
   * Whether an ancestor clips or scrolls horizontally.
   *
   * This is what separates a defect from a design. A table cell inside a
   * container with `overflow-x: auto` is *supposed* to extend past the edge of
   * the screen — that is the whole point of the scroll container, and it is
   * how the narrow-screen table rule works. Reporting those cells as offenders
   * would mean the scan fails on every page that has a table, which is to say
   * every page worth checking.
   *
   * The defect this looks for is content that is wide with nothing to contain
   * it.
   */
  function insideHorizontalScroller(el: Element): boolean {
    let node = el.parentElement;
    while (node) {
      const overflowX = getComputedStyle(node).overflowX;
      if (SCROLLABLE_X.indexOf(overflowX) !== -1) return true;
      // An element that is not inside a scroller is not made innocent by an
      // ancestor that clips vertically, and one that is inside one is not
      // rescued by anything further up. Keep going: the nearest scroller is
      // the one that decides.
      node = node.parentElement;
    }
    return false;
  }

  const out: Offender[] = [];
  for (const el of Array.from(document.querySelectorAll("*"))) {
    const r = el.getBoundingClientRect();
    // Skip the unrendered: display:none, empty wrappers, detached nodes.
    if (r.width === 0 && r.height === 0) continue;
    if (r.right - viewportWidth <= OVERFLOW_TOLERANCE_PX) continue;
    if (insideHorizontalScroller(el)) continue;
    out.push({
      tag: el.tagName.toLowerCase(),
      id: el.id ?? "",
      className: el.getAttribute("class") ?? "",
      text: (el.textContent ?? "").trim().slice(0, MAX_TEXT),
      right: Math.round(r.right),
      width: Math.round(r.width),
      path: describePath(el),
    });
  }
  return out.sort((a, b) => b.right - a.right).slice(0, MAX_REPORTED);
}

/** Render offenders as the failure message a reader acts on. */
export function describeOffenders(
  offenders: readonly OverflowOffender[],
  viewportWidth: number
): string {
  return offenders
    .map(
      (o) =>
        `  right=${o.right} (viewport ${viewportWidth}, over by ${
          o.right - viewportWidth
        }) width=${o.width}\n    ${o.path}\n    text: ${JSON.stringify(o.text)}`
    )
    .join("\n");
}
