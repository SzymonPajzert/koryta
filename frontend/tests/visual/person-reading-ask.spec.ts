import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import type { NodeMentions } from "../../server/api/nodes/[id]/mentions.get";
import type { PersonDeclarations } from "../../shared/declarations";
import { freezeClock } from "./clock";
import { readyForElementShot } from "./elementShot";
import {
  PLAIN_FAVICON,
  declarationPerson,
  personDeclarations,
  personMentions,
} from "./fixtures/declarationsAdmin";
import { logIn, USERS } from "../e2e/helpers/auth";
import { openInApp } from "./openInApp";
import { pageTag } from "./pageTags";
import { PERSON_ASK_EXPERIMENT, assignArm } from "../../shared/experiments";
import { expectFitsThePhone } from "./phoneWidth";

/** The ask under a person's history to read a few declaration scans, as a
 * reader who is not signed in finds it in the half of the `osoba-skany` split
 * that has it: led by the people published automatically in 30 days, saying
 * that pages like this one come from readers. Look c of board round
 * osoba-skany-r1 (2026-11-14), worded in rounds r2 and r3 and given one title
 * for every page (2026-11-17), so one shot: the page here was published
 * automatically, which no longer changes the box.
 *
 * The seeded Jan Kowalski, with the declarations of
 * person-declarations.spec.ts; the figure is production's of 2026-11-14,
 * answered by a route handler. The page is reached by a client-side
 * navigation, so its fetches are the browser's own and the handlers answer
 * them. One element a test: the page ends in a graph that settles differently
 * every run. */

const SLUG = { tag: pageTag("[seoType]/[slug]") };

/** /api/stats/activity's `automatic` on 2026-11-14. */
const READERS_PUBLISHED = 741;

/** A session id that `osoba-skany` puts in its ask's arm. */
const ASK_SESSION = (() => {
  for (let i = 0; i < 10_000; i++) {
    const id = `visual-session-${i}`;
    if (assignArm(PERSON_ASK_EXPERIMENT, id) === "prosba") return id;
  }
  throw new Error("no session id lands in the ask's arm");
})();

/** Puts the browser in the ask's half of the split. An automated browser sits
 * every split out (`useExperimentArm`), so the page is told it is not one, and
 * the session is seated in the arm. Not being automated also wakes the
 * tracker, so nothing it sends leaves the machine. */
async function seatInTheAsksArm(page: Page) {
  await page.addInitScript((session) => {
    Object.defineProperty(Navigator.prototype, "webdriver", {
      get: () => false,
      configurable: true,
    });
    sessionStorage.setItem("koryta:session", session);
  }, ASK_SESSION);
  await page.route(/plausible\.io/, (route) => route.abort());
}

/** Jan Kowalski's page with these declarations and articles. */
async function openPerson(
  page: Page,
  declarations: PersonDeclarations,
  mentions: NodeMentions,
) {
  const { id, path } = declarationPerson;
  await freezeClock(page);
  await seatInTheAsksArm(page);
  await page.route(
    (url) => url.pathname === `/api/nodes/${id}/declarations`,
    (route) => route.fulfill({ json: declarations }),
  );
  await page.route(
    (url) => url.pathname === `/api/nodes/${id}/mentions`,
    (route) => route.fulfill({ json: mentions }),
  );
  await page.route(
    (url) => url.pathname === "/api/stats/activity",
    (route) => route.fulfill({ json: { automatic: READERS_PUBLISHED } }),
  );
  await page.route("**/s2/favicons**", (route) =>
    route.fulfill({ contentType: "image/png", body: PLAIN_FAVICON }),
  );
  await openInApp(page, path);
}

test("osoba-prosba-o-skany-po-odczytach", SLUG, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openPerson(page, personDeclarations, personMentions);

  const ask = page.getByTestId("person-reading-ask");
  await expect(ask).toBeVisible({ timeout: 30_000 });
  await expect(ask.getByTestId("person-reading-ask-figure")).toContainText(
    "741",
  );
  await expect(ask.locator("h3")).toHaveText(
    "Strony jak ta powstały dzięki czytelnikom",
  );

  await readyForElementShot(page);
  await expect(ask).toHaveScreenshot("osoba-prosba-o-skany-po-odczytach.png");

  await expectFitsThePhone(page, testInfo);
});

/** A signed-in contributor knows the way to /oswiadczenia, and has the app
 * bar's „Działaj z nami”: the ask is for readers who are not signed in. No
 * picture, so no `@page:` tag - the coverage check wants a baseline for every
 * tagged test, and there is nothing here to photograph. */
test("osoba-prosba-o-skany-zalogowany", async ({ page }) => {
  test.setTimeout(120_000);
  // In the ask's arm, so only being signed in keeps the box away.
  await seatInTheAsksArm(page);
  await logIn(page, USERS.normal, declarationPerson.path);

  await expect(
    page.locator("h3", { hasText: "Historia powiązań" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("person-reading-ask")).toHaveCount(0);
});
