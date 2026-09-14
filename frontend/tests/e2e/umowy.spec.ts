import { test, expect } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";

/** The things about public contracts that only a browser can settle.
 *
 * Everything else about this feature is covered where it is cheaper: the gate
 * itself in `tests/server/contracts.test.ts`, the eleven rendering branches in
 * `tests/components/contract/Row.test.ts`, the empty company section in
 * `CompanySection.test.ts`. What is left here is what needs a layout engine, a
 * url bar, or the raw bytes of a response.
 *
 * The seed behind it is `scripts/contracts.json`: seven CRU payloads run
 * through the real `toContractDoc`/`resolveNodeIds`, resolving onto „Wojewódzki
 * Zakład Testowy" (buyer on four), Orlen (both ends) and „Firma Testowa".
 * „Firma Pusta" is deliberately left off every one of them, because „an
 * institution with no contracts renders no section at all" is 4 103 of the
 * site's 4 928 company pages and it needs a page to be asserted on.
 */

const PHONE = { width: 375, height: 667 };

/** One contract card. `ContractRow` carries no testid of its own - the class is
 * what it does carry, and it is on the root `<article>`. */
const CONTRACT_ROW = '[data-testid="umowy-row"]';

/** Whichever of the two always-rendered halves of `ContractFilters` the current
 * width is showing. */
// `^=` matches both halves. `ContractFilters` keeps the phone controls
// (`umowy-sort`) and the desktop ones (`umowy-sort-md`) in the DOM at once -
// which half is visible is a CSS decision, because under SSR `useDisplay()`
// reports mobile for everyone and a `v-if` on it would render the phone branch
// into the indexed html. `:visible` then picks whichever one this viewport
// shows; a plain `="umowy-sort"` finds nothing at desktop width.
const SORT_TOGGLE = '[data-testid^="umowy-sort"]:visible';

/** Buyer on four of the seven fixtures, and the one whose counterparty is a
 * company we hold - so it is the page that has people to withhold. */
const COMPANY_WITH_CONTRACTS =
  "/instytucja/wojewodzki-zaklad-testowy-sukspolka";

/** On no fixture at all, and with no NIP in `COMPANY_IDENTIFIERS`. */
// `companyempty` and not `company-empty`: `parseEntityUrlSlug` takes the id as
// the LAST dash-separated segment of the slug, so a fixture id containing a
// hyphen makes its own canonical url unreachable - the page would look for a
// node called „empty". The fixture was renamed for this test.
const COMPANY_WITHOUT_CONTRACTS = "/instytucja/firma-pusta-companyempty";

/** Fully published: the node carries a revision and so does the employment
 * edge, which is the pair `attachPeople` checks. */
const PUBLISHED_PERSON = "Jan Kowalski";

/** Published page, unpublished employment - the (edge false, person true)
 * corner, 252 edges of it graph-wide. Our opinion, so never sent to a logged
 * out reader. */
const DRAFT_LINK_PERSON = "Anna Nowak";

test.describe("/eksploruj/umowy on a phone", () => {
  test.use({ viewport: PHONE });

  test("does not scroll sideways, with a 62-character registry name on screen", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/eksploruj/umowy", { waitUntil: "load" });

    await expect(page.getByTestId("umowy-headline")).toBeVisible({
      timeout: 60_000,
    });

    // The name that makes this test worth running: „WOJEWÓDZKI ZAKŁAD TESTOWY
    // SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ" is one unbreakable token to a
    // browser, and without `overflow-wrap: anywhere` plus `min-width: 0` on the
    // flex children it sets the width of the document.
    await expect(page.locator(CONTRACT_ROW).first()).toBeVisible();

    // Measured rather than screenshotted, for the reason
    // `tests/e2e/nowe_table_fits.spec.ts` gives: the number is the complaint.
    // `expectFitsThePhone` in tests/visual/phoneWidth.ts names the culprit
    // better, but it returns early outside the `visual-mobile` project, so it
    // cannot carry the assertion here.
    const { doc, viewport, widest } = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      const over = (el: Element) => {
        const r = el.getBoundingClientRect();
        return (
          r.width > 0 && r.height > 0 && r.right + window.scrollX > viewport
        );
      };
      const widest = Array.from(document.querySelectorAll("body *"))
        .filter((el) => over(el) && !Array.from(el.children).some(over))
        .slice(0, 5)
        .map(
          (el) =>
            `${el.tagName.toLowerCase()}.${el.getAttribute("class") ?? ""} "${el.textContent
              .trim()
              .slice(0, 40)}"`,
        );
      return {
        doc: document.documentElement.scrollWidth,
        viewport,
        widest,
      };
    });

    expect(
      doc,
      `The page is ${doc}px wide on a ${viewport}px phone.\n${widest.join("\n")}`,
    ).toBeLessThanOrEqual(viewport);
  });
});

