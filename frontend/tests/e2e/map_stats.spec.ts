import { test, expect } from "@playwright/test";
import { polishCounting } from "../../app/composables/polish";

/** A row of /api/stats/regions, as much of it as the specs below read. */
type RegionCount = { teryt?: string; name?: string; people: number };

test.describe("Map Stats", () => {
  test("displays matching people count in map tooltip, sidepanel, and API for unlogged users", async ({
    page,
  }) => {
    // Navigate to the home page
    await page.goto("/");

    // The region stats are fetched during SSR and embedded in the payload,
    // so the browser never issues the request itself. Hit the API directly
    // to verify it serves the data the map was rendered from.
    const statsResponse = await page.request.get("/api/stats/regions");
    expect(statsResponse.status()).toBe(200);

    // Wait for the SVG map to be visible
    const mapSvg = page.locator(".poland-map-container svg");
    await expect(mapSvg).toBeVisible({ timeout: 15000 });

    // Get the first path element
    const firstRegion = page.locator(".poland-map-container svg path").first();
    await expect(firstRegion).toBeVisible();

    // Read the title text to extract the number of people from the map tooltip
    const titleText = await firstRegion.locator("title").textContent();
    expect(titleText).toBeTruthy();

    // The text is something like "Powiat X (112 osób)" or "Powiat X (1 osoba)"
    const match = titleText?.match(/\((\d+)\s+os/);
    const mapPeopleCount = match ? parseInt(match[1], 10) : 0;
    // ...and what comes before the count is the name the picked card is
    // titled with.
    const regionName = titleText!.trim().replace(/\s*\(\d+\s+os\S*\)$/, "");

    // Set up an interceptor to catch the request made by the side panel.
    // With a `teryt`: the card's own query before anything is picked asks
    // for people too, and that answer is not this region's.
    const nodesRequestPromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/nodes?type=person") &&
        new URL(response.url()).searchParams.has("teryt"),
    );

    // Click the region. The page may still be mid-hydration - the markup is
    // there but Vue hasn't attached listeners yet - so a click can silently do
    // nothing. Retry until the side panel confirms a region was selected:
    // only the card of a picked region has a way back to the list.
    const reset = page.getByTestId("home-region-reset");
    await expect(async () => {
      await firstRegion.click();
      await expect(reset).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 20_000 });

    // The card stands where the list of powiaty was, titled with the region
    // the map named.
    await expect(page.getByTestId("home-side-panel")).toHaveCount(0);
    await expect(page.locator(".people-list__title")).toHaveText(regionName);

    // Wait for the side panel people request to complete
    const nodesResponse = await nodesRequestPromise;
    expect(nodesResponse.status()).toBe(200);

    const nodesData = await nodesResponse.json();
    const apiPeopleCount = nodesData.total || 0;

    // Wait for the side panel to update and show the correct text
    // The side panel has a list item with title "Zobacz cały region"
    const seeAllLink = page.locator(".v-list-item", {
      hasText: "Zobacz cały region",
    });

    // It might not render if the count is 0 and it's handled differently,
    // let's check if the link is visible
    if (mapPeopleCount > 0) {
      await expect(seeAllLink).toBeVisible();
      const subtitle = seeAllLink.locator(".v-list-item-subtitle");
      await expect(subtitle).toBeVisible();

      const subtitleText = await subtitle.textContent();
      // Every form of the noun: „1 powiązanie”, „3 powiązania”, „5 powiązań”.
      const sidepanelMatch = subtitleText?.match(/\((\d+)\s+powiąza/);
      const sidepanelPeopleCount = sidepanelMatch
        ? parseInt(sidepanelMatch[1], 10)
        : 0;

      // Verify that all 3 values match!
      expect(sidepanelPeopleCount).toBe(mapPeopleCount);
      expect(apiPeopleCount).toBe(mapPeopleCount);
    } else {
      // If there are 0 people, the side panel says "Nie znaleźliśmy jeszcze osób w tym regionie."
      const emptyText = page.locator(
        "text=Nie znaleźliśmy jeszcze osób w tym regionie.",
      );
      await expect(emptyText).toBeVisible();

      // The API should also report 0 total
      expect(apiPeopleCount).toBe(0);
    }
  });

  // Before anything is picked the column beside the map lists the powiaty
  // with the most people, and a row picks its powiat as a click on that patch
  // of the map does. Against the seed the counts are stats/region_people as
  // scripts/seed-emulator.ts writes it, and nobody in the fixtures lives in
  // those powiaty - so the card is the empty one, and what is checked of it is
  // that it is that powiat's, counted off its own query.
  test("picks a powiat from the list beside the map, and goes back to it", async ({
    page,
  }) => {
    await page.goto("/");

    // What the list ranks: its first row is the endpoint's biggest powiat.
    const counts = (await (
      await page.request.get("/api/stats/regions")
    ).json()) as RegionCount[];
    const top = counts
      .filter((row) => /^\d{4}$/.test(row.teryt ?? "") && row.people > 0)
      .sort((a, b) => b.people - a.people)[0];
    expect(
      top,
      "no powiat has a count - is stats/region_people seeded?",
    ).toBeDefined();
    const teryt = top!.teryt!;
    const name = top!.name ?? `Powiat ${teryt}`;

    const panel = page.getByTestId("home-side-panel");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    const firstRow = panel.getByTestId("home-region-row").first();
    // The row drops the „Miasto” only Warszawa's node carries.
    await expect(firstRow.locator(".v-list-item-title")).toHaveText(
      name.replace(/^Miasto\s+/, ""),
    );

    const peopleResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/nodes" && url.searchParams.get("teryt") === teryt
      );
    });

    // Retried until the card opens, for the same reason as the map's click:
    // before hydration a row is markup with nothing listening. Once it has
    // opened the row is gone, so a retry must not wait on it.
    const reset = page.getByTestId("home-region-reset");
    await expect(async () => {
      if (!(await reset.isVisible())) await firstRow.click({ timeout: 2_000 });
      await expect(reset).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 20_000 });

    // The card the same powiat opens from the map: under its node's name,
    // with the reader moved onto it, and the way into the table filtered to
    // it.
    await expect(panel).toHaveCount(0);
    const title = page.locator(".people-list__title");
    await expect(title).toHaveText(name);
    await expect(title).toBeFocused();
    const seeAll = page.locator(".v-list-item", {
      hasText: "Zobacz cały region",
    });
    await expect(seeAll).toHaveAttribute(
      "href",
      `/eksploruj/tabela?teryt=${teryt}`,
    );

    // Counted off the card's own query, not off the list's number.
    const total =
      ((await (await peopleResponse).json()) as { total?: number }).total ?? 0;
    await expect(seeAll.locator(".v-list-item-subtitle")).toHaveText(
      `(${polishCounting(total, "powiązanie", "powiązania", "powiązań")})`,
    );
    if (total === 0) {
      await expect(
        page.getByText("Nie znaleźliśmy jeszcze osób w tym regionie."),
      ).toBeVisible();
    }

    // And back: the list again, with the reader on its first row.
    await reset.click();
    await expect(reset).toHaveCount(0);
    await expect(panel).toBeVisible();
    await expect(panel.getByTestId("home-region-row").first()).toBeFocused();
  });
});
