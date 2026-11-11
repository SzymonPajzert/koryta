import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import { myProposals } from "./fixtures/myProposals";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** /profil, the signed-in admin's own account: who they are, the name others
 * see, what became of their proposals, and the mail they get.
 *
 * The cards are drawn in the browser only (`<ClientOnly>`): the account is
 * the seeded admin, read from the auth emulator and its settings from
 * Firestore, which no other spec changes. The proposals are answered from
 * ./fixtures/myProposals.ts, and the clock is frozen for their „N dni temu”. */

const PROFIL = { tag: pageTag("profil") };

test("profil", PROFIL, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await freezeClock(page);
  // Only a GET is answered, as by the real route.
  await page.route("**/api/revisions/mine**", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: myProposals })
      : route.fulfill({ status: 404, json: { message: "Page not found" } }),
  );
  await logIn(page, USERS.admin, "/profil");

  // A proposal only the fixture has, so a run that drew the seed's own
  // revisions - or none - fails here.
  await expect(
    page.getByText("Aleksandra Konstantynowicz-Szczepańska"),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("proposal-filter-rejected")).toBeVisible();
  // The switches wait for the stored settings, and spin until they arrive.
  await expect(page.locator(".v-switch input")).not.toHaveCount(0);
  await expect(page.locator(".v-switch input:disabled")).toHaveCount(0);

  await page.mouse.move(0, 0);
  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("profil.png", { fullPage: true });

  await expectFitsThePhone(page, testInfo);
});
