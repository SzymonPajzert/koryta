import { test, expect } from "@playwright/test";

/** The blog, against a local build - which serves drafts, and so the template
 * post content/blog/wzor-wpisu.md. Needs no data of its own beyond the
 * emulator seed's Jan Kowalski and Orlen, whom the template links to. */

const TEMPLATE = "/blog/wzor-wpisu";

test("lists the template and opens it without the in-browser database", async ({
  page,
}) => {
  // Nuxt Content answers a query made in the browser by downloading a SQLite
  // WebAssembly build and the collection's dump. The pages go through
  // /api/blog so that a reader clicking into a post never pays for that.
  const contentDatabase: string[] = [];
  page.on("request", (request) => {
    if (/sqlite|__nuxt_content/.test(request.url())) {
      contentDatabase.push(request.url());
    }
  });

  await page.goto("/blog");
  const card = page.getByTestId("blog-post-wzor-wpisu");
  await expect(card).toContainText("szkic");
  // A click before hydration is an ordinary page load, which would pass this
  // test without testing it: wait for Vue, and leave a mark on the window that
  // only a navigation inside the app survives.
  await page.waitForFunction(
    () =>
      !!(document.querySelector("#__nuxt") as { __vue_app__?: unknown } | null)
        ?.__vue_app__,
  );
  await page.evaluate(() => {
    (window as { blogMark?: boolean }).blogMark = true;
  });
  await card.click();
  await expect(page).toHaveURL(new RegExp(`${TEMPLATE}$`));

  await expect(page.locator("h1")).toHaveText(
    "Wzór wpisu: tekst, liczby i wykresy",
  );
  await expect(page.locator(".apexcharts-svg")).toHaveCount(3);
  expect(
    await page.evaluate(() => (window as { blogMark?: boolean }).blogMark),
  ).toBe(true);
  expect(contentDatabase).toEqual([]);
});

test("draws every embed the template uses", async ({ page }) => {
  await page.goto(TEMPLATE);

  await expect(
    page.getByTestId("blog-stats").locator(".stat-tile__value"),
  ).toHaveText(["5086", "244", "4,8%"]);
  await expect(page.getByTestId("blog-chart")).toHaveCount(3);
  await expect(page.locator(".apexcharts-svg")).toHaveCount(3);
  await expect(page.getByTestId("blog-composition")).toContainText(
    "Rejestr KRS",
  );
  await expect(page.getByTestId("blog-callout")).toContainText(
    "Jak liczyliśmy",
  );
  await expect(page.getByTestId("blog-embed-error")).toHaveCount(0);
  await expect(page.locator("#footnote-label")).toHaveText("Przypisy");
});

test("links the people and companies in the text to their pages", async ({
  page,
}) => {
  await page.goto(TEMPLATE);
  await expect(
    page.getByRole("link", { name: "Jan Kowalski" }),
  ).toHaveAttribute("href", "/osoba/jan-kowalski-1");
  await expect(page.getByRole("link", { name: "Orlen" })).toHaveAttribute(
    "href",
    "/instytucja/orlen-2",
  );
});

test("shows a chart's numbers as a table", async ({ page }) => {
  await page.goto(TEMPLATE);
  const chart = page.getByTestId("blog-chart").first();
  // Clicked until it takes: before hydration the toggle does nothing.
  await expect(async () => {
    await chart.getByRole("button", { name: "Tabela z liczbami" }).click();
    await expect(chart.locator("tbody tr").first()).toContainText(
      "Energetyka",
      { timeout: 1_000 },
    );
  }).toPass({ timeout: 30_000 });
  await expect(chart.locator("tbody tr").first()).toContainText("120");
});

test("answers a post that does not exist with a 404", async ({ page }) => {
  const response = await page.goto("/blog/nie-ma-takiego-wpisu");
  expect(response?.status()).toBe(404);
});