test.describe("/eksploruj/umowy", () => {
  test("keeps the chosen ordering in the url, and across a reload", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/eksploruj/umowy", { waitUntil: "load" });
    await expect(page.locator(CONTRACT_ROW).first()).toBeVisible({
      timeout: 60_000,
    });

    // `:visible`, because `ContractFilters` keeps BOTH halves of itself in the
    // dom at every width - the bottom sheet below `md` and the inline controls
    // from `md` up - so the testid matches twice and a bare `getByTestId` is
    // ambiguous under strict mode. That duplication is the point of the design:
    // a `v-if` on `useDisplay()` would render the phone half into the SSR html
    // for everybody.
    // Clicked until it takes, which is `waitForLoginFormHydrated`'s idiom and
    // is here for the same reason. The default mode is server-rendered, so the
    // toggle is on screen and clickable while it is still inert markup with no
    // listener attached; the click then does nothing and the url never moves.
    // There is no marker that says „hydrated" - `v-btn--active` is in the
    // server's html too, on whichever option is the default - so the only
    // honest probe is the effect itself. Verified against a running stack that
    // the click does write `?sort=kwota` once Vue has taken over.
    await expect(async () => {
      await page
        .locator(`${SORT_TOGGLE} button`, { hasText: "Największe kwoty" })
        .click();
      await expect(page).toHaveURL(/[?&]sort=kwota/, { timeout: 1000 });
    }).toPass({ timeout: 30_000 });

    // In the url because it is a view somebody sends to somebody else. The
    // cursor deliberately is not, and the canonical never moves off the bare
    // path whatever this says.
    await expect(page).toHaveURL(/[?&]sort=kwota/);

    await page.reload({ waitUntil: "load" });
    await expect(page.locator(CONTRACT_ROW).first()).toBeVisible({
      timeout: 60_000,
    });

    // Vuetify emits no `aria-pressed` anywhere - checked against the installed
    // copy - so the selected member of a `v-btn-toggle` is its `v-btn--active`
    // class and nothing else.
    await expect(
      page.locator(`${SORT_TOGGLE} button`, { hasText: "Największe kwoty" }),
    ).toHaveClass(/v-btn--active/);

    // The largest of the seven fixtures. Asserted on the first row rather than
    // by comparing parsed values, because the value a row prints is the thing
    // the reader ordered by.
    await expect(page.locator(CONTRACT_ROW).first()).toContainText(
      "1 234 567,89",
    );
  });

  test("appends rows rather than replacing them", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/eksploruj/umowy", { waitUntil: "load" });
    await expect(page.locator(CONTRACT_ROW).first()).toBeVisible({
      timeout: 60_000,
    });

    const rows = page.locator(CONTRACT_ROW);
    const before = await rows.count();
    const firstBefore = await rows.first().innerText();

    const more = page.getByTestId("umowy-more");
    // The seed holds seven contracts against a page size of twenty, so there is
    // nothing to page through locally - and the button is therefore absent, not
    // merely inert: `ContractFeed` renders it only when `nextCursor` is set,
    // because the median company has two contracts and a „Pokaż więcej" that
    // loads nothing is what a reader reports as broken.
    //
    // Asserted rather than assumed, so this case is covered by the same test
    // that covers the other one. Skipped after that: the moment
    // `scripts/contracts.json` passes twenty fixtures the rest of this starts
    // guarding the cursor, which is the part of the feed that fails silently.
    if ((await more.count()) === 0) {
      await expect(page.getByText("To już wszystkie umowy")).toBeVisible();
      test.skip(true, "the seed fits on one page");
      return;
    }

    await more.click();
    await expect(rows).not.toHaveCount(before);
    expect(await rows.count()).toBeGreaterThan(before);
    // Appended, not replaced - a feed that re-fetches from the top on „Pokaż
    // więcej" looks identical until you read the first card.
    expect(await rows.first().innerText()).toBe(firstBefore);
  });
});

