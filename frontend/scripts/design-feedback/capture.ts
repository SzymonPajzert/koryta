/** Screenshots for the design board that remember what they show.
 *
 * `shoot` is a drop-in for `page.screenshot` in a render script: it writes
 * the PNG and, beside it, the DOM census (dom.ts) that lets Szymon click an
 * element instead of drawing round it, and lets the digest name what a box is
 * on. Without the census a round still works; boxes are then coordinates and
 * a crop.
 *
 *   import { shoot } from "<workspace>/frontend/scripts/design-feedback/capture";
 *   await shoot(page, `${out}/tip/out-desktop/osoba.png`);          // full page
 *   await shoot(page, file, { fullPage: false });                    // the window
 *   await shoot(page.locator(".person-head"), file);                 // one element
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Locator, Page } from "playwright";
import { CENSUS_SCRIPT, domFileFor, type DomCensus } from "./dom";

type Census = Omit<DomCensus, "v" | "origin" | "capturedAt"> & {
  scroll: { x: number; y: number };
};

const isPage = (target: Page | Locator): target is Page => "goto" in target;

/** Screenshot `target` to `file` (a .png) and write `<file>.dom.json` beside
 * it. Returns the census's path. */
export async function shoot(
  target: Page | Locator,
  file: string,
  options: { fullPage?: boolean } = {},
): Promise<string> {
  mkdirSync(dirname(file), { recursive: true });
  const page = isPage(target) ? target : target.page();
  const { scroll, ...census } = (await page.evaluate(CENSUS_SCRIPT)) as Census;
  let origin = { x: 0, y: 0 };
  if (isPage(target)) {
    const fullPage = options.fullPage ?? true;
    if (!fullPage) origin = scroll;
    await target.screenshot({ path: file, fullPage });
  } else {
    // The element's corner in the document: its box on screen plus the
    // scroll, both read now, before the screenshot scrolls it into view.
    const box = await target.boundingBox();
    if (!box) throw new Error(`Nothing to photograph: ${String(target)}`);
    origin = { x: box.x + scroll.x, y: box.y + scroll.y };
    await target.screenshot({ path: file });
  }
  const out = domFileFor(file);
  const sidecar: DomCensus = {
    v: 1,
    ...census,
    origin,
    capturedAt: new Date().toISOString(),
  };
  writeFileSync(out, JSON.stringify(sidecar));
  return out;
}
