import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import { readyForElementShot } from "./elementShot";
import { INTERACTIONS, VOTES_ONLY } from "./fixtures/interactions";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** „Twoje interakcje” on /profil: the changes a contributor proposed and the
 * people they voted on, in one list, and the votes alone behind their chip.
 *
 * The endpoint is answered from ./fixtures/interactions.ts: the seed holds no
 * votes, and its revisions are filed under an email rather than a uid, so the
 * signed-in user's own record would be empty. The clock is stopped, so every
 * row's „N dni temu” stays put. */

const PROFIL = { tag: pageTag("profil") };

test("profil-interakcje", PROFIL, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await freezeClock(page);
  await page.route("**/api/interactions/mine**", (route) =>
    route.fulfill({
      json:
        new URL(route.request().url()).searchParams.get("filter") === "votes"
          ? VOTES_ONLY
          : INTERACTIONS,
    }),
  );
  await logIn(page, USERS.normal, "/profil");

  const card = page.getByTestId("my-interactions");
  await expect(card.getByTestId("my-proposal")).toHaveCount(3, {
    timeout: 30_000,
  });
  await card.scrollIntoViewIfNeeded();
  await readyForElementShot(page);
  await expect(card).toHaveScreenshot("profil-interakcje.png");

  await card.getByTestId("interaction-filter-votes").click();
  await expect(card.getByTestId("my-proposal")).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(card.getByTestId("my-vote")).toHaveCount(10);
  await readyForElementShot(page);
  await expect(card).toHaveScreenshot("profil-interakcje-glosy.png");

  await expectFitsThePhone(page, testInfo);
});
