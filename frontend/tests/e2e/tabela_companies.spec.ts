import { test, expect, type Page } from "@playwright/test";

/** The companies view of /eksploruj/tabela, end to end on the seeded world:
 * the real place and region lists, and the real /api/stats/companies over the
 * emulator.
 *
 * Two of the owner's reports asked for it. „W tym widoku brakuje jeszcze
 * spółek” on the rail filter - `?category=koleje` listed the people tied to
 * railways and never the railways - and „Przydałby się teraz po prostu widok i
 * filtr dla spółek” on the sector filter.
 *
 * The seed has one company in a sector: „Firma Pusta” is filed under
 * `koleje`, and nobody works there. That is exactly the case the people view
 * could not show at all, and the reason no other seeded company got a sector:
 * each of them is photographed on a page of its own or in the home feed, where
 * a new chip would move a baseline for nothing.
 *
 * Other specs write companies of their own into the same emulator, so the
 * lists here are narrowed to seeded ones - by sector, by seat or by id - rather
 * than counted whole.
 */

/** Every seeded place, by id. */
const SEEDED = ["sukspolka", "chain-company", "2", "company-empty"];

const seeded = (extra = "") =>
  `/eksploruj/tabela?view=companies&${SEEDED.map((id) => `place=${id}`).join("&")}${extra}`;

const companyRows = (page: Page) =>
  page.locator("[data-testid='company-table'] tbody tr");

const companyNames = (page: Page) =>
  companyRows(page).locator(".company-name").allInnerTexts();

const viewButton = (page: Page, name: "Osoby" | "Spółki") =>
  page.getByTestId("tabela-view").getByRole("button", { name });

test.describe("the companies view", () => {
  test("lists a sector's companies, the empty ones too", async ({ page }) => {
    test.setTimeout(120000);
    await page.goto("/eksploruj/tabela?category=koleje", {
      waitUntil: "load",
    });
    // The people view of the sector: nobody, since nobody works at the one
    // railway the seed has.
    await expect(page.getByText("0 osób", { exact: true })).toBeVisible({
      timeout: 60000,
    });

    await viewButton(page, "Spółki").click();

    await expect(page).toHaveURL(/[?&]view=companies(&|$)/);
    // The sector stays: it means the same thing for a company.
    expect(new URL(page.url()).searchParams.get("category")).toBe("koleje");

    await expect(companyRows(page).first()).toContainText("Firma Pusta", {
      timeout: 60000,
    });
    expect(await companyNames(page)).toEqual(["Firma Pusta"]);
    await expect(page.getByText("1 spółka", { exact: true })).toBeVisible();
    // Nobody on the site is tied to it, which is a dash and not „0 osób”.
    await expect(companyRows(page).first().locator("td").last()).toHaveText(
      "—",
    );

    // And back: the people view, with the sector still on.
    await viewButton(page, "Osoby").click();
    await expect(page).not.toHaveURL(/view=/);
    expect(new URL(page.url()).searchParams.get("category")).toBe("koleje");
    await expect(page.getByText("0 osób", { exact: true })).toBeVisible({
      timeout: 60000,
    });
  });

  test("orders the companies by the people on the site", async ({ page }) => {
    test.setTimeout(120000);
    await page.goto(seeded(), { waitUntil: "load" });

    // The one with a board history first. Seven people with a published page
    // hold or held a post at Wojewódzki Zakład Testowy - Grzegorz Bez Strony,
    // the eighth, is a draft and is not counted - and three of them still do.
    await expect(companyRows(page)).toHaveCount(4, { timeout: 60000 });
    const first = companyRows(page).first();
    await expect(first).toContainText("Wojewódzki Zakład Testowy");
    await expect(first).toContainText("7 osób");
    await expect(first).toContainText("w tym 3 obecnie");
    // One person apiece at the next two, the one still in post first; Anna
    // Nowak's post at Orlen is a draft, so Orlen has only Jan Kowalski.
    expect(await companyNames(page)).toEqual([
      "Wojewódzki Zakład Testowy",
      "Firma Testowa",
      "Orlen",
      "Firma Pusta",
    ]);

    // The name is the way to the company's own page.
    await first.locator(".company-name").click();
    await expect(page).toHaveURL(
      /\/instytucja\/wojewodzki-zaklad-testowy-sukspolka$/,
      { timeout: 30000 },
    );
  });

  test("reads the seat filter as where the company is", async ({ page }) => {
    test.setTimeout(120000);
    // Orlen is the seeded company seated in Pomorskie.
    await page.goto("/eksploruj/tabela?view=companies&companyTeryt=22", {
      waitUntil: "load",
    });

    await expect(companyRows(page).first()).toContainText("Orlen", {
      timeout: 60000,
    });
    expect(await companyNames(page)).toEqual(["Orlen"]);
  });

  test("narrows to a sector clicked in a row", async ({ page }) => {
    test.setTimeout(120000);
    await page.goto(seeded(), { waitUntil: "load" });
    await expect(companyRows(page)).toHaveCount(4, { timeout: 60000 });

    await companyRows(page)
      .filter({ hasText: "Firma Pusta" })
      .getByText("Koleje")
      .click();

    await expect(page).toHaveURL(/[?&]category=koleje(&|$)/);
    expect(new URL(page.url()).searchParams.get("view")).toBe("companies");
    await expect(companyRows(page)).toHaveCount(1);
  });
});
