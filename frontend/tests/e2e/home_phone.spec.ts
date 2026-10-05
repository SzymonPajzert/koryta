import { test, expect } from "@playwright/test";

/** What a phone reader meets first. The report this answers - "brakuje w sumie
 * jakiegoś tekstu wprowadzającego na górze, co strona robi" and "usuńmy
 * przycisk działaj z nami dla telefonów, żeby mapa koryciarstwa była głównym
 * punktem zaczepienia" - is about order and presence, which is what this
 * asserts; how it looks is the visual suite's business.
 */
const PHONE = { width: 375, height: 667 };

test.describe("the home page on a phone", () => {
  test.use({ viewport: PHONE });

  test("leads with a sentence, a search and the map", async ({ page }) => {
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

    await expect(
      page.getByRole("heading", { name: /Mapa koryciarstwa/ }),
    ).toBeVisible();

    // Hidden by the stylesheet rather than dropped from the markup, so this
    // asks whether it is on screen, not whether it is in the document.
    await expect(page.getByTestId("home-cta")).toBeHidden();
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
