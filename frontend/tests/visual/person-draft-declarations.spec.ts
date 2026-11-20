import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import type { PersonDeclarationCrops } from "../../shared/declarations";
import { freezeClock } from "./clock";
import { readyForElementShot } from "./elementShot";
import {
  anotherDay,
  draftCropImages,
  draftPerson,
  held,
  missing,
  waiting,
} from "./fixtures/draftDeclarations";
import { openInApp } from "./openInApp";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** What a draft person's page says of their asset declarations on BIP, to a
 * signed-in reader, under the facts: where the crops stand, the lead crop
 * itself, and with no crop, the local elections won and where the crawler
 * looked, with the field for a link found by hand. As approved on the design
 * board (round osoba-szkic-oswiadczenia-r3).
 *
 * The seed has no declarations and Jan Kowalski is published there, so the
 * page is answered from ./fixtures/draftDeclarations.ts: the node laid over
 * as a draft with crop 1's birth date, the block and its pictures from the
 * fixture. A client-side navigation, so the fetches are the browser's and the
 * route handlers answer them.
 *
 * One element a test, the card at the head of the page: a person's page ends
 * in a force-directed graph that settles differently every run. */

const SLUG = { tag: pageTag("[seoType]/[slug]") };

/** What a server's response says of its own body, which a body rewritten in
 * the test no longer is. */
const BODY_HEADERS = new Set([
  "content-length",
  "content-encoding",
  "transfer-encoding",
]);

async function openDraft(
  page: Page,
  block: PersonDeclarationCrops,
  user: (typeof USERS)[keyof typeof USERS],
): Promise<Locator> {
  const { id, birthDate, path } = draftPerson;
  await freezeClock(page);
  await page.route(
    (url) => url.pathname === `/api/nodes/${id}`,
    async (route) => {
      const response = await route.fetch();
      const json = (await response.json()) as {
        node: Record<string, unknown>;
      };
      json.node.published = false;
      json.node.birthDate = birthDate;
      const headers = Object.fromEntries(
        Object.entries(response.headers()).filter(
          ([name]) => !BODY_HEADERS.has(name),
        ),
      );
      await route.fulfill({ status: response.status(), headers, json });
    },
  );
  await page.route(
    (url) => url.pathname === `/api/nodes/${id}/declaration-crops`,
    (route) => route.fulfill({ json: block }),
  );
  // A draft's public line has nothing to say: the endpoint's 404.
  await page.route(
    (url) => url.pathname === `/api/nodes/${id}/declarations`,
    (route) => route.fulfill({ status: 404, json: { message: "No page" } }),
  );
  await page.route(
    (url) => /^\/api\/declarations\/[^/]+\/images$/.test(url.pathname),
    (route) => {
      const crop = decodeURIComponent(
        new URL(route.request().url()).pathname.split("/")[3]!,
      );
      const images = draftCropImages(crop);
      return images
        ? route.fulfill({ json: images })
        : route.fulfill({ status: 404, json: { message: "Nie ma" } });
    },
  );
  await logIn(page, user, "/o-nas");
  await openInApp(page, path);

  const panel = page.getByTestId("person-draft-declarations");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel;
}

/** The card at the head of the page, around the block. */
const cardOf = (panel: Locator) =>
  panel.locator(
    "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' v-card ')][1]",
  );

/** Every crop drawn has its picture in. */
async function picturesIn(panel: Locator, count: number) {
  const pictures = panel.locator('img[data-testid="draft-declaration-date"]');
  await expect(pictures).toHaveCount(count, { timeout: 30_000 });
  await expect
    .poll(() =>
      pictures.evaluateAll((images) =>
        images.every(
          (img) =>
            (img as HTMLImageElement).complete &&
            (img as HTMLImageElement).naturalWidth > 0,
        ),
      ),
    )
    .toBe(true);
}

test("osoba-szkic-oswiadczenia-czeka", SLUG, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const panel = await openDraft(page, waiting, USERS.normal);

  await expect(panel.locator("#ddecl-line")).toHaveText(
    "3 oświadczenia majątkowe czekają na czytelników.",
  );
  await picturesIn(panel, 1);
  // The rest are behind the fold: all three crops and the one nothing was
  // cut from.
  await panel.locator("[data-show-all]").click();
  await picturesIn(panel, 3);
  await expect(panel.getByTestId("draft-declaration")).toHaveCount(4);
  await expect(panel.getByTestId("draft-declaration").last()).toContainText(
    "bez wycinka: nie znaleziono pola daty",
  );

  await readyForElementShot(page);
  await expect(cardOf(panel)).toHaveScreenshot(
    "osoba-szkic-oswiadczenia-czeka.png",
  );

  await expectFitsThePhone(page, testInfo);
});

/** An admin is told what to do about a held page; nobody else is. */
test(
  "osoba-szkic-oswiadczenia-wstrzymana",
  SLUG,
  async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const panel = await openDraft(page, held, USERS.admin);

    await expect(panel.locator("#ddecl-line")).toHaveText(
      "Automatyczna publikacja wstrzymana: kandydatura w dwóch miejscach naraz.",
    );
    await expect(panel.locator("[data-admin-note]")).toBeVisible();
    await picturesIn(panel, 1);

    await readyForElementShot(page);
    await expect(cardOf(panel)).toHaveScreenshot(
      "osoba-szkic-oswiadczenia-wstrzymana.png",
    );

    await expectFitsThePhone(page, testInfo);
  },
);

test("osoba-szkic-oswiadczenia-inna-data", SLUG, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const panel = await openDraft(page, anotherDay, USERS.normal);

  await expect(panel.locator("#ddecl-line")).toHaveText(
    "Oświadczenie majątkowe podaje inną datę urodzenia niż strona.",
  );
  await picturesIn(panel, 1);

  await readyForElementShot(page);
  await expect(cardOf(panel)).toHaveScreenshot(
    "osoba-szkic-oswiadczenia-inna-data.png",
  );

  await expectFitsThePhone(page, testInfo);
});

test("osoba-szkic-oswiadczenia-brak", SLUG, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const panel = await openDraft(page, missing, USERS.normal);

  await expect(panel.locator("#ddecl-line")).toHaveText(
    "Nie mamy oświadczenia majątkowego.",
  );
  await expect(panel.getByTestId("draft-declaration-search")).toHaveCount(3);
  await expect(panel.getByTestId("draft-declaration-link")).toContainText(
    "dziś, przez Ciebie",
  );
  await expect(panel.locator("[data-link-field]")).toBeVisible();

  await readyForElementShot(page);
  await expect(cardOf(panel)).toHaveScreenshot(
    "osoba-szkic-oswiadczenia-brak.png",
  );

  await expectFitsThePhone(page, testInfo);
});

/** Folded under its line, and still folded when the page is opened again. */
test("osoba-szkic-oswiadczenia-zwiniete", SLUG, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const panel = await openDraft(page, waiting, USERS.normal);
  await picturesIn(panel, 1);

  const toggle = panel.locator("[data-fold-toggle]");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(panel.locator("[data-fold-body]")).toHaveCount(0);

  await readyForElementShot(page);
  await expect(cardOf(panel)).toHaveScreenshot(
    "osoba-szkic-oswiadczenia-zwiniete.png",
  );

  // Kept for this page: opened again, it is folded from the start.
  await openInApp(page, draftPerson.path);
  const again = page.getByTestId("person-draft-declarations");
  await expect(again).toBeVisible({ timeout: 30_000 });
  await expect(again.locator("[data-fold-toggle]")).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  await expectFitsThePhone(page, testInfo);
});
