import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import {
  mailingAudience,
  mailingCampaign,
  mailingDeliveries,
} from "./fixtures/mailing";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** /admin/mailing, the owner's campaigns: one sent to the pilot's first two
 * people, with the pilot preset picked for the rest.
 *
 * Every read is answered from ./fixtures/mailing.ts. The page is rendered in
 * the browser only (`ssr: false` on /admin/**), which is what lets a route
 * handler answer it, and the seeded admin carries the `owner` claim it asks
 * for. The preview is masked: it is a sandboxed document drawn in the
 * system's own fonts, which differ between this machine and CI. */

const MAILING = { tag: pageTag("admin/mailing") };

test.beforeEach(async ({ page }) => {
  await freezeClock(page);
  const get =
    (json: unknown) =>
    (route: Parameters<Parameters<typeof page.route>[1]>[0]) =>
      route.request().method() === "GET"
        ? route.fulfill({ json })
        : route.fulfill({ status: 404, json: { message: "Page not found" } });
  await page.route("**/api/admin/mail/audience**", get(mailingAudience));
  await page.route(
    "**/api/admin/mail/campaigns**",
    get({ campaigns: [mailingCampaign] }),
  );
  await page.route(
    "**/api/admin/mail/deliveries**",
    get({ deliveries: mailingDeliveries }),
  );
});

test("mailing", MAILING, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await logIn(page, USERS.admin, "/admin/mailing");

  // A row only the fixture has, so a run that drew an empty audience fails
  // here instead of banking „Nikogo tu nie ma”.
  await expect(page.locator('[data-audience-row="piotr"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("[data-campaign-subject] input")).toHaveValue(
    mailingCampaign.subject,
  );

  // The pilot: of the people who may get it and do not have it yet, Piotr
  // alone was around in the last 30 days - Kasia was not.
  await page.locator('[data-preset="pilot"]').click();
  await expect(page.locator("[data-audience-summary]")).toContainText(
    "Zaznaczone: 1 · Mogą ją dostać: 2",
  );

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("mailing.png", {
    fullPage: true,
    mask: [page.locator("[data-campaign-preview]")],
  });

  await expectFitsThePhone(page, testInfo);
});
