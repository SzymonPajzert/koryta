import { test, expect, type Page } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";

/** Orlen, seeded as node 2 with an approved revision, so its page is live. */
const COMPANY_URL = "/instytucja/orlen-2";
/** Wojewódzki Zakład Testowy, which nothing in the suite proposes changes to. */
const UNTOUCHED_COMPANY_URL = "/instytucja/wojewodzki-zaklad-testowy-sukspolka";

/** Every proposal the card lists, however many there are. Counted rather than
 * asserted at one: the emulator keeps what an earlier attempt wrote, so a
 * retry would otherwise be measuring the previous run. */
const proposalRows = (page: Page) =>
  page.locator('[data-testid^="node-proposal-preview-"]');

/** Fill in "Zaproponuj zmianę" with `content` and send it.
 *
 * The click is retried because the button is in the markup before Vue has
 * attached its listener, and a click in that window is silently dropped - the
 * same race `revisions_edit` handles.
 */
async function propose(page: Page, content: string) {
  const button = page.getByRole("button", { name: "Zaproponuj zmianę" });
  await expect(button).toBeVisible({ timeout: 30_000 });
  const dialog = page.locator('.v-dialog:has-text("Zaproponuj zmianę")');
  await expect(async () => {
    if (await dialog.isVisible()) return;
    await button.click();
    await expect(dialog).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 20_000 });

  await dialog.getByLabel("Treść (opcjonalnie)").fill(content);
  await dialog.getByRole("button", { name: "Zaproponuj", exact: true }).click();
  await expect(page.getByTestId("propose-confirmation")).toBeVisible({
    timeout: 30_000,
  });
}

test.describe("What a company page says about a change you proposed", () => {
  test("shows the proposal, keeps showing it, and refuses to file it twice", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    // Unique per run: the second half is about the *same* text twice being one
    // proposal, which only means anything if the first send is genuinely first.
    const content = `Opis zgłoszony przez test ${Date.now()}`;

    await logIn(page, USERS.normal, COMPANY_URL);
    await expect(page.getByText("Orlen").first()).toBeVisible({
      timeout: 30_000,
    });
    const before = await proposalRows(page).count();

    await propose(page, content);
    await expect(page.getByTestId("propose-confirmation")).toContainText(
      "Zaproponowano zmianę",
    );

    // The card this change is for. Before it, the page went on showing the
    // stored version and said nothing about the proposal at all.
    await expect(page.getByTestId("node-proposals")).toBeVisible({
      timeout: 30_000,
    });
    await expect(proposalRows(page)).toHaveCount(before + 1);

    // And it survives a reload, which is where a reader coming back to check
    // previously found no trace of what they had sent.
    await page.reload();
    await expect(page.getByTestId("node-proposals")).toBeVisible({
      timeout: 30_000,
    });
    await expect(proposalRows(page)).toHaveCount(before + 1);
    await expect(page.getByTestId("node-proposals")).toContainText(
      "czeka na redakcję",
    );

    // Sending the same correction again lands on the one already waiting.
    await propose(page, content);
    await expect(page.getByTestId("propose-confirmation")).toContainText(
      "już zgłosiłeś",
    );
    await expect(proposalRows(page)).toHaveCount(before + 1);
  });

  test("the preview link renders the page as the proposal would leave it", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const content = `Podgląd testowy ${Date.now()}`;

    await logIn(page, USERS.normal, COMPANY_URL);
    await expect(page.getByText("Orlen").first()).toBeVisible({
      timeout: 30_000,
    });
    await propose(page, content);

    await proposalRows(page).first().click();
    await expect(page).toHaveURL(/revisionId=/);
    await expect(
      page.getByText("Wyświetlasz podgląd zaproponowanej zmiany"),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("a reader who has proposed nothing here sees no card", async ({
    page,
  }) => {
    // Every company page mounts it, so it has to be invisible on the ones
    // nobody has touched.
    await logIn(page, USERS.normal, UNTOUCHED_COMPANY_URL);
    await expect(
      page.getByText("Wojewódzki Zakład Testowy").first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("node-proposals")).toHaveCount(0);
  });
});

test.describe("Admin shortcut from a company page", () => {
  test("an admin reaches the company's revision list from the page", async ({
    page,
  }) => {
    // The person page has had this since the shortcut shipped; a company's
    // revision list was reachable only by typing the node id into a url.
    await logIn(page, USERS.admin, COMPANY_URL);

    const link = page.getByTestId("admin-revisions-link");
    await expect(link).toBeVisible({ timeout: 30_000 });
    await expect(link).toHaveAttribute("href", "/admin/rewizje/2");
    await link.click();
    await expect(page).toHaveURL(/\/admin\/rewizje\/2$/);
    await expect(
      page.getByRole("heading", { name: /Szczegóły rewizji/ }),
    ).toBeVisible();
  });

  test("a signed in reader without the claim never sees it", async ({
    page,
  }) => {
    await logIn(page, USERS.normal, COMPANY_URL);

    await expect(page.getByText("Orlen").first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId("admin-revisions-link")).toHaveCount(0);
  });
});
