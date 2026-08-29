import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/** `settled` is what has to be on the page before it is worth capturing, for
 * the pages that draw themselves from an api response rather than from the
 * document the server sent. `viewports` narrows a page to some of the projects,
 * for the ones a phone-sized shot says nothing about. `act` is for state a
 * visitor reaches by clicking rather than by url - it runs once the page has
 * settled and before the capture. */
const pages: {
  name: string;
  path: string;
  settled?: (string | RegExp)[];
  viewports?: string[];
  act?: (page: Page) => Promise<void>;
}[] = [
  { name: "home", path: "/" },
  { name: "login", path: "/login" },
  { name: "zrodla", path: "/zrodla" },
  { name: "o-nas", path: "/o-nas" },
  { name: "pomoc", path: "/pomoc" },
  // Not a page: the path is deliberately unroutable, so this captures
  // app/error.vue's 404 branch. Keep it single-segment - two segments would
  // match pages/[seoType]/[slug].vue and render an entity instead.
  { name: "not-found", path: "/nie-ma-takiej-strony" },
  {
    name: "statystyki",
    path: "/eksploruj/statystyki",
    // Two fetches feed this page and only one of them is server rendered. The
    // state of the base arrives with the document; the activity section is
    // fetched from the browser, because it carries names for admins and so has
    // to go out with the caller's token. Its tiles replace a skeleton when it
    // lands, so waiting for a tile label is what stops the capture racing it.
    //
    // Against the seeded world every chart on the page draws its empty state:
    // the fixtures seed no votes, notes or comments, and the newest revision in
    // them is from 2023, so the rolling activity window is always empty. That
    // is what makes the shot stable day to day - and it does mean this baseline
    // covers the layout, the copy and the empty states rather than the charts.
    settled: ["Ocena ekstrakcji", "Opublikowane:"],
  },
  {
    // A company's own page, restored 2026-08-24. `suk-spolka` is the seeded
    // institution with a board history, so this covers the two sections that
    // only exist here: who sits there now, and who they took over from -
    // including the same-day batch, which is the layout most likely to break.
    name: "instytucja-strona",
    path: "/instytucja/wojewodzki-zaklad-testowy-sukspolka",
    // Both sections are filled from /api/edges/successions after the page
    // renders, so capturing before it lands catches a page with two empty
    // headings on it.
    settled: ["Kto kogo zastąpił", "2 zmiany tego samego dnia"],
  },
  {
    // The table filtered to a place, which is no longer what a place's page
    // is - but is still where "Eksploruj powiązania" leads, and still the only
    // place the identifiers a ministry or an urząd does have get drawn.
    name: "instytucja",
    path: "/eksploruj/tabela?place=chain-company",
    // Rendered entirely client side, so none of it exists until two separate
    // responses have arrived: the place list the card is drawn from, and the
    // people the table is filtered to. Capturing before both leaves a card
    // with no identifiers and a table still spinning.
    settled: [/REGON:\s*123456785/, "Osoba Testowa"],
    // Desktop only, and no longer because of the table: the phone view is two
    // merged columns now and fits. What is left is the closed end-drawer, which
    // sits off the right edge of the document rather than being taken out of
    // it, so a fullPage shot comes out wider than the phone and spends most of
    // itself on empty canvas with the card and its identifiers squeezed into
    // the left of the frame. It captures the drawer, not this page.
    viewports: ["visual-desktop"],
  },
  {
    // Three or more institutions fold into one card listing their names, so
    // that a table filtered on a dozen of them still starts above the fold.
    // The seed has exactly three places, which is the threshold.
    name: "instytucje-zwiniete",
    path: "/eksploruj/tabela?place=2&place=company-empty&place=chain-company",
    settled: ["Wybrane firmy (3)"],
    // Desktop only, for the reason the single institution above is.
    viewports: ["visual-desktop"],
  },
  {
    // The other half of that card: the summaries are not in the document at
    // all until this button puts them there.
    name: "instytucje-rozwiniete",
    path: "/eksploruj/tabela?place=2&place=company-empty&place=chain-company",
    settled: ["Wybrane firmy (3)"],
    act: async (page) => {
      await page.getByRole("button", { name: "Pokaż szczegóły" }).click();
      await page
        .getByText(/REGON:\s*123456785/)
        .first()
        .waitFor();
    },
    viewports: ["visual-desktop"],
  },
];

for (const { name, path, settled, viewports, act } of pages) {
  test(name, async ({ page }, testInfo) => {
    test.skip(
      !!viewports && !viewports.includes(testInfo.project.name),
      `captured only in ${viewports?.join(", ")}`,
    );
    await page.goto(path);
    await page.locator(".v-main").waitFor();
    for (const text of settled ?? []) {
      await page.getByText(text).first().waitFor({ timeout: 30_000 });
    }
    await act?.(page);
    // Images below the fold are lazy-loaded, so a fullPage screenshot would
    // otherwise request them mid-capture and keep growing the page height
    // (see /o-nas). Scroll through the page to trigger them, then wait until
    // they have all settled.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
        window.scrollTo(0, y);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      window.scrollTo(0, 0);
    });
    await page.evaluate(() => document.fonts.ready);
    await page
      .waitForFunction(
        () => Array.from(document.images).every((img) => img.complete),
        undefined,
        { timeout: 10_000 },
      )
      // An image that never settles is not worth failing on here —
      // toHaveScreenshot retries until two consecutive captures match.
      .catch(() => {});
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: true,
      timeout: 20_000,
    });
  });
}
