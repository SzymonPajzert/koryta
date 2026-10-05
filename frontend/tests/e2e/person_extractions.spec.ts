import { test, expect } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";

/** The facts a model attached to one person, on that person's own page.
 *
 * Two states, and the difference between them is the point. A signed in reader
 * gets the facts; a signed out one gets a count, a blurred placeholder and a
 * way in. The blur is decoration - what actually withholds the facts is that
 * the page never asks for them - so the logged out test checks the html rather
 * than what is on screen.
 *
 * `anna-nowak-3` is seeded with two matched facts (scripts/extractions.json),
 * and `jan-kowalski-1` with none.
 */

const PERSON = "/osoba/anna-nowak-3";

test("a signed out reader is told how many facts there are, and nothing else", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await page.goto(PERSON);

  const section = page.locator("[data-testid='person-extractions']");
  await expect(section).toBeVisible({ timeout: 30_000 });
  await expect(
    section.locator("[data-testid='person-extractions-count']"),
  ).toContainText("2 fakty");
  await expect(
    section.locator("[data-testid='person-extractions-locked']"),
  ).toBeVisible();
  await expect(
    section.getByRole("link", { name: /Zaloguj się lub załóż konto/ }),
  ).toBeVisible();

  // No lines, and — the part that matters — no fact text in the document at
  // all. A CSS filter hides nothing from view-source or from a crawler.
  await expect(section.getByTestId("person-fact")).toHaveCount(0);
  expect(await page.content()).not.toContain("Partia Testowa");
});

test("a signed in reader gets a line per fact, which opens to the rest", async ({
  page,
}) => {
  // „fakty jako rozkładalne elementy - czyli dopiero jak użytkownik je
  // kliknie, to pojawia się cytat”: closed, a line says what the fact is and
  // where it is from; the quote and every control are behind a click.
  test.setTimeout(120_000);

  await logIn(page, USERS.normal, PERSON);

  const section = page.locator("[data-testid='person-extractions']");
  const lines = section.getByTestId("person-fact");
  await expect(lines).toHaveCount(2, { timeout: 30_000 });
  await expect(section).toContainText("Partia Testowa");

  // Under the graph, not above it.
  const graph = await page.locator("[data-testid='graph-panel']").boundingBox();
  expect((await section.boundingBox())!.y).toBeGreaterThan(graph!.y);

  // Closed: no quote, no buttons.
  const job = lines.filter({ hasText: "Spolka Nieoceniona" });
  await expect(job).toContainText("czlonkini rady nadzorczej");
  await expect(job).not.toContainText("Fakt czekajacy na ocene recenzenta.");
  await expect(section.getByTestId("verdict-buttons")).toHaveCount(0);

  await job.locator("[data-row-toggle]").click();
  await expect(job).toContainText("Fakt czekajacy na ocene recenzenta.");

  // Both controls are single writes. The flag always was; judging a fact
  // arrived here as `ExtractionQuickVerdict`, which writes once with
  // `castVoteOnce` and opens no Firestore listener.
  //
  // Either label, because both are that one control: `extraction_person_match`
  // runs first, flags `seed-open-party` and takes it back, and the taking back
  // is a trigger's job behind a 60s response cache. Pinning the unflagged
  // wording made this spec a clock - it passed only while the specs ahead of it
  // were slow enough for the cache to lapse, and started failing the moment
  // they were fixed and the suite got faster.
  await expect(
    job.getByRole("button", {
      name: /To nie ta osoba|Zgłoszono złe dopasowanie/,
    }),
  ).toBeVisible();
  // The three verdicts - the whole of what "let me judge a fact where it
  // stands" asked for - in the line that was opened, and only there.
  await expect(section.getByTestId("verdict-buttons")).toHaveCount(1);
  await expect(
    // `exact`, because the role name match is a substring by default and
    // "Niepoprawny fakt" ends in this one.
    job.getByRole("button", { name: "Poprawny fakt", exact: true }),
  ).toBeVisible();

  // The locked state must be gone once there is somebody to show them to.
  await expect(
    section.locator("[data-testid='person-extractions-locked']"),
  ).toHaveCount(0);
});

test("a fact that can become a relation offers to, where it stands", async ({
  page,
}) => {
  // „Brakuje chyba jeszcze promocji do krawędzi” - the queue and the article's
  // page could turn a fact into a relation, the person's own page could not.
  // The dialog is opened and cancelled rather than sent: a relation written
  // here would be a new draft on Anna Nowak's page, which half the suite
  // reads.
  test.setTimeout(120_000);

  await logIn(page, USERS.normal, PERSON);

  const section = page.locator("[data-testid='person-extractions']");
  const lines = section.getByTestId("person-fact");
  await expect(lines).toHaveCount(2, { timeout: 30_000 });

  // The employment can become one; a party membership has no relation to
  // become - a party is not a node.
  const job = lines.filter({ hasText: "Spolka Nieoceniona" });
  const party = lines.filter({ hasText: "Partia Testowa" });
  await job.locator("[data-row-toggle]").click();
  await party.locator("[data-row-toggle]").click();
  await expect(job.getByTestId("extraction-promote")).toBeVisible();
  await expect(party.getByTestId("verdict-buttons")).toBeVisible();
  await expect(party.getByTestId("extraction-promote")).toHaveCount(0);

  await job.getByTestId("extraction-promote").click();
  const dialog = page.getByTestId("promote-fact-dialog");
  await expect(dialog).toBeVisible();
  // The subject is the person whose page this is, and the far end is asked
  // for with what the article called it.
  await expect(dialog).toContainText("Anna Nowak");
  await expect(dialog).toContainText("Spolka Nieoceniona");
  await dialog.getByRole("button", { name: "Anuluj" }).click();
  await expect(dialog).toBeHidden();
});

test("a person nobody wrote about gets no section either way", async ({
  page,
}) => {
  test.setTimeout(120_000);

  await page.goto("/osoba/jan-kowalski-1");
  await expect(page.locator("[data-testid='graph-panel']")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("[data-testid='person-extractions']")).toHaveCount(
    0,
  );

  await logIn(page, USERS.normal, "/osoba/jan-kowalski-1");
  await expect(page.locator("[data-testid='graph-panel']")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("[data-testid='person-extractions']")).toHaveCount(
    0,
  );
});
