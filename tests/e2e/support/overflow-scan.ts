/**
 * Finding what makes a narrow page scroll sideways.
 *
 * `documentElement.scrollWidth <= window.innerWidth` returns one bit. When it
 * is false, every reader — including CI — is left to open a browser and bisect
 * by hand, which in practice means the failure sits until someone has a spare
 * hour. Naming the element over the line, and by how many pixels, is the whole
 * value of the check; the boolean is only the trigger.
 *
 * The scan is deliberately a free function of its one argument so that it can
 * be handed to `page.evaluate` (which serialises the source, so it must close
 * over nothing) *and* imported by a unit test that runs it against jsdom.
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

/** How far past the viewport counts as overflow. Sub-pixel layout is not. */
export const OVERFLOW_TOLERANCE_PX = 1;

/** Deepest path kept per offender — enough to place it, short enough to read. */
const MAX_PATH_DEPTH = 6;

/** Classes kept per path segment. */
const MAX_CLASSES_PER_SEGMENT = 3;

/** Offenders reported, widest first. */
const MAX_REPORTED = 8;

/** Characters of text kept per offender. */
const MAX_TEXT = 60;

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

/**
 * Elements whose right edge sits past `viewportWidth`, widest first.
 *
 * Runs against the ambient `document`, so it is passed straight to
 * `page.evaluate` and to a jsdom test without a seam between them.
 */
export function scanOverflowOffenders(
  viewportWidth: number
): OverflowOffender[] {
  const out: OverflowOffender[] = [];
  for (const el of Array.from(document.querySelectorAll("*"))) {
    const r = el.getBoundingClientRect();
    // Skip the unrendered: display:none, empty wrappers, detached nodes.
    if (r.width === 0 && r.height === 0) continue;
    if (r.right - viewportWidth <= OVERFLOW_TOLERANCE_PX) continue;
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
