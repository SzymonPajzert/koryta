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
    // An unchecked entry opens with its instructions showing.
    await expect(card).toContainText(NEWEST.steps[0]!);

    const feedback = `nie działa ${Date.now()}`;
    await card.getByLabel("Uwagi", { exact: false }).fill(feedback);
    await card.getByRole("button", { name: "Coś nie działa" }).click();

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
    // Longer than the specs around it: this one writes a report, triages it in
    // a second browser and then comes back to the first.
    test.setTimeout(240_000);

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
    // A settled entry keeps its instructions folded away and the note field
    // with them, while an unchecked one opens on them - so this unfolds only
    // when it needs to, rather than toggling whatever state it found.
    const note = card.getByLabel("Uwagi", { exact: false });
    if (!(await note.isVisible())) {
      await card.getByRole("button", { name: "Jak sprawdzić" }).click();
    }

    const feedback = `zgłoszenie z QA ${Date.now()}`;
    await note.fill(feedback);
    await card.getByRole("button", { name: "Coś nie działa" }).click();
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

      const report = adminPage
        .locator(".v-card", { hasText: feedback })
        .first();
      await expect(report).toBeVisible({ timeout: 60_000 });
      await expect(report).toContainText(`QA: ${SECOND.title}`);
      await expect(report).toContainText("Coś nie działa");

      // And the other direction, which is what /qa had no way of knowing:
      // closing the report here has to reach the person who wrote it. The
      // select is opened by clicking the whole `.v-select` - the input inside
      // it does not carry the click - and the option comes from the overlay,
      // which is portalled to the body rather than into the card.
      await report.locator('.v-select:has-text("Status")').click();
      await adminPage.getByRole("option", { name: "Załatwione" }).click();
      await expect(report).toHaveClass(/feedback-settled/, { timeout: 30_000 });
    } finally {
      await adminContext.close();
    }

    // A reload rather than waiting on the page: the resolutions are read once
    // per session, and nothing pushes an admin's decision to an open tab.
    await page.reload();
    await expect(page.locator('[data-qa-loaded="true"]')).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("button", { name: "Problemy" }).click();

    await expect(card).toContainText("Admin: Załatwione", { timeout: 60_000 });
    await expect(card).toContainText("Sprawdź, czy faktycznie działa");

    // Taking the team's word for it drops the entry out of "Problemy" - back
    // to needing a look, not to "Sprawdzone", because nobody has re-checked it.
    await card.getByRole("button", { name: "Przyjmuję" }).click();
    await expect(
      page.getByText("Przyjęte - wpis wraca do sprawdzenia"),
    ).toBeVisible({ timeout: 30_000 });
    await expect(card).toBeHidden({ timeout: 30_000 });

    await page.getByRole("button", { name: "Do sprawdzenia" }).click();
    await expect(card).toContainText("czeka na Twoje ponowne sprawdzenie");
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
