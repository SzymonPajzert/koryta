/** What was under each pixel of a screenshot, so a box drawn on it can be
 * handed to the agent as the elements it covers, not only as coordinates.
 *
 * capture.ts takes the census in the page right before the screenshot and
 * keeps it beside the PNG as `<name>.dom.json`. The board uses it to snap a
 * click to the element under it; the digest to say what a box is on.
 */
import type { Region } from "./store";

/** One visible element: its box in CSS pixels of the document, the nearest
 * visible ancestor's index (-1 for none), and what names it. */
export type DomRow = [
  x: number,
  y: number,
  w: number,
  h: number,
  parent: number,
  tag: string,
  id: string,
  cls: string,
  text: string,
  label: string,
  testid: string,
  scopes: string,
];

export type DomCensus = {
  v: 1;
  url: string;
  title: string;
  viewport: { w: number; h: number };
  dpr: number;
  /** Where the image's top left corner is in the document: 0,0 for a full
   * page, the scroll position for a window, the element's corner for an
   * element shot. */
  origin: { x: number; y: number };
  capturedAt: string;
  els: DomRow[];
};

export type DomElement = {
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  parent: number;
  tag: string;
  id: string;
  cls: string;
  text: string;
  label: string;
  testid: string;
  /** `data-v-` ids of the scoped styles on the element, without the prefix. */
  scopes: string[];
};

export const domFileFor = (png: string) =>
  png.replace(/\.png$/i, "") + ".dom.json";

/** The census, as a string: playwright sends a function's source to the page,
 * and a function compiled by tsx calls a `__name` helper the page does not
 * have. Walks the body depth first in document order; skips what draws
 * nothing and the insides of SVGs; stops at 30,000 elements. */
export const CENSUS_SCRIPT = `(() => {
  const SKIP = new Set(["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT", "TEMPLATE", "BR", "WBR"]);
  const sx = window.scrollX, sy = window.scrollY;
  const r2 = (n) => Math.round(n * 2) / 2;
  const els = [];
  const stack = [[document.body, -1]];
  while (stack.length && els.length < 30000) {
    const [el, parent] = stack.pop();
    if (SKIP.has(el.tagName)) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none") continue;
    const r = el.getBoundingClientRect();
    let me = parent;
    if (r.width >= 1 && r.height >= 1 && cs.visibility !== "hidden" && cs.opacity !== "0") {
      me = els.length;
      let text = "";
      for (const n of el.childNodes) if (n.nodeType === 3) text += " " + n.textContent;
      text = text.replace(/\\s+/g, " ").trim().slice(0, 100);
      const label = (el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("alt") || el.getAttribute("placeholder") || "").slice(0, 80);
      const cls = (el.getAttribute("class") || "").replace(/\\s+/g, " ").trim().slice(0, 200);
      const scopes = el.getAttributeNames().filter((a) => a.startsWith("data-v-")).map((a) => a.slice(7)).join(" ");
      els.push([r2(r.left + sx), r2(r.top + sy), r2(r.width), r2(r.height), parent, el.tagName.toLowerCase(), el.id || "", cls, text, label, el.getAttribute("data-testid") || "", scopes]);
    }
    if (el.tagName === "svg" || el.tagName === "SVG") continue;
    for (let i = el.children.length - 1; i >= 0; i--) stack.push([el.children[i], me]);
  }
  return { url: location.href, title: document.title, viewport: { w: innerWidth, h: innerHeight }, dpr: devicePixelRatio, scroll: { x: sx, y: sy }, els };
})()`;

export function decodeCensus(census: DomCensus): DomElement[] {
  return census.els.map(
    (
      [x, y, w, h, parent, tag, id, cls, text, label, testid, scopes],
      index,
    ) => ({
      index,
      x,
      y,
      w,
      h,
      parent,
      tag,
      id,
      cls,
      text,
      label,
      testid,
      scopes: scopes ? scopes.split(" ") : [],
    }),
  );
}