test.describe("the Umowy publiczne section on an institution", () => {
  test("is absent entirely from a company with no contracts", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto(COMPANY_WITHOUT_CONTRACTS, { waitUntil: "load" });
    // The title and not a heading role: `CardCompanySummary` draws a company's
    // name in a `<span class="text-h6">`, so `getByRole("heading")` matches
    // nothing on any institution page. The title is set from the node, so it
    // is the cheapest proof that the page resolved rather than 404ed.
    await expect(page).toHaveTitle(/Firma Pusta/, { timeout: 60_000 });
    await expect(page.getByText("Firma Pusta").first()).toBeVisible();

    await expect(page.getByTestId("company-contracts")).toHaveCount(0);
    // The heading and not just the rows: an empty section with a title is still
    // a section, on five company pages in six.
    //
    // The heading element, not the string. Two things make a substring search
    // wrong here: the footer carries an „Umowy publiczne" link to
    // /eksploruj/umowy on every page of the site now, and it is rendered
    // *inside* `<main>` in this layout - so neither `page.content()` nor a
    // `main` scope excludes it. `PageSection` draws its title as an `<h3>`
    // (`app/components/PageSection.vue:5`), which is the thing whose absence
    // this case is actually about.
    await expect(
      page.getByRole("heading", { name: "Umowy publiczne" }),
    ).toHaveCount(0);
  });

  test("is there, with its coverage sentence, on a company that has them", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto(COMPANY_WITH_CONTRACTS, { waitUntil: "load" });

    const section = page.getByTestId("company-contracts");
    await expect(section).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("company-contracts-coverage")).toContainText(
      "Centralnym Rejestrze Umów",
    );
    await expect(section.locator(CONTRACT_ROW).first()).toBeVisible();
  });

  test("never sends a logged out reader the name behind an unpublished link", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto(COMPANY_WITH_CONTRACTS, { waitUntil: "load" });
    await expect(page.getByTestId("company-contracts")).toBeVisible({
      timeout: 60_000,
    });

    // On `page.content()` and deliberately not on visibility. The whole point
    // of gating per row on the server is that the bytes never leave it: a name
    // in the html and hidden by CSS is a name in a 60 s CDN entry this repo
    // cannot purge, and `?latest=true` is verified to leak thirteen of them on
    // /api/graph/local today.
    const html = await page.content();
    expect(html).toContain(PUBLISHED_PERSON);
    expect(html).not.toContain(DRAFT_LINK_PERSON);
  });

  test("shows the same reader the draft link once they sign in", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await logIn(page, USERS.normal, COMPANY_WITH_CONTRACTS);
    await expect(page.getByTestId("company-contracts")).toBeVisible({
      timeout: 60_000,
    });

    const section = page.getByTestId("company-contracts");
    await expect(section).toContainText(DRAFT_LINK_PERSON);
    // Three signals, never colour alone: the dashed note, the sentence and the
    // „szkic" badge.
    await expect(section).toContainText("Naszym zdaniem powiązani");
  });
});

test.describe("/eksploruj/umowy and its signed-in modes", () => {
  // This assertion is the inverse of the one it replaces. Until 2026-09-14 this
  // url was the signed-in view alone and `middleware: "auth"` bounced everybody
  // else to /login; the public list then moved onto it as the default mode, and
  // the whole point of the feature is that a stranger arriving from a search
  // result reads the register without an account.
  test("serves a logged out visitor the register rather than the login page", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/eksploruj/umowy", { waitUntil: "load" });

    await expect(page.locator(CONTRACT_ROW).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page).not.toHaveURL(/\/login/);
    // No mode switch either: „Ludzie" and „Obie strony" name people we have not
    // published, so to a logged out reader they are two chips leading nowhere.
    await expect(page.getByTestId("umowy-tryb")).toHaveCount(0);
  });

  test("answers a logged out ?tryb=ludzie with the public list, and corrects the url", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/eksploruj/umowy?tryb=ludzie", { waitUntil: "load" });

    // The contract list, not an empty page and not /login. A typed or shared
    // `?tryb=` is somebody who wanted contracts either way.
    await expect(page.locator(CONTRACT_ROW).first()).toBeVisible({
      timeout: 60_000,
    });
    // Corrected back to the default rather than left saying „ludzie" over a
    // list of contracts. `replace`, so the back button leaves the page instead
    // of walking into the correction again.
    await expect(page).toHaveURL(/\/eksploruj\/umowy$/, { timeout: 30_000 });

    // On `page.content()` and deliberately not on visibility, for the reason
    // the company-page case gives: a name withheld by CSS is still a name in a
    // response this repo cannot purge from the CDN.
    expect(await page.content()).not.toContain(DRAFT_LINK_PERSON);
  });

  test("states the cap above the fold for a signed-in reader", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // Straight into the mode, because „umowy" is now what this url renders by
    // default to everybody.
    await logIn(page, USERS.normal, "/eksploruj/umowy?tryb=ludzie");

    // A truncated list that prints a register-wide total without saying it is
    // truncated is a lie about coverage, on the surface where publishing
    // decisions get made - so this is above the rows, not in a footer.
    await expect(page.getByTestId("umowy-osoby-cap")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("umowy-osoby-legend")).toContainText("szkic");
  });

  test("switches modes from the chips, and says so in the url", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await logIn(page, USERS.normal, "/eksploruj/umowy");

    // The chip group exists only once firebase has restored the session, so by
    // the time it is visible Vue is running and a single click takes - unlike
    // the sort toggle above, which is in the server's html and inert until
    // hydration.
    const modes = page.getByTestId("umowy-tryb");
    await expect(modes).toBeVisible({ timeout: 60_000 });

    await modes.locator(".v-chip", { hasText: "Ludzie" }).click();

    // A mode is a view somebody sends to somebody else, so it lives in the url -
    // and the default stays out of it, which is why this is the only one of the
    // three that can be asserted on.
    await expect(page).toHaveURL(/[?&]tryb=ludzie/, { timeout: 30_000 });
    await expect(page.getByTestId("umowy-osoby-legend")).toBeVisible({
      timeout: 60_000,
    });

    await modes.locator(".v-chip", { hasText: "Umowy" }).click();
    await expect(page).toHaveURL(/\/eksploruj\/umowy$/, { timeout: 30_000 });
    await expect(page.locator(CONTRACT_ROW).first()).toBeVisible({
      timeout: 60_000,
    });
  });
});
