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
 *
 * The findings' own contracts are not among them. They are in
 * `scripts/contract_link_contracts.json`, seeded into the closed
 * `contractLinkContracts` collection, and reach a reader only through a
 * finding's detail, behind its gate.
 */

const PHONE = { width: 375, height: 667 };

/** The contract list, which since the findings became the default mode is
 * `?tryb=umowy` rather than the bare path. */
const CONTRACT_LIST = "/eksploruj/umowy?tryb=umowy";

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

/** The subjects of the findings' contracts, `scripts/contract_link_contracts.json`. */
const FINDING_CONTRACT_SUBJECTS = [
  "Przebudowa drogi powiatowej",
  "Remont chodnika przy ul. Szkolnej",
  "Dostawa materiałów biurowych dla Urzędu Gminy Testowo",
];

/** The largest public contract's subject, `scripts/contracts.json`. */
const PUBLIC_CONTRACT_SUBJECT = "Dostawa paliw płynnych";

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
    await page.goto(CONTRACT_LIST, { waitUntil: "load" });

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
    await page.goto(CONTRACT_LIST, { waitUntil: "load" });
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

  test("lists none of the findings' contracts", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(CONTRACT_LIST, { waitUntil: "load" });
    await expect(page.locator(CONTRACT_ROW).first()).toBeVisible({
      timeout: 60_000,
    });

    // A finding's contracts in the public list named its firm, its NIP and
    // its exact total to everybody - for a gated finding, everything the
    // teaser holds back - and ordered by money, tied each teaser to its firm.
    const html = await page.content();
    for (const subject of FINDING_CONTRACT_SUBJECTS) {
      expect(html).not.toContain(subject);
    }
  });

  test("appends rows rather than replacing them", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(CONTRACT_LIST, { waitUntil: "load" });
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

test.describe("/eksploruj/umowy and its modes", () => {
  test("serves a logged out visitor the findings rather than the login page", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/eksploruj/umowy", { waitUntil: "load" });

    await expect(page.getByTestId("powiazania-hero")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page).not.toHaveURL(/\/login/);
    // The two public modes are offered to everybody; the people modes appear
    // as one locked chip that leads to an account.
    await expect(page.getByTestId("umowy-tryb")).toBeVisible();
    await expect(page.getByTestId("umowy-tryb-zablokowany")).toHaveAttribute(
      "href",
      /\/login\?konto=nowe/,
    );
    // A radio group to assistive technology, with the mode it is in: Vuetify
    // alone gives the chips no role and the chosen one only a class.
    const modes = page.getByTestId("umowy-tryb");
    await expect(modes).toHaveAttribute("role", "radiogroup");
    await expect(
      modes.getByRole("radio", { name: "Powiązania" }),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      modes.getByRole("radio", { name: "Wszystkie umowy" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("sends no contract list with the findings", async ({ page }) => {
    test.setTimeout(120_000);
    // The bytes of both halves of a server render, the html and the payload
    // Nuxt fetches for a client-side visit. „Powiązania" shows no contract
    // list, so it has no business carrying one: it used to embed twenty rows
    // of the register on the page most readers open.
    for (const url of ["/eksploruj/umowy", "/eksploruj/umowy/_payload.json"]) {
      const response = await page.request.get(url, { timeout: 60_000 });
      expect(response.ok(), url).toBe(true);
      expect(await response.text(), url).not.toContain(PUBLIC_CONTRACT_SUBJECT);
    }
  });

  test("answers a logged out ?tryb=ludzie with the findings, and corrects the url", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/eksploruj/umowy?tryb=ludzie", { waitUntil: "load" });

    await expect(page.getByTestId("powiazania-lista")).toBeVisible({
      timeout: 60_000,
    });
    // Corrected back to the default rather than left saying „ludzie" over
    // somebody else's list. `replace`, so the back button leaves the page.
    await expect(page).toHaveURL(/\/eksploruj\/umowy$/, { timeout: 30_000 });

    // On `page.content()` and deliberately not on visibility: a name withheld
    // by CSS is still a name in a response this repo cannot purge from the CDN.
    expect(await page.content()).not.toContain(DRAFT_LINK_PERSON);
  });

  test("states the cap above the fold for a signed-in reader", async ({
    page,
  }) => {
    test.setTimeout(120_000);
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

    const modes = page.getByTestId("umowy-tryb");
    await expect(modes.locator(".v-chip", { hasText: "Ludzie" })).toBeVisible({
      timeout: 60_000,
    });

    await modes.locator(".v-chip", { hasText: "Ludzie" }).click();
    await expect(page).toHaveURL(/[?&]tryb=ludzie/, { timeout: 30_000 });
    await expect(page.getByTestId("umowy-osoby-legend")).toBeVisible({
      timeout: 60_000,
    });

    await modes.locator(".v-chip", { hasText: "Wszystkie umowy" }).click();
    await expect(page).toHaveURL(/[?&]tryb=umowy/, { timeout: 30_000 });
    await expect(page.locator(CONTRACT_ROW).first()).toBeVisible({
      timeout: 60_000,
    });

    // The default stays out of the url.
    await modes.locator(".v-chip", { hasText: "Powiązania" }).click();
    await expect(page).toHaveURL(/\/eksploruj\/umowy$/, { timeout: 30_000 });
    await expect(page.getByTestId("powiazania-lista")).toBeVisible();
  });
});

/** The findings fixtures in `scripts/contract_links.json`: two public (ranks 2
 * and 3), three gated (ranks 1, 4 and 5) - so an anonymous reader's list opens
 * on a teaser, `ukryte_1`, and holds three. */
const PUBLIC_FINDING_PERSON = "Tomasz Testowy";
const PUBLIC_FINDING_TIE = "Anna Testowa";
const GATED_FINDING_NAMES = [
  "Marek Przykładowy",
  "PRZYKŁAD SPÓŁKA",
  "Ewa Kandydatka",
  "SPÓŁDZIELNIA TESTOWA",
  "Piotr Urzędnik",
  "Krystyna Urzędnik",
  "DALEKO SPÓŁKA",
  "GMINA PRZYKŁADOWO",
  "GMINA PRÓBNA",
  "KOMENDA WOJEWÓDZKA PAŃSTWOWEJ STRAŻY POŻARNEJ W TESTOWIE",
  "9990000033",
  "9990000044",
  "9990000055",
];
const TEASER_COUNT = 3;

/** Rank 2, public: Tomasz Testowy, with his firm's co-owner behind the gate. */
const PUBLIC_FINDING = "cru_9990000011";

/** Rank 1, gated: Marek Przykładowy. */
const GATED_FINDING = "cru_9990000033";
const GATED_TEASER = "ukryte_1";
/** A NIP no fixture has. */
const MISSING_FINDING = "cru_9990000099";

test.describe("the findings on /eksploruj/umowy", () => {
  test("name the public findings and send no name for the gated ones", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/eksploruj/umowy", { waitUntil: "load" });

    await expect(
      page.getByTestId("powiazania-lista").getByText(PUBLIC_FINDING_PERSON),
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("powiazanie-ukryte")).toHaveCount(
      TEASER_COUNT,
    );

    // The page's bytes, not its paint: the teaser blurs placeholder bars, and
    // the gated names must never have been sent at all. Nor the researched
    // relative on a public finding, who is a private person.
    const html = await page.content();
    for (const name of [...GATED_FINDING_NAMES, PUBLIC_FINDING_TIE]) {
      expect(html).not.toContain(name);
    }
  });

  test("send a reader who unlocks a teaser straight to registration", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/eksploruj/umowy", { waitUntil: "load" });

    const unlock = page.getByTestId("powiazanie-odblokuj").first();
    await expect(unlock).toBeVisible({ timeout: 60_000 });
    // The teaser's rank rides inside the redirect, so the reader comes back
    // to that finding - pinned and open - and not to the top of the list.
    await expect(unlock).toHaveAttribute(
      "href",
      new RegExp(
        "/login\\?konto=nowe&powod=powiazania&redirect=" +
          "%2Feksploruj%2Fumowy%3Fpowiazanie%3D" +
          GATED_TEASER +
          "$",
      ),
    );

    await page.goto(
      "/login?konto=nowe&powod=powiazania&redirect=%2Feksploruj%2Fumowy",
      { waitUntil: "load" },
    );
    await expect(page.getByText("Rejestracja")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("login-powod-powiazania")).toBeVisible();
  });

  test("send a reader who wants a public card's hidden people to registration, for them", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/eksploruj/umowy", { waitUntil: "load" });

    const card = page.getByTestId(`powiazanie-${PUBLIC_FINDING}`);
    const hidden = card.getByTestId("powiazanie-ukryte-osoby");
    await expect(hidden).toBeVisible({ timeout: 60_000 });
    // Its own `powod`: the reader already sees the name, the firm and the
    // contracts, and /login should not promise them those.
    const link = hidden.getByRole("link", { name: "Załóż konto" });
    await expect(link).toHaveAttribute(
      "href",
      new RegExp(
        "/login\\?konto=nowe&powod=powiazania-osoby&redirect=" +
          "%2Feksploruj%2Fumowy%3Fpowiazanie%3D" +
          PUBLIC_FINDING +
          "$",
      ),
    );

    await page.goto((await link.getAttribute("href"))!, { waitUntil: "load" });
    await expect(
      page.getByTestId("login-powod-powiazania-osoby"),
    ).toContainText("osoby powiązane z tą firmą", { timeout: 60_000 });
  });

  test("render a permalinked card with its contracts already in the html", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // The server's answer for the permalink carries the contracts; the card
    // used to drop them, render a progress bar and ask again after hydration.
    const response = await page.request.get(
      `/eksploruj/umowy?powiazanie=${PUBLIC_FINDING}`,
      { timeout: 60_000 },
    );
    expect(await response.text()).toContain(FINDING_CONTRACT_SUBJECTS[0]);
  });

  test("show a signed-in reader every finding, with its ties and contracts", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await logIn(page, USERS.normal, "/eksploruj/umowy");

    const list = page.getByTestId("powiazania-lista");
    await expect(list.getByText("Marek Przykładowy")).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("powiazanie-ukryte")).toHaveCount(0);

    const card = page.getByTestId(`powiazanie-${PUBLIC_FINDING}`);
    await card.getByTestId("powiazanie-rozwin").click();
    await expect(card.getByTestId("powiazanie-osoby")).toContainText(
      PUBLIC_FINDING_TIE,
    );
    await expect(card.getByTestId("powiazanie-umowy")).toContainText(
      "Przebudowa drogi powiatowej",
      { timeout: 30_000 },
    );
  });

  test("pin a gated finding for a logged out reader as the card a missing one gets", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const locked = page.getByTestId("powiazania-przypiete-zablokowane");

    await page.goto(`/eksploruj/umowy?powiazanie=${GATED_FINDING}`, {
      waitUntil: "load",
    });
    await expect(locked).toBeVisible({ timeout: 60_000 });
    await expect(locked).toContainText(
      "To powiązanie widzą zalogowani albo go już nie ma",
    );
    const gatedText = await locked.innerText();
    // Its way in brings the reader back to the same finding.
    await expect(
      page.getByTestId("powiazania-przypiete-rejestracja"),
    ).toHaveAttribute("href", /redirect=.*powiazanie%3Dcru_9990000033/);
    // Nothing about the finding beyond the NIP the reader typed into the url.
    const html = await page.content();
    for (const name of GATED_FINDING_NAMES) {
      if (GATED_FINDING.endsWith(name)) continue;
      expect(html).not.toContain(name);
    }

    // Word for word what a NIP with no finding gets: anything else would
    // say which NIPs are behind the gate.
    await page.goto(`/eksploruj/umowy?powiazanie=${MISSING_FINDING}`, {
      waitUntil: "load",
    });
    await expect(locked).toBeVisible({ timeout: 60_000 });
    expect(await locked.innerText()).toBe(gatedText);

    // „Wszystkie powiązania" drops the pin and leaves the list.
    await page.getByTestId("powiazania-wszystkie").click();
    await expect(page).toHaveURL(/\/eksploruj\/umowy$/, { timeout: 30_000 });
    await expect(page.getByTestId("powiazania-przypiete")).toHaveCount(0);
    await expect(page.getByTestId("powiazania-lista")).toBeVisible();
  });

  test("pin a teaser by its rank for a logged out reader", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`/eksploruj/umowy?powiazanie=${GATED_TEASER}`, {
      waitUntil: "load",
    });

    const pinned = page.getByTestId("powiazania-przypiete");
    await expect(pinned.getByTestId("powiazanie-ukryte")).toBeVisible({
      timeout: 60_000,
    });
    const html = await page.content();
    for (const name of GATED_FINDING_NAMES) {
      expect(html).not.toContain(name);
    }
  });

  test("show a reader who signed up from a teaser that finding, pinned and open", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    // Where the teaser's register link returns to: the same url, now with a
    // session behind it.
    await logIn(
      page,
      USERS.normal,
      `/eksploruj/umowy?powiazanie=${GATED_TEASER}`,
    );

    const pinned = page.getByTestId("powiazania-przypiete");
    const card = pinned.getByTestId(`powiazanie-${GATED_FINDING}`);
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText("Marek Przykładowy");
    await expect(card.getByTestId("powiazanie-rozwin")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(pinned.getByTestId("powiazanie-ukryte")).toHaveCount(0);
  });
});

