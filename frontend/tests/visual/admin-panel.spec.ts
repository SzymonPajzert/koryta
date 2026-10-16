import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import { activityStats } from "./fixtures/activityStats";
import { adminSummary } from "./fixtures/adminSummary";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** /admin, the panel an admin opens first: the three work queues, who has been
 * working this week, and the list of subpages.
 *
 * Both of its requests are answered from fixtures - the queues from
 * ./fixtures/adminSummary.ts, the week's ranking from
 * ./fixtures/activityStats.ts - because the seed leaves all three queues empty
 * and its activity years old. The page is rendered in the browser only (`ssr:
 * false` on /admin/**), which is what lets a route handler answer it, and the
 * clock is frozen so each contributor's „Ostatnio” reads the same every day. */

const PANEL = { tag: pageTag("admin/index") };

test("panel", PANEL, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await freezeClock(page);
  // Only a GET is answered, as by the real routes.
  await page.route("**/api/admin/summary**", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: adminSummary })
      : route.fulfill({ status: 404, json: { message: "Page not found" } }),
  );
  await page.route("**/api/stats/activity**", (route) => {
    const days = Number(
      new URL(route.request().url()).searchParams.get("days") ?? 30,
    );
    return route.fulfill({ json: activityStats(days) });
  });
  await logIn(page, USERS.admin, "/admin");

  // Figures only the fixture has, so a run that drew the seed's empty queues
  // fails here instead of banking three green „0”s.
  await expect(page.getByText(/Kategoryzuj \(2\s?406\)/)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(/12\s418 niezaakceptowanych/)).toBeVisible();
  // The card with nothing in it, and the week's ranking under the cards.
  await expect(page.getByText("Brak nowych zgłoszeń.")).toBeVisible();
  await expect(
    page.getByText("Aleksandra Konstantynowicz-Szczepańska").first(),
  ).toBeVisible();
  // Shown to an established admin only, once the token has been read.
  await expect(
    page.getByRole("link", { name: "Nowi administratorzy" }),
  ).toBeVisible();

  // The pointer off whatever it stopped on after the sign in: a list row
  // under it is tinted.
  await page.mouse.move(0, 0);
  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("panel.png", { fullPage: true });

  await expectFitsThePhone(page, testInfo);
});
