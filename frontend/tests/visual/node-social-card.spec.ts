import type { APIRequestContext } from "@playwright/test";
import { test, expect } from "./test";

/** The picture a platform draws for a person or an institution
 * (OgImage/NodeCard.satori.vue), fetched the way a platform fetches it: the
 * og:image of the page's server render, then that image.
 *
 * Shown on a blank page and screenshotted rather than compared byte for byte:
 * the card's last line names the month it was drawn in („stan bazy: listopad
 * 2026”), so that line is masked, and the rest comes from the seed and does
 * not move. No page tag: what is on screen is the picture, not the route. */

type Card = {
  name: string;
  path: string;
  /** The top of the month line: above the sage band at the foot, which is
   * 16px tall on a card with no figures and 132px with them. */
  monthTop: number;
};

const CARDS: Card[] = [
  // A person with a party and a post: the chip in the party's colour.
  { name: "karta-osoby", path: "/osoba/jan-kowalski-1", monthTop: 564 },
  // A public institution with a board: the filled chip and the figures.
  {
    name: "karta-instytucji-publicznej",
    path: "/instytucja/wojewodzki-zaklad-testowy-sukspolka",
    monthTop: 448,
  },
  // An owner nobody has confirmed: the outline chip.
  { name: "karta-instytucji", path: "/instytucja/orlen-2", monthTop: 448 },
];

const MONTH_HEIGHT = 34;

async function cardOf(request: APIRequestContext, path: string) {
  const html = await (await request.get(path)).text();
  const image =
    /<meta property="og:image" content="([^"]+)"/
      .exec(html)?.[1]
      ?.replaceAll("&amp;", "&") ?? "";
  expect(image, `no card of its own on ${path}`).toContain("/_og/d/");
  // Absolute, and named after the site's url rather than this server.
  const response = await request.get(new URL(image).pathname);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
  return response.body();
}

for (const card of CARDS) {
  test(card.name, async ({ page, request }, testInfo) => {
    test.skip(
      testInfo.project.name !== "visual-desktop",
      "One picture, whatever the viewport",
    );
    const png = await cardOf(request, card.path);

    await page.setViewportSize({ width: 1200, height: 630 });
    await page.setContent(
      `<body style="margin: 0">` +
        `<img src="data:image/png;base64,${png.toString("base64")}" width="1200" height="630" style="display: block">` +
        `<div data-testid="month" style="position: absolute; left: 0; width: 1200px; top: ${card.monthTop}px; height: ${MONTH_HEIGHT}px"></div>` +
        `</body>`,
    );
    await expect(page.locator("img")).toHaveScreenshot(`${card.name}.png`, {
      mask: [page.getByTestId("month")],
    });
  });
}
