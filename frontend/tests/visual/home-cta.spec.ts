import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "./test";
import type { ProgressStats } from "../../server/utils/progressStats";
import { expectFitsThePhone } from "./phoneWidth";
import { pageTag } from "./pageTags";

/** The home page's call to action, on its own.
 *
 * `home.png` has it too, but as one band in a 3,000px page whose feed moves
 * with the calendar, and drawn from the seed's figures - 15 published out of
 * 16, a bar that is one solid green block. Neither says whether the section
 * itself looks right, which is what it was rewritten for. So four shots of
 * the card alone: the two widths a reader is most likely to have, the width
 * at which the two-pane desktop layout is at its narrowest, and the state a
 * failed stats request leaves behind - the one reader-facing variant nobody
 * sees by browsing.
 *
 * WHY IT NAVIGATES FROM /o-nas. „/” is server rendered, so a direct `goto`
 * asks /api/stats/progress inside nitro, where a route handler here cannot
 * answer. Arriving by a client-side navigation puts the request in the
 * browser - once the payload is out of the way, see `openCta`. /o-nas is the
 * start because it does not call `useStats()` itself: a page that did would
 * hand its server-side figures to the client under the shared
 * `site-progress` key, and the navigation would reuse them rather than ask
 * again.
 */

/** Figures in the shape production has - about a fifth checked, most of the
 * bar still the grey remainder - rather than the seed's, which fill the bar
 * and would photograph a finished project. */
const FIGURES: ProgressStats = {
  total: 6412,
  approved: 1222,
  reviewed: 487,
  toCheck: 4703,
  withVotes: 1540,
  withNotes: 312,
};

/** Open „/” client-side with the stats request answered by `figures`, or
 * failed when `figures` is null, and return the card once it has settled. */
async function openCta(page: Page, figures: ProgressStats | null) {
  await page.route("**/api/stats/progress**", (route) =>
    figures
      ? route.fulfill({ json: figures })
      : route.fulfill({ status: 500, json: { message: "fixture" } }),
  );

  // „/” has `swr` in `routeRules`, which switches on payload extraction: a
  // client-side navigation to it does not run its data fetches at all, it
  // loads `/_payload.json` - what the server fetched, seed figures included.
  // With that answered 404 Nuxt falls back to fetching in the browser. It has
  // to be in place before /o-nas loads, because /o-nas prefetches the payload
  // for the logo's link and the navigation would use the prefetched copy.
  await page.route("**/_payload.json**", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );

  // The logo is the one link home at every width - the „koryta.pl” title
  // beside it is dropped below `md`.
  const home = page.locator(".v-app-bar a[href='/']").first();
  type Marked = Window & { clientSide?: boolean };
  // Retried as a whole. Until /o-nas has hydrated, the click is an ordinary
  // anchor: a full load of „/”, which fetches on the server where the handler
  // above cannot answer, and which hydrates from the payload refused above.
  // A full load also wipes `window`, so the mark is what tells the two apart.
  await expect(async () => {
    if (!page.url().endsWith("/o-nas")) await page.goto("/o-nas");
    await page.evaluate(() => ((window as Marked).clientSide = true));
    const answered = page
      .waitForResponse("**/api/stats/progress**", { timeout: 10_000 })
      .catch(() => null);
    await home.click();
    await expect(page).toHaveURL(/\/$/, { timeout: 5_000 });
    expect(await page.evaluate(() => (window as Marked).clientSide)).toBe(true);
    expect(await answered).not.toBeNull();
  }).toPass({ timeout: 60_000 });

  const cta = page.getByTestId("home-help-cta");
  await cta.scrollIntoViewIfNeeded();
  await expect(cta.getByRole("heading", { level: 2 })).toBeVisible({
    timeout: 30_000,
  });
  if (figures) {
    // Printed only once the fixture's figures are in, and nothing else on the
    // page produces them. Four digits go ungrouped, as polishNumber writes
    // them: „1709”, not „1 709”.
    await expect(cta.getByText(/1709 z 6412/).first()).toBeVisible();
  } else {
    await expect(cta).not.toContainText(/\d\s?z\s\d/);
  }
  await page.evaluate(() => document.fonts.ready);
  return cta;
}

/** The app bar and the feedback launcher are both `position: fixed`, so what
 * they cover depends on where the scroll stopped rather than on the card - and
 * on a phone the card is taller than the window, which put the bar across its
 * top edge. Neither is part of the card, so both are hidden for the shot
 * rather than masked: a mask would photograph a magenta block instead. */
const shoot = async (page: Page, name: string) => {
  await page.addStyleTag({
    content: ".v-app-bar, .feedback-fab { visibility: hidden !important; }",
  });
  await expect(page.getByTestId("home-help-cta")).toHaveScreenshot(name);
};

const desktopOnly = (testInfo: TestInfo) =>
  test.skip(
    testInfo.project.name !== "visual-desktop",
    "a desktop layout; the phone has its own shot",
  );

const HOME = { tag: pageTag("index") };

test.describe("Wezwanie do pomocy na stronie głównej", HOME, () => {
  // Both projects: 1280px on the desktop one, 375px on the phone one.
  test("wezwanie-do-pomocy", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await openCta(page, FIGURES);
    await shoot(page, "wezwanie-do-pomocy.png");
    await expectFitsThePhone(page, testInfo);
  });

  // `md` starts at 960px: the narrowest width that gets the desktop layout,
  // and so the one where it runs out of room first.
  test("wezwanie-do-pomocy-960", async ({ page }, testInfo) => {
    desktopOnly(testInfo);
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 960, height: 800 });
    await openCta(page, FIGURES);
    await shoot(page, "wezwanie-do-pomocy-960.png");
  });

  // The ask has to survive a failed /api/stats/progress without printing
  // „0 z 0” - „/” carries an hour of `swr`, so one bad answer is what a whole
  // hour of readers get.
  test("wezwanie-do-pomocy-bez-liczb", async ({ page }, testInfo) => {
    desktopOnly(testInfo);
    test.setTimeout(120_000);
    await openCta(page, null);
    await shoot(page, "wezwanie-do-pomocy-bez-liczb.png");
  });
});