test.describe("a signed-in reader reloading /eksploruj/umowy", () => {
  test("gets the findings every time, never the error page", async ({
    page,
  }) => {
    test.setTimeout(240_000);
    // Firebase restores a session whenever IndexedDB answers, and nothing
    // orders that after hydration. When it came first the page hydrated as a
    // signed-in reader over html rendered for nobody, an IntersectionObserver
    // was handed a comment node, and Nuxt replaced the page with
    // „Coś poszło nie tak" - about one reload in three on the dev server. A
    // race, so several reloads, both shapes of the page.
    const warnings: string[] = [];
    page.on("console", (message) => {
      if (/hydration/i.test(message.text())) warnings.push(message.text());
    });
    await logIn(page, USERS.normal, "/eksploruj/umowy");

    for (const path of [
      "/eksploruj/umowy",
      `/eksploruj/umowy?powiazanie=${GATED_TEASER}`,
      "/eksploruj/umowy",
      `/eksploruj/umowy?powiazanie=${GATED_TEASER}`,
    ]) {
      await page.goto(path, { waitUntil: "load" });
      // Pinned above the list on the permalink, in the list otherwise: a
      // gated finding, so only a signed-in render names him at all.
      await expect(
        page.getByTestId("powiazania").getByText("Marek Przykładowy").first(),
      ).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Umowy publiczne: kto komu zapłacił",
      );
    }
    expect(warnings).toEqual([]);
  });
});
