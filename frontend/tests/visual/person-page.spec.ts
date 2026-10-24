import type { Page, TestInfo } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import {
  answerEntityPage,
  graphSettled,
  openInApp,
  shootWholePage,
} from "./entityPage";
import { personPage } from "./fixtures/personPage";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** A person's page as the redesign left it (approved 2026-10-24), whole, signed
 * out and signed in.
 *
 * What nothing else here photographs: the header unboxed, with one line of
 * facts under the name and one row of actions, the admin's tools on a line of
 * their own; the history as a ledger, in „Osoby”, „Obecnie”, „Zakończone” and
 * „Bez dat”, its dates in a column and a phone's ended posts in years; a
 * handover drawn as the row a company's page draws too, with a party change in
 * it; and the one quiet line that stands for the handovers when every name in
 * them is withheld. The other specs on a person's page - person-facts,
 * notes, relation-draft, relation-sources, two-places - each photograph one
 * section of a seeded person, and the seed's people have none of this.
 *
 * Halina Przykładowa is ./fixtures/personPage.ts, answered by route handlers -
 * see ./entityPage.ts for what they cover and why the page has to be reached
 * from inside the app. Her dates are counted from ./clock.ts. */

const PERSON = { tag: pageTag("[seoType]/[slug]") };

/** What both captures share: the header, every fact on its line, and the
 * ledger with a row in each group. */
async function headerAndLedger(page: Page, testInfo: TestInfo) {
  // Scoped to the header: until the page has drawn, the h1 on screen is the
  // one of the page the navigation started from.
  await expect(
    page.locator(".entity-header").getByRole("heading", { level: 1 }),
  ).toHaveText("Halina Przykładowa", { timeout: 30_000 });

  const facts = page.getByTestId("person-facts");
  await expect(facts).toContainText("ur. 14 lutego 1976");
  await expect(facts).toContainText(
    "wykształcenie: magister inżynierii środowiska",
  );
  for (const site of ["Wikipedia", "Rejestr.io", "Kto ma co"]) {
    await expect(facts.getByRole("link", { name: site })).toBeVisible();
  }

  // Four lines of the bio and „Pokaż więcej” on a phone; the whole bio, and
  // no button, wider than one.
  await expect(page.getByTestId("person-bio")).toBeVisible();
  const more = page.getByTestId("person-bio-more");
  if (testInfo.project.name === "visual-mobile") {
    await expect(more).toBeVisible();
  } else {
    await expect(more).toBeHidden();
  }

  // The vote is drawn in the browser only, after the rest of the row: its
  // pill and the two arrows in it.
  const actions = page.getByTestId("person-actions");
  await expect(actions.getByTestId("person-propose-change")).toBeVisible();
  await expect(actions.locator(".rounded-pill .v-btn")).toHaveCount(2);

  const history = page.getByTestId("relations-history");
  for (const group of ["people", "current", "ended", "undated"]) {
    await expect(history.getByTestId(`history-group-${group}`)).toBeVisible({
      timeout: 30_000,
    });
  }
  await expect(history.getByTestId("history-box-people")).toContainText(
    "Jacek Testowy",
  );
  // A candidacy prints its year, and the „Wybrany” it won.
  await expect(history.getByTestId("edge-period-vishalinarada")).toContainText(
    "2018",
  );
  await expect(history.getByTestId("edge-elected-vishalinarada")).toBeVisible();
  await expect(history.getByTestId("history-box-undated")).toContainText(
    "Prokurent",
  );
  // Cited to one article, so the count is there for anybody to open.
  await expect(
    history.getByTestId("edge-sources-open-vishalinapwik"),
  ).toContainText("1");

  await graphSettled(page, testInfo);
}

test("osoba-strona", PERSON, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await freezeClock(page);
  await answerEntityPage(page, personPage);
  await openInApp(page, personPage.url);

  await headerAndLedger(page, testInfo);

  // Both of her handovers name somebody whose page is a draft, so a reader
  // who is not signed in gets them counted in one line under the history,
  // and no section.
  await expect(page.getByTestId("person-successions-note")).toContainText(
    "Zmiany na stanowiskach: 2 pominięte",
    { timeout: 30_000 },
  );
  await expect(page.getByTestId("person-successions")).toHaveCount(0);
  await expect(page.locator('[data-testid^="edge-predecessor-"]')).toHaveCount(
    0,
  );
  // Nothing of an editor's on the page.
  await expect(page.getByTestId("admin-revisions-link")).toHaveCount(0);
  await expect(page.getByTestId("add-relation-employment")).toHaveCount(0);

  await shootWholePage(page, "osoba-strona.png");

  await expectFitsThePhone(page, testInfo);
});

test("osoba-strona-zalogowany", PERSON, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await freezeClock(page);
  await answerEntityPage(page, personPage);
  // As the admin, whose row of actions is the fullest: every tool an admin
  // has, on the line under the reader's two.
  await logIn(page, USERS.admin, personPage.url);

  await headerAndLedger(page, testInfo);

  const actions = page.getByTestId("person-actions");
  for (const tool of [
    "admin-explore-link",
    "admin-revisions-link",
    "admin-merge-node",
    "admin-split-node",
    "job-request-open",
  ]) {
    await expect(actions.getByTestId(tool)).toBeVisible();
  }
  const history = page.getByTestId("relations-history");
  await expect(history.getByTestId("add-relation-employment")).toBeVisible();
  await expect(history.getByTestId("edge-edit-vishalinapwik")).toBeVisible();

  // Signed in, the names: on her row, who sat there before her...
  await expect(
    history.getByTestId("edge-predecessor-vishalinapwik"),
  ).toContainText("Grzegorz Próbny", { timeout: 30_000 });

  // ...and the section, with a card for each handover: the seat she took,
  // from PiS to PO, and the one she left on a day two seats of that board
  // changed hands.
  const changes = page.getByTestId("person-successions");
  await expect(page.getByTestId("person-successions-count")).toHaveText(
    "2 zmiany",
  );
  const took = changes.getByTestId("succession-predecessor");
  await expect(took.getByTestId("handover-left")).toContainText(
    "Grzegorz Próbny",
  );
  await expect(took.getByTestId("handover-right")).toContainText(
    "Halina Przykładowa",
  );
  await expect(took.getByTestId("handover-gap")).toHaveText(
    "po 1 dniu przerwy",
  );
  await expect(took.getByTestId("handover-party-change")).toBeVisible();
  const left = changes.getByTestId("succession-successor");
  await expect(left.getByTestId("handover-right")).toContainText(
    "Wiesław Przykładny",
  );
  await expect(left.getByTestId("handover-party-change")).toHaveCount(0);
  await expect(left.getByTestId("succession-batch-note")).toBeVisible();
  await expect(page.getByTestId("person-successions-note")).toHaveCount(0);

  // What a signed in reader has below the graph: the notes, empty and asking,
  // and the discussion.
  await expect(page.getByTestId("note-editor")).toContainText(
    "Wiesz więcej na temat tej osoby?",
    { timeout: 30_000 },
  );
  await expect(page.getByText("Brak komentarzy.")).toBeVisible({
    timeout: 30_000,
  });

  await shootWholePage(page, "osoba-strona-zalogowany.png");

  await expectFitsThePhone(page, testInfo);
});
