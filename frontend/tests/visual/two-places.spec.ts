import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import {
  CLASH_PERSON,
  twoPlacesGraph,
  twoPlacesRelations,
  twoPlacesRevisions,
} from "./fixtures/twoPlaces";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** What warns before a page's candidacies put its person in two places in one
 * election (shared/twoPlaces.ts): a block in the publish dialog, and the
 * „dwa miejsca” chip on the person's rows.
 *
 * Both need things nothing else here has - a signed in admin, a draft page with
 * candidacies, and two of them clashing - so every capture before these passed
 * without ever drawing either. The data is ./fixtures/twoPlaces.ts, answered
 * by route handlers: /admin/** is rendered in the browser, and the person page
 * is reached by the client-side navigation `logIn` ends in, so every request
 * these pages make is the browser's own.
 *
 * The dialog is photographed alone, in a window tall enough for all of it: it
 * scrolls inside itself, and a shot of the part that fits a phone's screen
 * would leave out the warning that is the point of the second capture. The
 * person's rows likewise: on a phone they are taller than the screen, and the
 * bars fixed to its top and bottom would cover the rows they overlap. */

const DIALOG = { tag: pageTag("admin/rewizje/[id]") };
const PERSON = { tag: pageTag("[seoType]/[slug]") };

/** Tall enough for the dialog with its five blocks and the warning by the
 * button, about 1,500px on a phone, and for the person's rows. */
const TALL = 1600;

/** After the clicks: the pointer off the last button, whose hover tint would
 * otherwise be in the shot, and every ripple played out. */
async function settle(page: Page) {
  await page.mouse.move(0, 0);
  await expect(page.locator(".v-ripple__animation")).toHaveCount(0);
}

async function openDialog(page: Page) {
  await page.setViewportSize({
    width: page.viewportSize()!.width,
    height: TALL,
  });
  await freezeClock(page);
  await page.route("**/api/revisions/byNode**", (route) =>
    route.fulfill({ json: twoPlacesRevisions }),
  );
  await page.route("**/api/edges/byNode**", (route) =>
    route.fulfill({
      json: { relations: twoPlacesRelations, nodePublished: false },
    }),
  );
  await logIn(page, USERS.admin, `/admin/rewizje/${CLASH_PERSON}`);

  await page.getByTestId("publish-toggle").click({ timeout: 30_000 });
  const dialog = page.getByTestId("publish-node-dialog");
  // The block only the fixture's clash produces, so a run that somehow drew
  // the seed fails here rather than banking a dialog with no warning in it.
  await expect(
    dialog.getByTestId("publish-place-clash-2002-local"),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    dialog.getByText("tu też w 2006, 2010, 2018, 2023 i 2024"),
  ).toBeVisible();
  await expect(dialog.getByText("tu tylko w 2002")).toBeVisible();
  // And a block for each pair the office key let through: the Sejm and the
  // Senat, a sejmik and a city council, a city and a district council, a run
  // with no office and a „Samorząd” one.
  for (const election of [
    "2024-local",
    "2023-parliament",
    "2018-local",
    "2010-local",
  ]) {
    await expect(
      dialog.getByTestId(`publish-place-clash-${election}`),
    ).toBeVisible();
  }
  await expect(
    page.locator('[class*="-enter-active"], [class*="-leave-active"]'),
  ).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  return dialog;
}

test("publikacja-dwa-miejsca", DIALOG, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const dialog = await openDialog(page);

  // „Zaznacz wszystkie” ticks the rest and leaves both sides of the clash for
  // the reviewer to pick from.
  await dialog.getByTestId("publish-select-all").click();
  await expect(
    dialog.getByTestId("publish-relation-check-visseat").locator("input"),
  ).toBeChecked();
  await expect(
    dialog
      .getByTestId("publish-relation-check-visrunkozienice2002")
      .locator("input"),
  ).not.toBeChecked();
  await expect(dialog.getByTestId("publish-clash-after")).toHaveCount(0);

  await settle(page);
  await expect(dialog).toHaveScreenshot("publikacja-dwa-miejsca.png");

  await expectFitsThePhone(page, testInfo);
});

test("publikacja-dwa-miejsca-obie", DIALOG, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const dialog = await openDialog(page);

  // Both sides ticked by hand: the warning by the button, which says what goes
  // live and does not stop the click.
  for (const id of ["visrungniezno2002", "visrunkozienice2002"]) {
    await dialog.getByTestId(`publish-relation-check-${id}`).click();
  }
  await expect(dialog.getByTestId("publish-clash-after")).toContainText(
    "Powiat gnieźnieński i Powiat kozienicki",
  );

  await settle(page);
  await expect(dialog).toHaveScreenshot("publikacja-dwa-miejsca-obie.png");

  await expectFitsThePhone(page, testInfo);
});

test("powiazania-dwa-miejsca", PERSON, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({
    width: page.viewportSize()!.width,
    height: TALL,
  });
  // The rows carry dates, and their bars are scaled to today: frozen, so the
  // shot is the same tomorrow.
  await freezeClock(page);
  // Jan Kowalski, who is published, wearing the fixture's career - so the
  // draft run's „Opublikuj” is offered beside its chip.
  await page.route("**/api/graph/local/**", (route) =>
    route.fulfill({ json: twoPlacesGraph("1") }),
  );
  await logIn(page, USERS.admin, "/entity/person/1");

  const relations = page.getByTestId("relations-history");
  await expect(
    relations.getByTestId("place-clash-chip-visrunkozienice2002"),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    relations.getByTestId("place-clash-chip-visrungniezno2002"),
  ).toBeVisible();
  // The Senat run and the namesake's Sejm run of 2023, one election.
  await expect(
    relations.getByTestId("place-clash-chip-visrunsenat2023"),
  ).toBeVisible();
  await expect(
    relations.getByTestId("place-clash-chip-visrunsejm2023"),
  ).toBeVisible();
  // Another election, one place: no chip.
  await expect(
    relations.getByTestId("place-clash-chip-visrungniezno2006"),
  ).toHaveCount(0);
  await expect(
    relations.getByTestId("edge-draft-publish-visrunkozienice2002"),
  ).toBeVisible();

  // The feedback button floats over the last row on a phone, and the pointer
  // is left where the login form's button was - over a row, which it borders.
  await page.addStyleTag({
    content: ".feedback-fab { visibility: hidden !important; }",
  });
  await settle(page);
  await page.evaluate(() => document.fonts.ready);
  await expect(relations).toHaveScreenshot("powiazania-dwa-miejsca.png");

  await expectFitsThePhone(page, testInfo);
});
