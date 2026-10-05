import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import { adminUserDetails, adminUsers } from "./fixtures/adminUsers";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** /admin/uzytkownicy, every account by what is waiting on it: a request for
 * access, a nomination for the script, two trials - one past its review date,
 * opened so the counts, the nomination form, moderation and the history are in
 * the picture - then the team and the rest.
 *
 * The list joins Firebase Auth with collections the seed leaves empty, so the
 * list and the one detail are answered from ./fixtures/adminUsers.ts. The page
 * is rendered in the browser only (`ssr: false` on /admin/**), which is what
 * lets a route handler answer it, and the clock is frozen so "od 41 dni" and
 * every "N dni temu" read the same every day. The seeded admin holds no
 * `newAdmin`, so the established-admin gate lets it in. */

const UZYTKOWNICY = { tag: pageTag("admin/uzytkownicy") };

test.beforeEach(async ({ page }) => {
  await freezeClock(page);
  // One handler for the list and the detail: `**` in the pattern matches the
  // `/<uid>` too. Only GETs are answered, as no write belongs in a picture.
  await page.route("**/api/admin/users**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      return route.fulfill({ status: 405, json: { message: "Nie w teście." } });
    }
    if (path === "/api/admin/users") return route.fulfill({ json: adminUsers });
    const uid = decodeURIComponent(path.split("/").pop() ?? "");
    const detail = adminUserDetails[uid];
    return detail
      ? route.fulfill({ json: detail })
      : route.fulfill({
          status: 404,
          json: { message: "Nie ma takiego konta." },
        });
  });
});

test("uzytkownicy", UZYTKOWNICY, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await logIn(page, USERS.admin, "/admin/uzytkownicy");

  // An account only the fixture has, so a run that drew an empty list fails
  // here.
  const trial = page.locator("#u-wizu-proba-dluga");
  await expect(trial).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#u-wizu-prosba")).toBeVisible();
  await expect(trial.locator("[data-trial-days]")).toHaveAttribute(
    "data-trial-due",
    "true",
  );

  // The trial past its review date, open: its detail arrives after the click.
  await trial.locator("[data-row-toggle]").click();
  await expect(trial.locator("[data-user-stats]")).toBeVisible();
  await expect(trial.locator("[data-nomination-form]")).toBeVisible();
  await expect(trial.locator('[data-history-kind="apply"]')).toBeVisible();

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("uzytkownicy.png", { fullPage: true });

  await expectFitsThePhone(page, testInfo);
});
