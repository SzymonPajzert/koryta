import { test, expect } from "./test";
import type { DatabaseStats } from "../../server/api/stats/database.get";
import { openInApp } from "./openInApp";
import { expectFitsThePhone } from "./phoneWidth";
import { pageTag } from "./pageTags";

/** /eksploruj prints the day its counts were made, and the server makes them,
 * so a shot of the page as the server sends it changes every day. Drawn in the
 * browser from this census instead, it stays the same. */
const STATS: Pick<DatabaseStats, "nodes" | "generatedAt"> = {
  generatedAt: "2026-09-14T06:30:00.000Z",
  nodes: {
    total: 17292,
    people: 10348,
    places: 4928,
    articles: 627,
    regions: 1389,
  },
};

test(
  "eksploruj",
  { tag: pageTag("eksploruj/index") },
  async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.route("**/api/stats/database**", (route) =>
      route.fulfill({ json: STATS }),
    );
    // `swr` in `routeRules` makes a client-side navigation load the server's
    // `_payload.json`, census and date included. Refused, Nuxt fetches in the
    // browser, where the handler above answers.
    await page.route("**/_payload.json**", (route) =>
      route.fulfill({ status: 404, body: "" }),
    );
    await openInApp(page, "/eksploruj");
    await expect(
      page.getByText("Liczby ze stanu bazy z 14 września 2026"),
    ).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot("eksploruj.png", {
      fullPage: true,
      timeout: 20_000,
    });
    await expectFitsThePhone(page, testInfo);
  },
);
