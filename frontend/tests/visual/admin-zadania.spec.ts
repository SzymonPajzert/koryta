import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import { opsTasks } from "./fixtures/opsTasks";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** /admin/zadania, the owner's task list: the lists with one task open, the
 * map of what waits on what with one task picked, and the map with every
 * chain folded.
 *
 * The tasks live in their own database, which the seed leaves empty, so the
 * list is answered from ./fixtures/opsTasks.ts. The page is rendered in the
 * browser only (`ssr: false` on /admin/**), which is what lets a route handler
 * answer it. The seeded admin carries the `owner` claim the page asks for. */

const ZADANIA = { tag: pageTag("admin/zadania") };

test.beforeEach(async ({ page }) => {
  await freezeClock(page);
  // Only a GET is answered, as by the real route: a page asking any other
  // way would get Nuxt's 404 in production, and must not pass here.
  await page.route("**/api/ops/tasks/list**", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { tasks: opsTasks } })
      : route.fulfill({ status: 404, json: { message: "Page not found" } }),
  );
});

test("zadania", ZADANIA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await logIn(page, USERS.admin, "/admin/zadania");

  // A task only the fixture has, so a run that drew an empty list fails here
  // instead of banking „Nie ma jeszcze żadnych zadań”.
  const upload = page.locator("#t-upload-nazw-spolek");
  await expect(upload).toBeVisible({ timeout: 30_000 });

  // Waiting on the deploy: the open row shows what it waits on and its
  // history.
  await upload.locator("[data-row-toggle]").click();
  await expect(upload.locator("[data-task-depends-on]")).toBeVisible();

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("zadania.png", { fullPage: true });

  await expectFitsThePhone(page, testInfo);
});

test("zadania-mapa", ZADANIA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await logIn(page, USERS.admin, "/admin/zadania?widok=mapa");

  const deploy = page.locator('[data-task-node="deploy-indeksow"]');
  await expect(deploy).toBeVisible({ timeout: 30_000 });
  // Both chains are drawn: two arrows in each, the second ending in a goal.
  await expect(page.locator(".task-edge")).toHaveCount(4);

  await deploy.click();
  await expect(
    page.locator('[data-task-panel] [data-task-details="deploy-indeksow"]'),
  ).toBeVisible();

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("zadania-mapa.png", { fullPage: true });

  await expectFitsThePhone(page, testInfo);
});

test("zadania-mapa-zwiniete", ZADANIA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await logIn(page, USERS.admin, "/admin/zadania?widok=mapa");

  await expect(page.locator('[data-task-node="deploy-indeksow"]')).toBeVisible({
    timeout: 30_000,
  });
  // Each chain into the task it ends in: the upload with the deploy and the
  // merge under it, the goal with the decision and the upload of links.
  await page.locator("[data-task-fold-all]").click();
  await expect(page.locator('[data-task-node="deploy-indeksow"]')).toHaveCount(
    0,
  );
  await expect(
    page.locator('[data-task-node="upload-nazw-spolek"] [data-task-fold]'),
  ).toHaveText("+2");
  // Both stacks float over the map too, the goal first.
  await expect(page.locator("[data-task-mark]")).toHaveCount(2);

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("zadania-mapa-zwiniete.png", {
    fullPage: true,
  });

  await expectFitsThePhone(page, testInfo);
});
