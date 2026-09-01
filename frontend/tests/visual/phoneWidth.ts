import { expect, type Page, type TestInfo } from "@playwright/test";

/** Fails when the page is wider than the phone it is being read on.
 *
 * The baselines already notice this, but only as a shot that is suddenly 502px
 * wide instead of 375 - which says something changed without saying what, and
 * is easy to accept as "the card got bigger" when regenerating. The cause is
 * always the same shape of thing: one element that will not wrap and will not
 * shrink, usually a row of `v-btn`s. `app/layouts/default.vue` stops that from
 * silently resizing the page around it, so what is left is an element sticking
 * out of a page that is otherwise the right width.
 *
 * Pinning the shell as well covers the parts of the chrome that sit outside
 * that container, and makes the failure able to name the culprit rather than
 * only its width. It mutates the page, which is why this has to be called
 * after the screenshot rather than before.
 */
export async function expectFitsThePhone(page: Page, testInfo: TestInfo) {
  if (testInfo.project.name !== "visual-mobile") return;

  const { doc, viewport, culprits } = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const doc = document.documentElement.scrollWidth;
    const wrap = document.querySelector<HTMLElement>(".v-application__wrap");
    if (wrap) {
      wrap.style.minWidth = "0";
      wrap.style.width = `${viewport}px`;
      wrap.style.maxWidth = `${viewport}px`;
    }
    const over = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.right + window.scrollX > viewport;
    };
    const name = (el: Element) => {
      const cls = (el.getAttribute("class") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .join(".");
      const text = el.textContent.trim().replace(/\s+/g, " ").slice(0, 50);
      return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""} (${Math.round(
        el.getBoundingClientRect().width,
      )}px) "${text}"`;
    };
    const culprits = Array.from(document.querySelectorAll("body *"))
      .filter((el) => over(el) && !Array.from(el.children).some(over))
      .slice(0, 5)
      .map(name);
    return { doc, viewport, culprits };
  });

  expect(
    doc,
    `The page is ${doc}px wide on a ${viewport}px phone, so it scrolls sideways.` +
      (culprits.length
        ? `\nWidest things that do not fit:\n  ${culprits.join("\n  ")}`
        : ""),
  ).toBeLessThanOrEqual(viewport);
}
