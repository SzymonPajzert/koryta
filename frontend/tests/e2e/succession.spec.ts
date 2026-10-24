import { test, expect, type Locator, type Page } from "@playwright/test";
import { authorizationFor, USERS } from "./helpers/auth";
import { waitForLoginFormHydrated } from "./helpers/login";

/** The seeded institution with a board history. Every other seeded place holds
 * one employment, and one employment can never pair with anything. */
const COMPANY = "/instytucja/wojewodzki-zaklad-testowy-sukspolka";
/** Somebody who took a seat over from a named predecessor on the same day. */
const SUCCESSOR = "/osoba/danuta-obejmujaca-sukdanuta";

/** Open the „(i)” by a section's head and wait for `inside` to show in it.
 *
 * What a section explains rather than counts - how the pairs are made, what
 * was left out and why - stands behind that „(i)”, in a tooltip that is not in
 * the document at all until it opens. Hovered rather than clicked: where the
 * pointer can hover the bubble opens on hover too, and a click after the hover
 * is the toggle that shuts it again (`useCanHover`). Retried as a whole, from
 * off the icon, because a page that arrived server rendered drops the first
 * hover until Vue has attached its listeners. */
async function openInfo(page: Page, section: Locator, inside: Locator) {
  await expect(async () => {
    await page.mouse.move(0, 0);
    await section.getByTestId("section-info").hover();
    await expect(inside).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

test.describe("Kto kogo zastąpił", () => {
  test("a company page names who took over from whom", async ({ page }) => {
    await page.goto(COMPANY, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".v-main")).toBeVisible();

    // The company itself, which is the half of the page that existed before -
    // as a redirect to the table filtered to it, where none of this could go.
    await expect(page.locator(".v-main")).toContainText(
      "Wojewódzki Zakład Testowy",
    );
    await expect(page.getByText("KRS:")).toBeVisible({ timeout: 30_000 });

    // Who sits there now, split by the role the register files them under...
    const board = page.getByTestId("successions-current");
    await expect(board).toContainText("Obecny skład", { timeout: 30_000 });
    await expect(board).toContainText("Franciszek Następny");
    // ...and, on the person who took a seat over, who they took it from.
    await expect(board).toContainText("Edward Poprzedni");

    // Drawn once: the history under the board leaves today's posts out
    // (Szymon, 2026-10-23), and keeps the ones that ended.
    const history = page.getByTestId("relations-history");
    await expect(history).toContainText("Edward Poprzedni");
    await expect(history).not.toContainText("Franciszek Następny");

    const relay = page.getByTestId("successions-relay");
    await expect(relay).toContainText("Kto kogo zastąpił", {
      timeout: 30_000,
    });

    // Two supervisory-board seats changed hands on 2024-04-12. The register
    // files that as one decision and the page has to read as one card, not as
    // two unrelated rows - which is the whole point of the batching. „tego
    // dnia” in the card's head: the gap chip in each row says „tego samego
    // dnia” already.
    await expect(relay).toContainText("2 zmiany tego dnia");
    // Both departing members were filed under PiS, which is the tally the
    // batch header carries.
    await expect(relay).toContainText("2 × PiS");

    // A seat that stood empty says how long for, rather than showing a date
    // difference the reader has to work out.
    await expect(relay).toContainText("po 46 dniach przerwy");

    // The one handover a logged out reader may not be shown, because the
    // person who took the seat has no page here. Counted beside the head
    // rather than silently dropped, or the section reads as broken - and why,
    // behind its „(i)”.
    await expect(page.getByTestId("successions-count")).toContainText(
      "1 pominięta",
    );
    await openInfo(page, relay, page.getByTestId("successions-hidden"));
    await expect(page.getByTestId("successions-hidden")).toContainText(
      "Nie pokazujemy 1 zmiany",
    );
    await expect(page.locator(".v-main")).not.toContainText(
      "Grzegorz Bez Strony",
    );
  });

  test("a person page says whose seat they took", async ({ page }) => {
    await page.goto(SUCCESSOR, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".v-main")).toBeVisible();

    // The hint on the relation itself...
    const row = page.locator('[data-testid^="edge-predecessor-"]').first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText("Wcześniej:");
    // Two members left that seat on 2024-04-12 and two arrived, so the pairing
    // picks one of the two assignments the dates allow. It is stable - the
    // matcher orders on the register rather than on edge ids - but the row has
    // to hedge it, because which chair each took is not recorded.
    await expect(row).toContainText("m.in.");
    await expect(row).toContainText(/Barbara Ustępująca|Adam Ustępujący/);

    // ...and the section that states it: the handover row a company's page
    // draws too, who left, then who took the seat.
    const section = page.getByTestId("person-successions");
    await expect(section).toContainText("Zmiany na stanowisku");
    await expect(page.getByTestId("person-successions-count")).toContainText(
      "1 zmiana",
    );
    const card = section.getByTestId("succession-predecessor");
    await expect(card.getByTestId("handover-left")).toContainText(
      /Barbara Ustępująca|Adam Ustępujący/,
    );
    await expect(card.getByTestId("handover-right")).toContainText(
      "Danuta Obejmująca",
    );

    // How much of the history it covers, behind the head's „(i)”, so the rows
    // it says nothing about do not read as a bug.
    const coverage = page.getByTestId("person-successions-coverage");
    await openInfo(page, section, coverage);
    await expect(coverage).toContainText("1 z 1 powiązania");
  });

  test("the endpoint withholds a name from a visitor and gives it to an editor", async ({
    page,
  }) => {
    const anonymous = await page.request.get(
      "/api/edges/successions?companyId=sukspolka",
    );
    // The flag alone, which until 2026-10-14 was all it took to be told.
    const typed = await page.request.get(
      "/api/edges/successions?companyId=sukspolka&latest=true",
    );
    const editor = await page.request.get(
      "/api/edges/successions?companyId=sukspolka&latest=true",
      { headers: await authorizationFor(page.request, USERS.admin) },
    );

    const forReaders = await anonymous.json();
    const forTyped = await typed.json();
    const forEditors = await editor.json();

    // `sukgrzegorz` has no page, so the prokurent handover is withheld and
    // counted instead.
    expect(forReaders.hidden).toBe(1);
    expect(JSON.stringify(forReaders)).not.toContain("Grzegorz Bez Strony");

    expect(forTyped.hidden).toBe(1);
    expect(JSON.stringify(forTyped)).not.toContain("Grzegorz Bez Strony");

    expect(forEditors.hidden).toBe(0);
    expect(forEditors.successions.length).toBe(
      forReaders.successions.length + 1,
    );
    expect(JSON.stringify(forEditors)).toContain("Grzegorz Bez Strony");
  });

  test("a signed in reader is shown it too, not just the endpoint", async ({
    page,
  }) => {
    test.setTimeout(120_000); // logs in, then loads the company page

    // The guard for the bug this feature shipped with. `authFetch` appends
    // `latest` from an `onRequest` that returns early on the server, so the
    // server-rendered request went out anonymous and `useFetch` - already
    // holding that answer - never repeated it once auth resolved in the
    // browser. Somebody signed in kept being told "nie pokazujemy jeszcze N
    // zmian" about people they could open by hand.
    //
    // No component test can catch this. There is no server in one, so
    // `onRequest` runs there and adds the flag whether or not the component
    // asked for it itself - which is exactly how this got through.
    await page.goto(`/login?redirect=${encodeURIComponent(COMPANY)}`);
    await waitForLoginFormHydrated(page);
    await page.locator("input#email").fill("admin@koryta.pl");
    await page.locator("input#password").fill("password123");
    await page.locator('button[type="submit"]').click({ force: true });

    await page.waitForURL("**/instytucja/**", { timeout: 30_000 });
    await expect(page.locator(".v-main")).toContainText("Kto kogo zastąpił", {
      timeout: 30_000,
    });

    // The reload is the whole test. Arriving here by the login redirect is a
    // client-side navigation, so the component mounts in the browser and
    // `authFetch`'s `onRequest` runs - which hides the bug. Loading the page
    // cold is what a reader actually does, and that path renders on the server
    // with nobody signed in.
    await page.reload({ waitUntil: "domcontentloaded" });

    // Scoped to the handovers, not to `.v-main`. The page's other lists read
    // other answers - the relation history comes from the local graph, which
    // refetches on its own - so asserting against the whole page could pass
    // while the section under test is still showing the redacted answer.
    const relay = page.getByTestId("successions-relay");
    await expect(relay).toContainText("Kto kogo zastąpił", {
      timeout: 30_000,
    });
    await expect(relay).toContainText("Grzegorz Bez Strony", {
      timeout: 30_000,
    });
    // Nothing left out, so nothing counted as left out beside the head.
    await expect(page.getByTestId("successions-count")).not.toContainText(
      "pominięt",
      { timeout: 30_000 },
    );
  });

  test("a company link leads to the company, not to the table", async ({
    page,
  }) => {
    // Between 2026-05-21 and 2026-08-24 `generateNodeUrl` sent every place to
    // /eksploruj/tabela?place=..., which made the place branch of the entity
    // view unreachable for three months.
    await page.goto(SUCCESSOR, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".v-main")).toBeVisible();

    await page
      .locator('[data-testid="relations-history"]')
      .getByText("Wojewódzki Zakład Testowy")
      .first()
      .click();

    await expect(page).toHaveURL(/\/instytucja\/.+/, { timeout: 30_000 });
    await expect(page.locator(".v-main")).toContainText("Kto kogo zastąpił");
  });
});
