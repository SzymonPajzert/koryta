import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { answerForTheSector } from "./fixtures/obronnosc";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** /eksploruj/nowe draws the person it is on with their own page, under the
 * one-row table, rather than with cards of its own. This photographs where the
 * two meet: the row, then the page's head and its relations, which is what a
 * reviewer reads to judge the person.
 *
 * The queue is drafts nobody has voted on, and the seed publishes everybody, so
 * its request is answered with a seeded company's people, the way
 * ./obronnosc.spec.ts does it - through the defence sector's link, which is the
 * one its volunteers are sent. Only down to the relations: below them the page
 * draws a force-directed graph that settles somewhere slightly different every
 * run. */

const NOWE = { tag: pageTag("eksploruj/nowe") };

const QUEUE =
  "/eksploruj/nowe?category=obronnosc&currentlyEmployed=selected&minVotes=0";

test("kolejka-strona-osoby", NOWE, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await answerForTheSector(page, { queue: true });
  await logIn(page, USERS.normal, QUEUE);

  const table = page.locator(".table-card");
  const person = page.getByTestId("queue-person-page");
  const relations = person.getByTestId("relations-history");
  await expect(relations).toBeVisible({ timeout: 30_000 });
  // The page is the row's person, not whoever the queue was on before.
  const name = await table
    .locator("tbody tr .text-primary")
    .first()
    .textContent();
  await expect(person.locator("h2").first()).toHaveText(name!.trim());

  await readyForFullPage(page);
  await page.mouse.move(0, 0);
  await expect(page.locator(".v-ripple__animation")).toHaveCount(0);
  // Page coordinates: `readyForFullPage` has the window back at the top.
  const top = (await table.boundingBox())!;
  const bottom = (await relations.boundingBox())!;
  await expect(page).toHaveScreenshot("kolejka-strona-osoby.png", {
    fullPage: true,
    clip: {
      x: 0,
      y: top.y,
      width: page.viewportSize()!.width,
      height: bottom.y + bottom.height - top.y,
    },
  });

  await expectFitsThePhone(page, testInfo);
});
