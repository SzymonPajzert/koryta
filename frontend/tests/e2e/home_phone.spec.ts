import { test, expect } from "@playwright/test";

/** What a phone reader meets first. The report this answers - "brakuje w sumie
 * jakiegoś tekstu wprowadzającego na górze, co strona robi" and "usuńmy
 * przycisk działaj z nami dla telefonów, żeby mapa koryciarstwa była głównym
 * punktem zaczepienia" - is about order and presence, which is what this
 * asserts; how it looks is the visual suite's business.
 *
 * The button came back on 2026-11-01, once it led to /oswiadczenia - a task a
 * reader can start without an account - and once it no longer stood 8px left
 * of the search it wraps under. The map still has to start on the first
 * screen.
 */
const PHONE = { width: 375, height: 667 };

test.describe("the home page on a phone", () => {
  test.use({ viewport: PHONE });

  test("leads with a sentence, a search, the button and the map", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "load" });

    const intro = page.getByText(
      /Sprawdzamy, którymi stanowiskami w publicznych spółkach/,
    );
    await expect(intro).toBeVisible();

    // Above the search field, not tucked in beside it.
    const search = page
      .getByLabel("Szukaj osób, spółek, regionów...", { exact: true })
      .first();
    await expect(search).toBeVisible();
    const introBox = await intro.boundingBox();
    const searchBox = await search.boundingBox();
    expect(introBox!.y).toBeLessThan(searchBox!.y);

    // Under the search and exactly as wide: a few pixels off its edge is what
    // read as „dziwnie po lewej” the first time round. The edges are the
    // field's, the drawn pill, not the input's, which starts at the
    // placeholder.
    const field = page.locator(".home-actions .v-field");
    const fieldBox = await field.boundingBox();
    const cta = page.getByTestId("home-cta");
    await expect(cta).toBeVisible();
    const ctaBox = await cta.boundingBox();
    expect(ctaBox!.y).toBeGreaterThan(fieldBox!.y + fieldBox!.height);
    expect(Math.abs(ctaBox!.x - fieldBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(ctaBox!.width - fieldBox!.width)).toBeLessThanOrEqual(1);

    // And the map still starts on the first screen.
    const map = page.getByRole("heading", { name: /Mapa koryciarstwa/ });
    await expect(map).toBeInViewport();
    const mapBox = await map.boundingBox();
    expect(mapBox!.y).toBeGreaterThan(ctaBox!.y + ctaBox!.height);
  });

  // The ask with an account behind it, below the map: the hero button above
  // is the one without. Pinned, because the thing that made it worth
  // rewriting was a reader not finding the ask at all.
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

  test("keeps the headline and the button beside the search", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "load" });

    await expect(
      page.getByRole("heading", { name: /największym, ogólnopolskim/ }),
    ).toBeVisible();
    await expect(page.getByTestId("home-cta")).toBeVisible();
    // The phone-only sentence would repeat the headline here.
    await expect(
      page.getByText(/Sprawdzamy, którymi stanowiskami w publicznych spółkach/),
    ).toBeHidden();
  });
});
