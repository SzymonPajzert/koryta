import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** /qa, the list of changes to check, as a contributor opens it.
 *
 * WHY MOST OF THE LIST IS HIDDEN. The page lists every entry in shared/qa.ts,
 * newest first, and every change a reader can see adds one - so a shot of the
 * whole list would fail on every commit that follows the rule. Four of the
 * oldest entries are kept instead, one from each area, which nobody edits
 * once they are down the list. The rest are hidden with CSS rather than
 * removed, because Vue still owns those nodes.
 *
 * The one thing that still moves is the count on „Do sprawdzenia”, by a digit
 * per entry, which is far inside the 1% the comparison allows. */

const QA = { tag: pageTag("qa") };

/** Oldest last, as the page orders them. */
const KEPT = [
  "my-contributions",
  "reviewer-queue",
  "cite-existing-relation",
  "person-search-by-city",
];

/** Open, to show the steps and the two verdict buttons. */
const OPENED = "reviewer-queue";

test("qa", QA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await logIn(page, USERS.normal, "/qa");

  // Set once the reader's verdicts have been read, which is also when the
  // rows are drawn in their real state rather than as a skeleton.
  await expect(page.locator('[data-qa-loaded="true"]')).toBeVisible({
    timeout: 30_000,
  });
  for (const id of KEPT) {
    await expect(page.locator(`[data-qa-item="${id}"]`)).toBeVisible();
  }

  const others = KEPT.map((id) => `:not([data-qa-item="${id}"])`).join("");
  await page.addStyleTag({
    content: [
      `[data-qa-item]${others} { display: none !important; }`,
      // Rows are ruled off with `.arow + .arow`, which counts the hidden
      // row before the first one kept.
      `[data-qa-item="${KEPT[0]}"] { border-top: none !important; }`,
    ].join("\n"),
  });

  const opened = page.locator(`[data-qa-item="${OPENED}"]`);
  await opened.locator("[data-row-toggle]").click();
  await expect(opened.locator("[data-row-panel]")).toBeVisible();

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("qa.png", { fullPage: true });

  await expectFitsThePhone(page, testInfo);
});
