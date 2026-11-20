import { expect, type Locator, type Page } from "@playwright/test";

/** How much of an open `v-select` menu a shot keeps, from its left edge.
 *
 * The menu is as wide as the widest option its virtual list has rendered, and
 * which options those are depends on timing. The „Typ podmiotu” menu comes out
 * 288.8 px wide with „Przychodnie i opieka ambulatoryjna” out of the list and
 * 290.1 px with it in, so a shot of the whole box was 289 px on one run and
 * 291 px on the next. Every option shown ends inside this strip, and the strip
 * stops before the menu's rounded corner. */
const STRIP = 284;

/** Shoots the open menu `menu` (its listbox) as a fixed-width strip. */
export async function expectSelectMenuShot(
  page: Page,
  menu: Locator,
  name: string,
) {
  // The menu scales in through an inline transition, which the class check in
  // the specs' `settle` does not see, and its box is smaller until it ends.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running"),
  );
  // The list draws the rows by the picked one first and the rest a frame or
  // more later. Until then the menu is only as wide as its field, and the
  // strip would take in the page behind it.
  await expect
    .poll(async () => (await menu.boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(STRIP + 4);
  const box = (await menu.boundingBox())!;
  await expect(page).toHaveScreenshot(name, {
    clip: {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: STRIP,
      height: Math.round(box.height),
    },
  });
}
