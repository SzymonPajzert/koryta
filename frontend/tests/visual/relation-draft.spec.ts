import { test, expect, type Page } from "@playwright/test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { draftRelationsGraph } from "./fixtures/draftRelations";
import { expectFitsThePhone } from "./phoneWidth";

/** „Historia powiązań" with a draft relation in it - the „szkic" badge and the
 * „Opublikuj" beside it, which nothing in this suite drew.
 *
 * It is invisible to everyone else this suite photographs: the badge needs a
 * signed in reader *and* an unpublished relation, and every logged out capture
 * in pages.spec.ts has neither. That left a new control with no picture at all
 * - and this is a row that already carries a name, a role, up to three chips
 * and three icon buttons, so where the badge wraps to on a phone is the whole
 * question.
 *
 * WHY IT INTERCEPTS THE GRAPH. `tests/visual/fixtures/draftRelations` says why
 * at length: the badge needs a draft relation, and the only one the seed has is
 * on a person two other specs photograph. The route handler gives this page a
 * draft relation without giving one to anybody else.
 *
 * Signed in as the admin rather than the ordinary user: „Opublikuj" is an
 * administrator's button, and a normal reader's view of the same three rows is
 * the middle row of this shot - the chip with no button after it.
 *
 * One element rather than the page: a person's page ends in a force-directed
 * canvas that settles differently every run, the same reason notes.spec.ts and
 * relation-sources.spec.ts scope to theirs.
 */

/** Jan Kowalski, who is published - which is what lets a relation of his be
 * published at all, and so is what puts „Opublikuj" on the row. The fixture
 * replaces his relations wholesale; nothing of his own is in the shot. */
const PERSON = "/entity/person/1";

async function openWithFixture(page: Page) {
  await page.route("**/api/graph/local/**", (route) =>
    route.fulfill({ json: draftRelationsGraph("1") }),
  );

  // `logIn` navigates to the page through /login?redirect=, which is a
  // client-side navigation - so the graph is fetched in the browser, where the
  // handler above can answer it. `useEdges` goes out through `authFetch` and
  // would not be reachable from a server-rendered load.
  await logIn(page, USERS.admin, PERSON);

  const relations = page.getByTestId("relations-history");
  await expect(relations).toBeVisible({ timeout: 30_000 });

  // A company only the fixture produces, so a run that somehow drew the
  // seeded graph fails here rather than banking a baseline with no badge in
  // it - the failure this shot is least able to show on its own, since a
  // missing badge is exactly what a published relation looks like.
  await expect(
    relations.getByText("Spółka Opublikowana", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    relations.getByTestId("edge-draft-chip-visdraftedgelive"),
  ).toBeVisible({ timeout: 30_000 });

  await page.evaluate(() => document.fonts.ready);
  return relations;
}

test.describe("Szkic powiązania", () => {
  test("powiazanie-szkic", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const relations = await openWithFixture(page);

    // The three states, asserted before the capture: a baseline is only worth
    // having if the thing it photographs is the thing that was asked for.
    await expect(
      relations.getByTestId("edge-draft-publish-visdraftedgelive"),
    ).toBeVisible();
    // The far end is a draft, so the chip comes without the button.
    await expect(
      relations.getByTestId("edge-draft-chip-visdraftedgeszkic"),
    ).toBeVisible();
    await expect(
      relations.getByTestId("edge-draft-publish-visdraftedgeszkic"),
    ).toHaveCount(0);
    // Published: no badge at all.
    await expect(
      relations.getByTestId("edge-draft-chip-visdraftedgeopub"),
    ).toHaveCount(0);

    await expect(relations).toHaveScreenshot("powiazanie-szkic.png");

    await expectFitsThePhone(page, testInfo);
  });
});
