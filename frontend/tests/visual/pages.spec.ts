import { test, expect } from "./test";
import type { Page } from "@playwright/test";
import { freezeClock } from "./clock";
import { expectFitsThePhone } from "./phoneWidth";
import { pageTag } from "./pageTags";

/** `file` is the page under app/pages that the path renders, for the test's
 * `@page:` tag (see ./pageTags.ts); only not-found goes without, since what it
 * renders is app/error.vue. `settled` is what has to be on the page before it
 * is worth capturing, for the pages that draw themselves from an api response
 * rather than from the document the server sent. `viewports` narrows a page to
 * some of the projects, for the ones a phone-sized shot says nothing about.
 * `act` is for state a visitor reaches by clicking rather than by url - it
 * runs once the page has settled and before the capture. `inApp` opens the
 * path the way a link inside the site would, under the frozen clock, for a
 * page that prints dates counted from today. */
const pages: {
  name: string;
  path: string;
  file?: string;
  settled?: (string | RegExp)[];
  viewports?: string[];
  act?: (page: Page) => Promise<void>;
  inApp?: boolean;
}[] = [
  { name: "home", path: "/", file: "index" },
  { name: "login", path: "/login", file: "login" },
  { name: "zrodla", path: "/zrodla", file: "zrodla" },
  { name: "o-nas", path: "/o-nas", file: "o-nas" },
  { name: "pomoc", path: "/pomoc", file: "pomoc" },
  // The two legal documents, which had no baseline at all. Their content is
  // markdown in frontend/content, so these are the most deterministic shots in
  // the suite - no seed, no dates, no counts - and they are the only cover the
  // `content-styles` rules in pages/plik/[name].vue have.
  //
  // Worth having a shot of each rather than one of either: the two rendered
  // the same document for a while, because every /plik/* route shared one
  // async-data key, and a single capture cannot tell that apart from working.
  // tests/e2e/legal_pages.spec.ts is what guards the navigation itself.
  { name: "plik-regulamin", path: "/plik/regulamin", file: "plik/[name]" },
  {
    name: "plik-polityka-prywatnosci",
    path: "/plik/polityka_prywatnosci",
    file: "plik/[name]",
  },
  // Not a page: the path is deliberately unroutable, so this captures
  // app/error.vue's 404 branch. Keep it single-segment - two segments would
  // match pages/[seoType]/[slug].vue and render an entity instead.
  { name: "not-found", path: "/nie-ma-takiej-strony" },
  // Where an /entity/ url of the old scheme lands when it is not a type and an
  // id: pages/entity/[...path].vue, a line of text rather than the 404 above.
  {
    name: "entity-nieznana",
    path: "/entity/nieznana",
    file: "entity/[...path]",
  },
  // For the owners of the sites the article crawler reads: its user agent is
  // `KorytaCrawler/0.1 (+http://koryta.pl/crawler)`.
  { name: "crawler", path: "/crawler", file: "crawler" },
  {
    name: "statystyki",
    path: "/eksploruj/statystyki",
    file: "eksploruj/statystyki",
    // Two fetches feed this page and only one of them is server rendered. The
    // state of the base arrives with the document; the activity section is
    // fetched from the browser, because it carries names for admins and so has
    // to go out with the caller's token. Its tiles replace a skeleton when it
    // lands, so waiting for a tile label is what stops the capture racing it.
    //
    // Against the seeded world every chart on the page draws its empty state:
    // the fixtures seed no votes or notes, and the newest revision in them is
    // from 2023, so the rolling activity window is always empty. That is what
    // makes the shot stable day to day - and it does mean this baseline covers
    // the layout, the copy and the empty states rather than the charts.
    settled: ["Źródło lub zgłoszenie", "Opublikowane:"],
  },
  {
    // A company's own page, restored 2026-08-24. `suk-spolka` is the seeded
    // institution with a board history, so this covers the two sections that
    // only exist here: who sits there now, and who they took over from -
    // including the same-day batch, which is the layout most likely to break.
    name: "instytucja-strona",
    path: "/instytucja/wojewodzki-zaklad-testowy-sukspolka",
    file: "[seoType]/[slug]",
    // Both sections are filled from /api/edges/successions after the page
    // renders, so capturing before it lands catches a page with two empty
    // headings on it.
    settled: ["Kto kogo zastąpił", "2 zmiany tego samego dnia"],
    // „stan na” over the current board, and every open post's „2 lata na
    // stanowisku”, count from a today that CompanyChanges.vue fixes at render
    // - on the server, for a page the server sends. So the shot changed every
    // day, and on a phone the caption's wrap moved everything below it. Drawn
    // in the browser instead, they count from ./clock.ts.
    inApp: true,
  },
  {
    // The table filtered to a place, which is no longer what a place's page
    // is - but is still where "Eksploruj powiązania" leads, and still the only
    // place the identifiers a ministry or an urząd does have get drawn.
    name: "instytucja",
    path: "/eksploruj/tabela?place=chain-company",
    file: "eksploruj/tabela",
    // Rendered entirely client side, so none of it exists until two separate
    // responses have arrived: the place list the card is drawn from, and the
    // people the table is filtered to. Capturing before both leaves a card
    // with no identifiers and a table still spinning. The card is below the
    // table since the query-bar redesign, which is why this is a fullPage shot
    // and not a viewport one.
    settled: [/REGON:\s*123456785/, "Osoba Testowa"],
    // Desktop only, and not because of the table: the phone view is two merged
    // columns and fits, and everything above the first row is one 44px bar. What
    // is left is the closed end-drawer, which sits off the right edge of the
    // document rather than being taken out of it, so a fullPage shot comes out
    // wider than the phone and spends most of itself on empty canvas with the
    // card and its identifiers squeezed into the left of the frame. It captures
    // the drawer, not this page.
    viewports: ["visual-desktop"],
  },
  {
    // Three or more institutions fold into one card listing their names, so
    // that a table filtered on a dozen of them still starts above the fold.
    // The seed has exactly three places, which is the threshold.
    name: "instytucje-zwiniete",
    path: "/eksploruj/tabela?place=2&place=company-empty&place=chain-company",
    file: "eksploruj/tabela",
    settled: ["Wybrane firmy (3)"],
    // Desktop only, for the reason the single institution above is.
    viewports: ["visual-desktop"],
  },
  {
    // The other half of that card: the summaries are not in the document at
    // all until this button puts them there.
    name: "instytucje-rozwiniete",
    path: "/eksploruj/tabela?place=2&place=company-empty&place=chain-company",
    file: "eksploruj/tabela",
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

type MountPoint = Element & {
  __vue_app__?: {
    config: {
      globalProperties: {
        $router: { push: (to: string) => Promise<unknown> };
      };
    };
  };
};

/** Open `path` the way a link inside the site would: land on /o-nas, then hand
 * the path to the router. The page is then drawn in the browser, under the
 * clock ./clock.ts stops, rather than arriving drawn by the server, whose
 * clock nothing here can stop. */
async function openInApp(page: Page, path: string) {
  await freezeClock(page);
  await page.goto("/o-nas");
  // Vue sets `__vue_app__` on the mount point when it mounts - hydration
  // included - so from then on the router takes a push.
  await page.waitForFunction(
    () =>
      !!(document.querySelector("#__nuxt") as MountPoint | null)?.__vue_app__,
  );
  await page.evaluate(async (to) => {
    const root = document.querySelector("#__nuxt") as MountPoint;
    await root.__vue_app__!.config.globalProperties.$router.push(to);
  }, path);
  await page.waitForURL(`**${path}`);
}

for (const { name, path, file, settled, viewports, act, inApp } of pages) {
  const tag = file ? [pageTag(file)] : [];
  test(name, { tag }, async ({ page }, testInfo) => {
    test.skip(
      !!viewports && !viewports.includes(testInfo.project.name),
      `captured only in ${viewports?.join(", ")}`,
    );
    if (inApp) await openInApp(page, path);
    else await page.goto(path);
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
    // After the capture, because it moves the page about to find out which
    // element is the wide one.
    await expectFitsThePhone(page, testInfo);
  });
}
