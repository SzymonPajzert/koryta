import { test, expect } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";
import { QA_ITEMS } from "../../shared/qa";

/** The newest entry is the one the page opens on, whatever it happens to be. */
const NEWEST = QA_ITEMS[0]!;
/** A second entry, for the spec that must not touch the one above. Both specs
 * sign in as the same seeded account and run in parallel, so two verdicts on
 * one entry would overwrite each other's note. */
const SECOND = QA_ITEMS[1]!;

test.describe("QA changelog", () => {
  test("a contributor checks a change and reports what is wrong", async ({
    page,
  }) => {
    test.setTimeout(180_000); // Logs in, then writes to firestore

    // Lands straight on /qa, so the spec does not race a second navigation.
    await logIn(page, undefined, "/qa");

    const card = page.locator(`[data-qa-item="${NEWEST.id}"]`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText(NEWEST.title);
    // One line until it is opened; open, the instructions are there.
    await expect(card).not.toContainText(NEWEST.steps[0]!);
    await card.locator("[data-row-toggle]").click();
    await expect(card).toContainText(NEWEST.steps[0]!);

    const feedback = `nie działa ${Date.now()}`;
    await card.getByLabel("Uwagi", { exact: false }).fill(feedback);
    // Exact: the line is a button too, and it names the verdict already given
    // - "Coś nie działa", after an earlier run against the same emulator.
    await card
      .getByRole("button", { name: "Coś nie działa", exact: true })
      .click();

    await expect(
      page.getByText("Zgłoszone - problem trafił do zespołu"),
    ).toBeVisible({ timeout: 30_000 });

    // Reported problems leave the default list and turn up under "Problemy".
    await expect(card).toBeHidden({ timeout: 30_000 });
    await page.getByRole("button", { name: "Problemy" }).click();
    await expect(card).toBeVisible();

    // The verdict is stored, not just held on the page. Reading it back waits
    // on firebase restoring the session, and until that lands the filter
    // buttons are markup with no listeners on them - a click on one would be
    // dropped and the page would sit on the default filter forever.
    await page.reload();
    await expect(page.locator('[data-qa-loaded="true"]')).toBeVisible({
      timeout: 60_000,
    });

    await page.getByRole("button", { name: "Problemy" }).click();
    // A reload closes every row again.
    await card.locator("[data-row-toggle]").click();
    await expect(card).toContainText("Twoja ocena: Coś nie działa", {
      timeout: 60_000,
    });
    // By label, not by tag: `auto-grow` renders a second, hidden textarea to
    // measure against, and a bare tag selector matches both.
    await expect(card.getByLabel("Uwagi", { exact: false })).toHaveValue(
      feedback,
    );
  });

  test("a reported problem reaches the same queue as the Zgłoś button", async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);

    await logIn(page, undefined, "/qa");

    // "Wszystkie", because a previous run against the same emulator may have
    // moved this entry out of "Do sprawdzenia" for this account. Waiting for
    // the verdicts first: until they land the filter buttons are markup with
    // no listeners, and the click is dropped.
    await expect(page.locator('[data-qa-loaded="true"]')).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("button", { name: "Wszystkie" }).click();

    const card = page.locator(`[data-qa-item="${SECOND.id}"]`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    // Every row starts as one line, whatever its state; the note field is in
    // the open one.
    await card.locator("[data-row-toggle]").click();
    const note = card.getByLabel("Uwagi", { exact: false });

    const feedback = `zgłoszenie z QA ${Date.now()}`;
    await note.fill(feedback);
    await card
      .getByRole("button", { name: "Coś nie działa", exact: true })
      .click();
    await expect(
      page.getByText("Zgłoszone - problem trafił do zespołu"),
    ).toBeVisible({ timeout: 30_000 });

    // The point of the whole thing: a verdict left on a changelog entry is
    // feedback, and turns up where feedback turns up - carrying the entry it
    // was written about.
    //
    // In its own context rather than by signing in again on this page:
    // firebase keeps the session in IndexedDB, and every other spec here logs
    // in once, into a browser that was not signed in as somebody else first.
    const adminContext = await browser.newContext();
    try {
      const adminPage = await adminContext.newPage();
      await logIn(adminPage, USERS.admin, "/admin/opinie");

      // Found by its message, which is on the line; the verdict is in the
      // open row.
      const report = adminPage
        .locator("[data-feedback-id]", { hasText: feedback })
        .first();
      await expect(report).toBeVisible({ timeout: 60_000 });
      await report.locator("[data-row-toggle]").click();
      await expect(report).toContainText(`QA: ${SECOND.title}`);
      await expect(report.locator("[data-row-panel]")).toContainText(
        "Coś nie działa",
      );
    } finally {
      await adminContext.close();
    }
  });

  test("QA is reached from the admin panel, not from the toolbar", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await logIn(page, USERS.admin, "/admin");

    // The panel is the one place that links to the changelog now.
    await expect(page.locator('a[href="/qa"]').first()).toBeVisible({
      timeout: 30_000,
    });

    // The contributor toolbar used to carry a QA button with a badge that
    // turned red for any reported problem, on every page of the site. Both are
    // gone deliberately, so a link reappearing there is a regression.
    await expect(page.locator('.user-toolbar a[href="/qa"]')).toHaveCount(0);
  });
});
