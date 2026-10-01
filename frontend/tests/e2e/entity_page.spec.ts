import { test, expect } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";

/** Jan Kowalski, seeded as node 1: a PO politician working at Orlen who knows
 * Anna Nowak. The assertions below are all about that seeded shape. */
const PERSON = "/osoba/jan-kowalski-1";

test.describe("Entity page", () => {
  test("shows the person's own data", async ({ page }) => {
    await page.goto(PERSON, { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Jan Kowalski").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Politician from PO").first()).toBeVisible();
    await expect(page.getByText("PO", { exact: true }).first()).toBeVisible();
  });

  test("shows the entities it is connected to", async ({ page }) => {
    await page.goto(PERSON, { waitUntil: "domcontentloaded" });

    // Both ends of the seeded edges, under "Historia powiązań"
    await expect(page.getByText("Orlen").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText("Anna Nowak").first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("reads relations, then notes, then the graph", async ({ page }) => {
    test.setTimeout(120_000);
    // Signed in, because a person's notes are unreviewed claims about a named
    // individual and are not shown to anybody else - so this is the only way to
    // see all three sections at once.
    await logIn(page, USERS.normal, PERSON);

    const relations = page.getByTestId("relations-history");
    const notes = page.getByTestId("note-editor");
    const graph = page.getByTestId("graph-panel");
    await expect(relations).toBeVisible({ timeout: 30_000 });
    await expect(notes).toBeVisible({ timeout: 30_000 });
    await expect(graph).toBeVisible({ timeout: 30_000 });

    // The order is the argument: the rows are the record, with dates and
    // sources; the notes are what this reader can add to it; the graph is the
    // same facts arranged so a shape can be seen in them, and it is only worth
    // looking at once you know what you are looking for.
    const tops = await page.evaluate(() =>
      ["relations-history", "note-editor", "graph-panel"].map(
        (id) =>
          document
            .querySelector(`[data-testid="${id}"]`)!
            .getBoundingClientRect().top,
      ),
    );

    expect(tops[0]!).toBeLessThan(tops[1]!);
    expect(tops[1]!).toBeLessThan(tops[2]!);
  });

  test("the /entity url redirects to the readable one", async ({ page }) => {
    // The Cypress specs addressed people as /entity/person/:id, which now
    // redirects to the slug url. That redirect used to hang: it was issued from
    // the page's setup, which does not stop the render, so the response never
    // ended. Worth a test of its own - every indexed link is this shape.
    const response = await page.goto("/entity/person/1", {
      waitUntil: "domcontentloaded",
    });

    // 302 rather than 301, and asserted rather than assumed: a browser caches a
    // 301 for the life of the profile, so shipping one here would freeze
    // today's canonical url into every visitor beyond the reach of any deploy.
    // See SLUG_REDIRECT_CODE in app/composables/slugs.ts.
    const redirected = response?.request().redirectedFrom();
    expect(redirected, "/entity/person/1 did not redirect at all").toBeTruthy();
    expect((await redirected!.response())?.status()).toBe(302);

    await expect(page).toHaveURL(/\/osoba\/jan-kowalski-1/, {
      timeout: 30_000,
    });
    await expect(page.getByText("Jan Kowalski").first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("a link that kept the full stop of its sentence opens the page", async ({
    page,
  }) => {
    // Forums, chat apps and mail clients autolink the full stop that ends a
    // sentence along with the address before it. infokolej.pl did, and its
    // readers landed on "Strona nieznaleziona".
    const response = await page.goto(`${PERSON}.`, {
      waitUntil: "domcontentloaded",
    });

    const redirected = response?.request().redirectedFrom();
    expect(redirected, "the dotted url did not redirect at all").toBeTruthy();
    expect((await redirected!.response())?.status()).toBe(301);

    await expect(page).toHaveURL(new RegExp(`${PERSON}$`), { timeout: 30_000 });
    await expect(page.getByText("Jan Kowalski").first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("going back from a followed relation returns to the person", async ({
    page,
  }) => {
    // The redirect above, taken from inside the app instead of from the
    // address bar. Every in-app link into a node is a /entity/:type/:id - the
    // relation cards, the graph, the revision queue - so the guard runs with a
    // push already in flight, and it used to send the reader on with
    // `replace: true`. A guard redirect resolves before that push is
    // committed, so what got replaced was not the /entity/ url but the page
    // being left, and back had nowhere to return to.
    await page.goto(PERSON, { waitUntil: "domcontentloaded" });

    await page
      .getByTestId("relations-history")
      .getByText("Orlen")
      .first()
      .click();
    await expect(page).toHaveURL(/\/(instytucja|entity)\//, {
      timeout: 30_000,
    });

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${PERSON}$`), { timeout: 30_000 });
  });
});