/** A region in image pixels, as a box in CSS pixels of the document. */
export const regionInDocument = (
  region: Region,
  dpr: number,
  origin: { x: number; y: number },
): Region => ({
  x: region.x / dpr + origin.x,
  y: region.y / dpr + origin.y,
  w: region.w / dpr,
  h: region.h / dpr,
});

const area = (b: { w: number; h: number }) => b.w * b.h;

function overlap(a: Region, b: Region): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

const contains = (outer: Region, inner: Region, slack = 2) =>
  outer.x - slack <= inner.x &&
  outer.y - slack <= inner.y &&
  outer.x + outer.w + slack >= inner.x + inner.w &&
  outer.y + outer.h + slack >= inner.y + inner.h;

/** What a box is on, for the digest.
 *
 * `on` is the element the box means: one it fits snugly (most of each is the
 * other - a click snapped to an element, or a box drawn round one), else the
 * smallest element that holds the whole box. `inside` is what the box frames:
 * elements with something to read, mostly inside it, in document order. A box
 * of no size is a point, and has nothing inside. */
export function elementsIn(
  els: DomElement[],
  box: Region,
): { on: DomElement | null; inside: DomElement[] } {
  const holders = els.filter((e) => contains(e, box));
  const smallest = holders.reduce<DomElement | null>(
    (best, e) => (!best || area(e) < area(best) ? e : best),
    null,
  );
  if (area(box) === 0) return { on: smallest, inside: [] };

  // Wrappers often share their child's box exactly. On a tie the later
  // element wins, and in document order that is the one further in.
  let snug: DomElement | null = null;
  let snugScore = 0.7;
  for (const e of els) {
    const shared = overlap(e, box);
    if (shared === 0) continue;
    const score = Math.min(shared / area(e), shared / area(box));
    const tie = snug !== null && Math.abs(score - snugScore) < 1e-9;
    if (
      (score > snugScore && !tie) ||
      (tie && snug !== null && area(e) <= area(snug))
    ) {
      snug = e;
      snugScore = score;
    }
  }
  const on = snug ?? smallest;

  const seen = new Set<string>();
  const inside: DomElement[] = [];
  for (const e of els) {
    if (e === on || !(e.text || e.label)) continue;
    if (overlap(e, box) < 0.7 * area(e)) continue;
    const said = e.text || e.label;
    if (seen.has(said)) continue;
    seen.add(said);
    inside.push(e);
    if (inside.length === 8) break;
  }
  return { on, inside };
}

/** The classes worth reading out: Vuetify's modifiers (`v-btn--size-default`)
 * and theme classes say nothing about which element it is. */
const telling = (cls: string) =>
  cls
    .split(" ")
    .filter((c) => c && !c.includes("--") && !c.startsWith("v-theme"))
    .slice(0, 3);

/** `span.dates#x`, the way a selector would name it. */
export function selectorOf(e: DomElement): string {
  return (
    e.tag +
    (e.id ? `#${e.id}` : "") +
    telling(e.cls)
      .map((c) => `.${c}`)
      .join("")
  );
}

const quoted = (s: string, max = 60) =>
  s ? ` "${s.length > max ? s.slice(0, max - 1) + "…" : s}"` : "";

/** `span.dates "2004-2008"`: the selector and what it says. */
export const describeElement = (e: DomElement) =>
  selectorOf(e) +
  quoted(e.text || e.label) +
  (e.testid ? ` [data-testid=${e.testid}]` : "");

/** The element and up to three ancestors, outermost first. */
export function pathTo(els: DomElement[], e: DomElement, depth = 4): string {
  const chain: DomElement[] = [];
  for (let at: DomElement | undefined = e; at && chain.length < depth;) {
    chain.unshift(at);
    at = at.parent >= 0 ? els[at.parent] : undefined;
  }
  return chain.map(selectorOf).join(" > ");
}

/** The scoped-style ids on the element or its nearest ancestor that has any:
 * the component that drew it, when the build gave it a `<style scoped>`. */
export function scopesOf(els: DomElement[], e: DomElement): string[] {
  for (let at: DomElement | undefined = e; at;) {
    if (at.scopes.length) return at.scopes;
    at = at.parent >= 0 ? els[at.parent] : undefined;
  }
  return [];
}
