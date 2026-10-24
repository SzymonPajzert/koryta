import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import {
  noteAuthors,
  noteRows,
  noteTotal,
  triagePerson,
  triagePersonGraph,
  triageQueue,
  triageTotal,
} from "./fixtures/adminNotes";
import { readyForFullPage } from "./fullPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** /admin/notatki, every note readers wrote on a page, and its phone queue,
 * /admin/notatki/kategoryzacja, where they are given a type one at a time.
 *
 * The seed's three notes on Jan Kowalski are neither a table nor a backlog, so
 * both pages are answered from ./fixtures/adminNotes.ts, the notes' authors
 * included. Both are rendered in the browser only (`ssr: false` on
 * /admin/**), which is what lets a route handler answer them, and the clock is
 * frozen for the queue card's date. */

const NOTATKI = { tag: pageTag("admin/notatki/index") };
const KATEGORYZACJA = { tag: pageTag("admin/notatki/kategoryzacja") };

/** The table and the queue ask the same endpoint; only a GET is answered, as
 * by the real route - a verdict would be a POST. */
async function answerNotes(
  page: Page,
  answer: { notes: typeof noteRows; total: number },
) {
  await freezeClock(page);
  await page.route("**/api/notes/admin**", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: answer })
      : route.fulfill({ status: 404, json: { message: "Page not found" } }),
  );
  await page.route("**/api/users/lookup**", (route) => {
    const uids = (
      new URL(route.request().url()).searchParams.get("uids") ?? ""
    ).split(",");
    return route.fulfill({
      json: {
        users: Object.fromEntries(
          uids
            .filter((uid) => uid in noteAuthors)
            .map((uid) => [uid, noteAuthors[uid]]),
        ),
      },
    });
  });
}

test("notatki", NOTATKI, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await answerNotes(page, { notes: noteRows, total: noteTotal });
  // Ten to a page, so the page holds every fixture row and the pager still
  // counts a backlog of over a thousand.
  await logIn(page, USERS.admin, "/admin/notatki?itemsPerPage=10");

  // A note only the fixture has, so a run that drew the seed fails here.
  await expect(
    page.getByText("Aleksandra Konstantynowicz-Szczepańska").first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/z 1[\s,]?287/)).toBeVisible();
  // The authors' names arrive in a second request, after the rows.
  await expect(page.getByText("Marek Zgłaszający").first()).toBeVisible();
  await expect(
    page.getByText("kontakt@stowarzyszenie-przykladowe.example.org").first(),
  ).toBeVisible();

  // The side panel a node name opens is in the document while closed, and on
  // a phone it is a bottom sheet: on a real screen it sits below the window,
  // but a full-page shot stretches the window to the page, so the closed
  // sheet came out over the lower half of the table. The open panel is
  // ExploreNodeDrawer's, photographed with the table.
  await page.addStyleTag({
    content:
      ".v-navigation-drawer:not(.v-navigation-drawer--active) { visibility: hidden; }",
  });
  await page.mouse.move(0, 0);
  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("notatki.png", { fullPage: true });

  await expectFitsThePhone(page, testInfo);
});

test("notatki-kategoryzacja", KATEGORYZACJA, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await answerNotes(page, { notes: triageQueue, total: triageTotal });
  // The record of the person the first card is about.
  await page.route(`**/api/nodes/${triagePerson.id}**`, (route) =>
    route.fulfill({ json: { node: triagePerson } }),
  );
  await page.route(`**/api/graph/local/${triagePerson.id}**`, (route) =>
    route.fulfill({ json: triagePersonGraph }),
  );
  await logIn(page, USERS.admin, "/admin/notatki/kategoryzacja");

  await expect(page.getByText(/Pozostało do oceny: 2\s?406/)).toBeVisible({
    timeout: 30_000,
  });
  // The record under the choices loads on its own, after the card.
  const subject = page.getByTestId("triage-subject");
  await expect(subject).toBeVisible({ timeout: 30_000 });
  await expect(
    subject.getByText("Wodociągi Przykładowo sp. z o.o.").first(),
  ).toBeVisible();
  await expect(
    page.getByText("kontakt@stowarzyszenie-przykladowe.example.org").first(),
  ).toBeVisible();

  await page.mouse.move(0, 0);
  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("notatki-kategoryzacja.png", {
    fullPage: true,
  });

  await expectFitsThePhone(page, testInfo);
});
