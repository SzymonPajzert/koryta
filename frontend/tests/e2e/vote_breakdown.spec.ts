import { test, expect } from "@playwright/test";
import { waitForLoginFormHydrated } from "./helpers/login";

/** The total-score column explains itself when clicked.
 *
 * Worth an e2e rather than only a component test because the bug this feature
 * uncovered was invisible to one: `ExploreTable`'s cell template was keyed
 * `item.votes.interesting` while the column is keyed `stats.votes.interesting`,
 * so the slot had never matched and Vuetify had been rendering the raw value
 * instead. A component test that mounts the widget directly passes either way -
 * it takes the real table, with the real headers, to notice.
 *
 * `nowe-person-1` is seeded with two model scores and no human vote (see
 * scripts/nodes.json), so it exercises the model list and the "nobody has
 * voted" branch together.
 *
 * It is read on /eksploruj/tabela rather than on /eksploruj/nowe, where this
 * test used to run. The queue cut its column list from eleven to five to fit
 * the card, and "Głosy łącznie" was one of the three that went: the number
 * moved under the name as a plain caption (`scoreWithName` in
 * explore/Table.vue), and the breakdown went with the column. So the widget
 * this test is about no longer exists on that page, and the test had been red
 * on main ever since - looking for a button that the redesign deliberately
 * removed. /eksploruj/tabela is the page that still declares the column, which
 * is also the only place the keying bug above could ever come back.
 *
 * `visibility=private` is what puts the same unapproved person in front of the
 * full column set: the api reads it as `stats.isApproved == false`, and this
 * test signs in as an admin, who is who the filter is offered to.
 */
const TABELA = "/eksploruj/tabela?visibility=private";

test.describe("Rozbicie wyniku", () => {
  test("says which models scored a person and whether anybody voted", async ({
    page,
  }) => {
    await page.goto(`/login?redirect=${encodeURIComponent(TABELA)}`);
    await waitForLoginFormHydrated(page);
    await page.locator("input#email").fill("admin@koryta.pl");
    await page.locator("input#password").fill("password123");
    await page.locator('button[type="submit"]').click({ force: true });
    await page.waitForURL("**/eksploruj/tabela**", { timeout: 15000 });

    await expect(page.locator(".v-main")).toBeVisible();
    await expect(page.locator(".v-data-table__progress")).not.toBeVisible({
      timeout: 15000,
    });

    const row = page.locator("tbody tr", { hasText: "Nowa Osoba Testowa" });
    await expect(row).toBeVisible({ timeout: 15000 });

    // The cell is a button only when there is something behind the number —
    // which is the whole assertion that the slot is live.
    const total = row.locator("button.vote-breakdown-total");
    await expect(total).toBeVisible();
    await expect(total).toContainText("3");

    await total.click();

    const card = page.locator(".vote-breakdown-card");
    await expect(card).toBeVisible();
    await expect(card).toContainText("Oceniona przez 2 modele");
    await expect(card).toContainText("Artykuły w bazie");
    await expect(card).toContainText("Sieć powiązań");
    // Only the best of the two counts towards the 3 in the cell.
    await expect(card).toContainText("tylko najwyższa ocena modelu (3)");
    await expect(card).toContainText("Nikt jeszcze nie głosował");
  });
});
