import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import type { DeclarationOverview } from "../../shared/declarations";
import { freezeClock } from "./clock";
import { readyForElementShot } from "./elementShot";
import {
  OPENED_CROP,
  cropImages,
  declarationOverview,
  declarationOverviewEmpty,
  declarationOverviewOff,
} from "./fixtures/declarationsAdmin";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** /admin/oswiadczenia, how far the reading of BIP declarations has got: the
 * declarations by state, the chain from a candidacy searched to a person
 * published with today's publications against the limit, and the lists an
 * admin works through. As Szymon approved it on the design board (round
 * bip-admin-r2, 2026-10-29: the bar above the chain).
 *
 * The readings live in collections the seed leaves empty, so the overview and
 * the crop are answered from ./fixtures/declarationsAdmin.ts - production's
 * numbers, made-up people, and a crop cut from a fake scan, never a real one.
 * The page is rendered in the browser only (`ssr: false` on /admin/**), which
 * is what lets a route handler answer it, and it tells every time against the
 * frozen clock.
 *
 * Every shot is `admin-oswiadczenia…`: baselines are one flat folder by name,
 * and the reading page, /oswiadczenia, has `oswiadczenia…` of its own. */

const OSWIADCZENIA = { tag: pageTag("admin/oswiadczenia") };

/** Signed in as the seeded admin on the page, with `overview` as the answer.
 * Only what the page reads is answered: no shot here sends a decision. */
async function openOverview(page: Page, overview: DeclarationOverview) {
  await freezeClock(page);
  await page.route("**/api/declarations/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "GET" && path === "/api/declarations/overview") {
      return route.fulfill({ json: overview });
    }
    if (request.method() === "GET" && path.endsWith("/images")) {
      return route.fulfill({ json: cropImages() });
    }
    return route.fulfill({ status: 404, json: { message: "Page not found" } });
  });
  await logIn(page, USERS.admin, "/admin/oswiadczenia");
  await expect(page.getByTestId("declarations-progress")).toBeVisible({
    timeout: 30_000,
  });
}

test("admin-oswiadczenia", OSWIADCZENIA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openOverview(page, declarationOverview);

  // What only the fixture has, so a run that drew an empty overview fails
  // here rather than banking one.
  await expect(
    page
      .getByTestId("declarations-disputed")
      .locator(`[data-declaration-id="${OPENED_CROP.id}"]`),
  ).toBeVisible();
  await expect(page.getByTestId("declarations-cap")).toContainText(
    "9 osób czeka na kolejny dzień.",
  );
  // The bar of the declarations by state stands above the chain.
  const states = await page.getByTestId("declarations-states").boundingBox();
  const chain = await page.getByTestId("declarations-progress").boundingBox();
  expect(states!.y + states!.height).toBeLessThanOrEqual(chain!.y);
  // The readings chart is drawn after its card mounts.
  await expect(
    page.getByTestId("declarations-readings").locator(".apexcharts-svg"),
  ).toBeVisible({ timeout: 30_000 });

  await page.mouse.move(0, 0);
  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("admin-oswiadczenia.png", {
    fullPage: true,
  });

  await expectFitsThePhone(page, testInfo);
});

/** A disputed crop opened: the crop at its own size (scrolled sideways on a
 * phone), what readers typed, the page it is for with its date kept out of
 * sight, and the decisions under it. */
test(
  "admin-oswiadczenia-sporny-wycinek",
  OSWIADCZENIA,
  async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await openOverview(page, declarationOverview);

    const row = page
      .getByTestId("declarations-disputed")
      .locator(`[data-declaration-id="${OPENED_CROP.id}"]`);
    await row.locator("[data-row-toggle]").click();

    // Both crops in, decoded, before anything is judged.
    for (const crop of ["date", "name"]) {
      const image = row.locator(`[data-crop="${crop}"] img`);
      await expect(image).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(() =>
          image.evaluate(
            (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
          ),
        )
        .toBe(true);
    }
    await expect(row.locator("[data-settle-reading]")).toHaveCount(3);
    // The page's date stays hidden until the admin asks for it.
    await expect(row.locator("[data-reveal-dates]")).toBeVisible();
    await expect(row.locator("[data-page-date]")).toHaveCount(0);

    await readyForElementShot(page);
    await expect(row).toHaveScreenshot("admin-oswiadczenia-sporny-wycinek.png");

    await expectFitsThePhone(page, testInfo);
  },
);

/** The automatic publication switched off (a daily limit of 0): the chain
 * ends in „Dziś” without places to count, and the queue waits with the
 * button to publish from it all the same - an admin's press goes past the
 * limit (Szymon, 2026-10-30), as round bip-admin-r2 drew it. */
test(
  "admin-oswiadczenia-wylaczone",
  OSWIADCZENIA,
  async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await openOverview(page, declarationOverviewOff);

    const cap = page.getByTestId("declarations-cap");
    await expect(cap).toHaveAttribute("data-limit", "0");
    await expect(cap).toContainText("publikowanie automatyczne wyłączone");
    await expect(cap).toContainText("83 osoby czekają w kolejce.");
    await expect(cap.locator("[data-cap-publish]")).toBeVisible();

    await readyForElementShot(page);
    await expect(page.getByTestId("declarations-progress")).toHaveScreenshot(
      "admin-oswiadczenia-wylaczone.png",
    );

    await expectFitsThePhone(page, testInfo);
  },
);

/** Right after the deploy, before the job's first upload: the head and the
 * chain at nought, the automatic publication switched off as it ships, and
 * one sentence where the lists will be. */
test("admin-oswiadczenia-puste", OSWIADCZENIA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openOverview(page, declarationOverviewEmpty);

  await expect(page.locator("[data-overview-empty]")).toContainText(
    "Zadanie jeszcze niczego nie przesłało.",
  );
  await expect(page.getByTestId("declarations-states")).toHaveCount(0);
  const cap = page.getByTestId("declarations-cap");
  await expect(cap).toHaveAttribute("data-limit", "0");
  await expect(cap).toContainText("publikowanie automatyczne wyłączone");
  await expect(cap).toContainText("Nikt nie czeka w kolejce.");

  await page.mouse.move(0, 0);
  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("admin-oswiadczenia-puste.png", {
    fullPage: true,
  });

  await expectFitsThePhone(page, testInfo);
});
