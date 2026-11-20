import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import type { NodeMentions } from "../../server/api/nodes/[id]/mentions.get";
import type { PersonDeclarations } from "../../shared/declarations";
import { freezeClock } from "./clock";
import { readyForElementShot } from "./elementShot";
import { readyForFullPage } from "./fullPage";
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

/** The ask above a person's history to read a few declaration scans, as a
 * reader who is not signed in finds it in the half of the `osoba-skany` split
 * that has it: led by the people published automatically in 30 days, saying
 * that pages like this one come from readers. Look c of board round
 * osoba-skany-r1 (2026-11-14), worded in rounds r2 and r3, given one title for
 * every page and moved above the history (2026-11-17).
 *
 * The seeded Jan Kowalski, published automatically, with the declarations of
 * person-declarations.spec.ts and his birth date laid over the page the way
 * that spec does it; the figure is production's of 2026-11-14, answered by a
 * route handler. The page is reached by a client-side navigation, so its
 * fetches are the browser's own and the handlers answer them. The box on its
 * own, then the whole page around it, with the graph's canvas masked: it
 * settles differently every run. */

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

/** What a server's response says of its own body, which a body rewritten in
 * the test no longer is. */
const BODY_HEADERS = new Set([
  "content-length",
  "content-encoding",
  "transfer-encoding",
]);

/** Jan Kowalski's page with these declarations and articles. */
async function openPerson(
  page: Page,
  declarations: PersonDeclarations,
  mentions: NodeMentions,
) {
  const { id, birthDate, path } = declarationPerson;
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
  // The seed gives him no birth date, and a declaration only ever confirms a
  // page that has one: laid over the server's own answer.
  await page.route(
    (url) => url.pathname === `/api/nodes/${id}`,
    async (route) => {
      const response = await route.fetch();
      const json = (await response.json()) as {
        node: Record<string, unknown>;
      };
      json.node.birthDate = birthDate;
      const headers = Object.fromEntries(
        Object.entries(response.headers()).filter(
          ([name]) => !BODY_HEADERS.has(name),
        ),
      );
      await route.fulfill({ status: response.status(), headers, json });
    },
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

/** The whole of the page, for where the box sits: under the person's facts
 * and above „Historia powiązań”, and everything below. On a computer the
 * graph's canvas is a flat box (it settles somewhere slightly different every
 * run, see ./nowe-person-page.spec.ts); a phone shows a button in its place. */
test("osoba-cala-strona-z-prosba-o-skany", SLUG, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openPerson(page, personDeclarations, personMentions);

  const ask = page.getByTestId("person-reading-ask");
  await expect(ask).toBeVisible({ timeout: 30_000 });
  await expect(ask.getByTestId("person-reading-ask-figure")).toContainText(
    "741",
  );
  // The box sits right above the history.
  const history = page.getByTestId("relations-history");
  const [askBox, historyBox] = await Promise.all([
    ask.boundingBox(),
    history.boundingBox(),
  ]);
  expect(askBox!.y + askBox!.height).toBeLessThan(historyBox!.y);

  // What the page draws from the browser's own requests: the line under the
  // facts, and the section of declarations and articles with its site icons.
  await expect(page.getByTestId("person-declarations-pointer")).toBeVisible({
    timeout: 30_000,
  });
  const list = page.getByTestId("node-mentions");
  await expect(list.locator("h3")).toHaveText("Prasa i dokumenty", {
    timeout: 30_000,
  });
  await list.scrollIntoViewIfNeeded();
  const icons = list.locator("img.v-img__img");
  await expect(icons).toHaveCount(4);
  await expect
    .poll(() =>
      icons.evaluateAll((images) =>
        images.every(
          (img) =>
            (img as HTMLImageElement).complete &&
            (img as HTMLImageElement).naturalWidth > 0,
        ),
      ),
    )
    .toBe(true);

  const canvas = page.locator(".graph-panel__canvas");
  await readyForFullPage(page);
  await expect(page).toHaveScreenshot(
    "osoba-cala-strona-z-prosba-o-skany.png",
    { fullPage: true, mask: [canvas], maskColor: "#f2f1ed" },
  );

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
