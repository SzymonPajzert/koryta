import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import { opsTasks } from "./fixtures/opsTasks";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** /admin/zadania, the owner's task list: the lists with one task open, the
 * kinds with fields of their own open (a merge, a decision waiting for its
 * answer, one answered), the map of what waits on what with one task picked,
 * the map opened from a row's „Na mapie”, the map with every chain folded,
 * and the map focused on one task.
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

  // The upload is urgent, so the merge two steps under it is too, and heads
  // the owner's list; the decision leads to the high goal.
  const level = (id: string) =>
    page.locator(`#t-${id} [data-row-toggle] [data-task-priority]`);
  await expect(level("upload-nazw-spolek")).toHaveAttribute(
    "data-task-priority",
    "urgent",
  );
  await expect(level("merge-przykladowa-galaz")).toHaveAttribute(
    "data-task-priority",
    "urgent-taken",
  );
  await expect(level("decyzja-widocznosc")).toHaveAttribute(
    "data-task-priority",
    "high-taken",
  );

  // Waiting on the deploy: the open row shows its priority at the top, what
  // it waits on and its history.
  await upload.locator("[data-row-toggle]").click();
  await expect(upload.locator("[data-task-depends-on]")).toBeVisible();
  const own = upload.locator("[data-task-actions] [data-task-priority-menu]");
  await expect(own).toHaveText("Pilne");
  await expect(own).toHaveAttribute("title", /ustawił agent/);

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("zadania.png", { fullPage: true });

  await expectFitsThePhone(page, testInfo);
});

test("zadania-rodzaje", ZADANIA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await logIn(page, USERS.admin, "/admin/zadania");

  const merge = page.locator("#t-merge-przykladowa-galaz");
  await expect(merge).toBeVisible({ timeout: 30_000 });
  // A merge leads with its branch, tagged with how much of it is on main.
  await expect(merge.locator("[data-task-merge-state]")).toHaveText(
    "1/3 na main",
  );
  await merge.locator("[data-row-toggle]").click();
  await expect(merge.locator("[data-task-merge]")).toContainText(
    "Na main 1 z 3 zmian.",
  );

  // The decision asks first, then offers its three answers.
  const decision = page.locator("#t-decyzja-widocznosc");
  await decision.locator("[data-row-toggle]").click();
  await expect(decision.locator("[data-task-question]")).toHaveText(
    "Które powiązania z umów publikować od razu?",
  );
  await expect(decision.locator("[data-task-option]")).toHaveCount(3);
  await expect(
    decision.locator('[data-task-option="B"] [data-task-recommended]'),
  ).toBeVisible();

  // The answered one is listed apart, with what follows from it.
  const answered = page.locator(
    '[data-section="decided"] ~ * #t-decyzja-zrodlo-umow',
  );
  await expect(answered.locator("[data-task-picked]")).toHaveText("Wybrano A");
  await answered.locator("[data-row-toggle]").click();
  await expect(answered.locator("[data-task-follows]")).toContainText(
    "Wynikają z niej 2 zadania, zamknięte 1.",
  );

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("zadania-rodzaje.png", {
    fullPage: true,
  });

  await expectFitsThePhone(page, testInfo);
});

test("zadania-na-mapie", ZADANIA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await logIn(page, USERS.admin, "/admin/zadania");

  const decision = page.locator("#t-decyzja-widocznosc");
  await expect(decision).toBeVisible({ timeout: 30_000 });
  await decision.locator("[data-row-toggle]").click();
  await decision.locator("[data-task-show-on-map]").click();

  // The map, with the task picked, its details beside it, and its card in
  // the middle of the map.
  await expect(page).toHaveURL(/widok=mapa.*#t-decyzja-widocznosc/);
  const card = page.locator('[data-task-node="decyzja-widocznosc"]');
  await expect(card).toBeVisible();
  await expect(
    page.locator('[data-task-panel] [data-task-details="decyzja-widocznosc"]'),
  ).toBeVisible();
  const map = await page.locator("[data-task-map]").boundingBox();
  const box = await card.boundingBox();
  expect(
    Math.abs(box!.x + box!.width / 2 - (map!.x + map!.width / 2)),
  ).toBeLessThan(2);
  expect(
    Math.abs(box!.y + box!.height / 2 - (map!.y + map!.height / 2)),
  ).toBeLessThan(2);

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("zadania-na-mapie.png", {
    fullPage: true,
  });

  await expectFitsThePhone(page, testInfo);
});

test("zadania-mapa", ZADANIA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await logIn(page, USERS.admin, "/admin/zadania?widok=mapa");

  const deploy = page.locator('[data-task-node="deploy-indeksow"]');
  await expect(deploy).toBeVisible({ timeout: 30_000 });
  // Both chains are drawn: two arrows in each, the second ending in a goal,
  // and one more from the answered decision to the upload of links (the task
  // after it that is done is off the map with the other closed ones).
  await expect(page.locator(".task-edge")).toHaveCount(5);
  // Each card of both chains is marked: the urgent upload and the high goal
  // filled, what leads to them outlined.
  await expect(
    page.locator("[data-task-node] [data-task-priority]"),
  ).toHaveCount(6);

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

test("zadania-mapa-skupienie", ZADANIA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await logIn(page, USERS.admin, "/admin/zadania?widok=mapa");

  const upload = page.locator('[data-task-node="upload-nazw-spolek"]');
  await expect(upload).toBeVisible({ timeout: 30_000 });
  // Focused on the upload: it and what it waits on - the deploy, and the
  // merge the deploy waits on. Not the other chain, not the loose tasks.
  await upload.locator("[data-task-focus]").click();
  await expect(page).toHaveURL(/skupienie=upload-nazw-spolek/);
  await expect(page.locator("[data-task-node]")).toHaveCount(3);
  await expect(page.locator(".task-edge")).toHaveCount(2);
  await expect(upload.locator("[data-task-focus]")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("zadania-mapa-skupienie.png", {
    fullPage: true,
  });

  await expectFitsThePhone(page, testInfo);

  // And the whole map back.
  await page.locator("[data-task-unfocus]").click();
  await expect(page).not.toHaveURL(/skupienie=/);
  await expect(page.locator(".task-edge")).toHaveCount(5);
  await expect(
    page.locator('[data-task-node="decyzja-widocznosc"]'),
  ).toBeVisible();
});
