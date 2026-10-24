import { test, expect, type Page } from "@playwright/test";

/** What a phone reader meets first. The report this answers - "brakuje w sumie
 * jakiegoś tekstu wprowadzającego na górze, co strona robi" and "usuńmy
 * przycisk działaj z nami dla telefonów, żeby mapa koryciarstwa była głównym
 * punktem zaczepienia" - is about order and presence, which is what this
 * asserts; how it looks is the visual suite's business.
 */
const PHONE = { width: 375, height: 667 };

/** The page's one h1, the same sentence at every width. `\s` rather than a
 * space after „w”: the site ties a one-letter word to the next with a no-break
 * space, and a literal space would match nothing. Anchored, so a full stop or
 * anything else after it fails the match. */
const HEADLINE =
  /^Sprawdzamy, którymi stanowiskami w\spublicznych spółkach podzielili się politycy$/;

/** The page's h1 by its accessible name, and the proof there is only the one -
 * hidden ones included, which is what the page used to carry: a claim for the
 * computer and this sentence for the phone, each hidden at the other width. */
async function theHeadline(page: Page) {
  await expect(page.locator("h1")).toHaveCount(1);
  return page.getByRole("heading", { level: 1, name: HEADLINE });
}

test.describe("the home page on a phone", () => {
  test.use({ viewport: PHONE });

  test("leads with a sentence, a search and the map", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });

    const headline = await theHeadline(page);
    await expect(headline).toBeVisible();

    // Above the search field, not tucked in beside it.
    const search = page
      .getByLabel("Szukaj osób, spółek, regionów...", { exact: true })
      .first();
    await expect(search).toBeVisible();
    const headlineBox = await headline.boundingBox();
    const searchBox = await search.boundingBox();
    expect(headlineBox!.y).toBeLessThan(searchBox!.y);

    await expect(
      page.getByRole("heading", { name: /Mapa koryciarstwa/ }),
    ).toBeVisible();

    // Hidden by the stylesheet rather than dropped from the markup, so this
    // asks whether it is on screen, not whether it is in the document.
    await expect(page.getByTestId("home-cta")).toBeHidden();
  });

  // The column beside the map on a computer stands under it here, and keeps
  // to five rows: there is no map beside it for a longer list to fill.
  test("puts the powiaty with the most people under the map, five of them", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "load" });

    const map = page.locator(".poland-map-container svg");
    await expect(map).toBeVisible();
    const panel = page.getByTestId("home-side-panel");
    await panel.scrollIntoViewIfNeeded();
    await expect(panel).toBeVisible();

    const mapBox = await map.boundingBox();
    const panelBox = await panel.boundingBox();
    expect(panelBox!.y).toBeGreaterThanOrEqual(mapBox!.y + mapBox!.height - 1);

    // The rest are in the markup and hidden by width, so it is the width
    // that keeps them off a phone and not a short list.
    const rows = panel.getByTestId("home-region-row");
    expect(await rows.count()).toBeGreaterThan(5);
    await expect(rows.filter({ visible: true })).toHaveCount(5);
  });

  // The hero button above is desktop-only on purpose, so on a phone this
  // section is the page's only ask before the feed starts. Pinned, because the
  // thing that made it worth rewriting was a reader not finding the ask at all.
  test("carries the help section on a phone", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });

    const cta = page.getByTestId("home-help-cta");
    await cta.scrollIntoViewIfNeeded();
    await expect(cta).toBeVisible();
    await expect(
      cta.getByRole("link", { name: "Sprawdź pierwszą osobę" }),
    ).toBeVisible();
  });

  test("keeps /pomoc reachable, from the footer", async ({ page }) => {
    await page.goto("/", { waitUntil: "load" });

    const footerLink = page
      .locator("footer")
      .getByRole("link", { name: "Działaj z nami" });
    await expect(footerLink).toBeVisible();
    await footerLink.click();
    await expect(page).toHaveURL(/\/pomoc$/);
  });
});

test.describe("the home page on a desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("leads with the same sentence, the search under it and the button beside", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "load" });

    const headline = await theHeadline(page);
    await expect(headline).toBeVisible();
    // The claim that stood beside the logo here is gone, not hidden.
    await expect(page.getByText(/największym, ogólnopolskim/)).toHaveCount(0);

    const search = page.locator(".home-actions .v-input").first();
    const cta = page.getByTestId("home-cta");
    await expect(search).toBeVisible();
    await expect(cta).toBeVisible();
    const headlineBox = await headline.boundingBox();
    const searchBox = await search.boundingBox();
    const ctaBox = await cta.boundingBox();
    expect(headlineBox!.y + headlineBox!.height).toBeLessThanOrEqual(
      searchBox!.y + 1,
    );
    // On the search's line, after it.
    expect(ctaBox!.x).toBeGreaterThanOrEqual(searchBox!.x + searchBox!.width);
    expect(ctaBox!.y).toBeLessThan(searchBox!.y + searchBox!.height);
    expect(ctaBox!.y + ctaBox!.height).toBeGreaterThan(searchBox!.y);
  });

  test("stands the powiaty beside the map, every row of them", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "load" });

    const map = page.locator(".poland-map-container svg");
    const panel = page.getByTestId("home-side-panel");
    await expect(map).toBeVisible();
    await expect(panel).toBeVisible();

    const mapBox = await map.boundingBox();
    const panelBox = await panel.boundingBox();
    expect(panelBox!.x).toBeGreaterThanOrEqual(mapBox!.x + mapBox!.width - 1);

    // From 1280px the column is as tall as the map, and all ten show.
    const rows = panel.getByTestId("home-region-row");
    await expect(rows.filter({ visible: true })).toHaveCount(
      await rows.count(),
    );
  });
});
