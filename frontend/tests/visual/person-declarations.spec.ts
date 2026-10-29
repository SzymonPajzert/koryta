import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./test";
import type { NodeMentions } from "../../server/api/nodes/[id]/mentions.get";
import type { PersonDeclarations } from "../../shared/declarations";
import { freezeClock } from "./clock";
import { readyForElementShot } from "./elementShot";
import {
  PLAIN_FAVICON,
  declarationPerson,
  personDeclarations,
  personDeclarationsByHand,
  personMentions,
} from "./fixtures/declarationsAdmin";
import { openInApp } from "./openInApp";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** What a person's page says about their asset declarations on BIP, as a
 * logged out reader finds it: one line under the facts, that the birth date
 * agrees with them - and, on a page the site published itself, when it did -
 * and the declarations as the first cards of the section of articles, which
 * is called „Prasa i dokumenty” when it holds both. As Szymon approved it on
 * the design board (round bip-osoba-r2, 2026-10-29).
 *
 * The seed has no declarations and no articles naming anybody, so both are
 * answered from ./fixtures/declarationsAdmin.ts, on the seeded Jan Kowalski.
 * The page is reached by a client-side navigation, so its fetches are the
 * browser's own and the route handlers answer them.
 *
 * One element a test rather than the page: a person's page ends in a
 * force-directed graph that settles differently every run (as
 * person-facts.spec.ts says). */

const SLUG = { tag: pageTag("[seoType]/[slug]") };

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
  await page.route(
    (url) => url.pathname === `/api/nodes/${id}/declarations`,
    (route) => route.fulfill({ json: declarations }),
  );
  await page.route(
    (url) => url.pathname === `/api/nodes/${id}/mentions`,
    (route) => route.fulfill({ json: mentions }),
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
      // Not `{ response, json }`: that keeps the server's content-length for a
      // body that is now longer, and the browser would cut the JSON short.
      const headers = Object.fromEntries(
        Object.entries(response.headers()).filter(
          ([name]) => !BODY_HEADERS.has(name),
        ),
      );
      await route.fulfill({ status: response.status(), headers, json });
    },
  );
  // The cards' site icons come from google.com, which a test does not wait on.
  await page.route("**/s2/favicons**", (route) =>
    route.fulfill({ contentType: "image/png", body: PLAIN_FAVICON }),
  );
  await openInApp(page, path);
}

/** The card at the head of the page, around the line under the facts. */
async function header(page: Page): Promise<Locator> {
  const line = page.getByTestId("person-declarations-pointer");
  await expect(line).toBeVisible({ timeout: 30_000 });
  // The birth date the line vouches for, which only the laid-over answer has.
  const card = line.locator(
    "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' v-card ')][1]",
  );
  await expect(card).toContainText(declarationPerson.birthDate);
  return card;
}

/** The section of articles and declarations under `title`, with the site icon
 * of each of its `cards` drawn. */
async function section(
  page: Page,
  title: string,
  cards: number,
): Promise<Locator> {
  const list = page.getByTestId("node-mentions");
  await expect(list.locator("h3")).toHaveText(title, { timeout: 30_000 });
  // Below the fold, an icon starts loading only once its card is in view.
  await list.scrollIntoViewIfNeeded();
  const icons = list.locator("img.v-img__img");
  await expect(icons).toHaveCount(cards);
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
  return list;
}

test("osoba-oswiadczenia-linia", SLUG, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openPerson(page, personDeclarations, personMentions);

  const card = await header(page);
  await expect(page.getByTestId("person-declarations-pointer")).toContainText(
    "Strona opublikowana automatycznie 1 września 2026: data urodzenia zgadza się z oświadczeniami majątkowymi.",
  );

  await readyForElementShot(page);
  await expect(card).toHaveScreenshot("osoba-oswiadczenia-linia.png");

  await expectFitsThePhone(page, testInfo);
});

test("osoba-prasa-i-dokumenty", SLUG, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openPerson(page, personDeclarations, personMentions);

  // Szymon's title for the two together (bip-osoba-r2): the declarations
  // first, out to the BIP, then the articles.
  const list = await section(page, "Prasa i dokumenty", 4);
  await expect(list.getByTestId("person-declarations")).toHaveCount(2);
  await expect(list.getByTestId("node-mention-card")).toHaveCount(2);
  await expect(list.getByTestId("person-declarations").first()).toContainText(
    "Oświadczenie majątkowe za 2024",
  );

  await readyForElementShot(page);
  await expect(list).toHaveScreenshot("osoba-prasa-i-dokumenty.png");

  await expectFitsThePhone(page, testInfo);
});

test("osoba-oswiadczenia-bez-artykulow", SLUG, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openPerson(page, personDeclarations, { mentions: [] });

  // With nothing to read beside them, the section is named after them.
  const list = await section(page, "Oświadczenia majątkowe", 2);
  await expect(list.getByTestId("person-declarations")).toHaveCount(2);
  await expect(list.getByTestId("node-mention-card")).toHaveCount(0);

  await readyForElementShot(page);
  await expect(list).toHaveScreenshot("osoba-oswiadczenia-bez-artykulow.png");

  await expectFitsThePhone(page, testInfo);
});

/** A page somebody published by hand before readers confirmed its date: the
 * line vouches for the date and says nothing of a publication. */
test("osoba-oswiadczenia-recznie", SLUG, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openPerson(page, personDeclarationsByHand, { mentions: [] });

  const card = await header(page);
  const line = page.getByTestId("person-declarations-pointer");
  await expect(line).toContainText(
    "Data urodzenia zgadza się z oświadczeniem majątkowym.",
  );
  await expect(line).not.toContainText("automatycznie");

  await readyForElementShot(page);
  await expect(card).toHaveScreenshot("osoba-oswiadczenia-recznie.png");

  await expectFitsThePhone(page, testInfo);
});
