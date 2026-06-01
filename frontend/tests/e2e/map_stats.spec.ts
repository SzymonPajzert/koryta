import { test, expect } from "@playwright/test";

test.describe("Map Stats", () => {
  test("displays matching people count in map tooltip, sidepanel, and API for unlogged users", async ({
    page,
  }) => {
    // Navigate to the home page
    await page.goto("/");

    // Wait for the regions stats API to load
    const statsResponse = await page.waitForResponse((response) =>
      response.url().includes("/api/stats/regions"),
    );
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

    // Set up an interceptor to catch the request made by the side panel
    const nodesRequestPromise = page.waitForResponse((response) =>
      response.url().includes("/api/nodes?type=person"),
    );

    // Click the region
    await firstRegion.click();

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
      const sidepanelMatch = subtitleText?.match(/\((\d+)\s+powiązań\)/);
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
});
