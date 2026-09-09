import { test, expect } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";

/** The facts a model attached to one person, on that person's own page.
 *
 * Two states, and the difference between them is the point. A signed in reader
 * gets the cards; a signed out one gets a count, a blurred placeholder and a
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

  // No cards, and — the part that matters — no fact text in the document at
  // all. A CSS filter hides nothing from view-source or from a crawler.
  await expect(section.locator(".extraction-card")).toHaveCount(0);
  expect(await page.content()).not.toContain("Partia Testowa");
});

test("a signed in reader gets the cards, two to a row", async ({ page }) => {
  test.setTimeout(120_000);

  await logIn(page, USERS.normal, PERSON);

  const section = page.locator("[data-testid='person-extractions']");
  const cards = section.locator(".extraction-card");
  await expect(cards).toHaveCount(2, { timeout: 30_000 });
  await expect(section).toContainText("Partia Testowa");

  // Side by side from md up, which is the layout this section exists in.
  await page.setViewportSize({ width: 1280, height: 900 });
  const first = await cards.nth(0).boundingBox();
  const second = await cards.nth(1).boundingBox();
  expect(second!.x).toBeGreaterThan(first!.x);
  expect(Math.abs(second!.y - first!.y)).toBeLessThan(5);

  // Under the graph, not above it.
  const graph = await page.locator("[data-testid='graph-panel']").boundingBox();
  expect((await section.boundingBox())!.y).toBeGreaterThan(graph!.y);

  // Both controls are single writes now. The flag always was; judging a fact
  // arrived here as `ExtractionQuickVerdict`, which writes once with
  // `castVoteOnce` and opens no Firestore listener - a subscription per card
  // is what had kept vote UI off a section that mounts every card at once.
  //
  // Either label, because both are that one control: `extraction_person_match`
  // runs first, flags `seed-open-party` and takes it back, and the taking back
  // is a trigger's job behind a 60s response cache. Pinning the unflagged
  // wording made this spec a clock - it passed only while the specs ahead of it
  // were slow enough for the cache to lapse, and started failing the moment
  // they were fixed and the suite got faster.
  await expect(
    cards.first().getByRole("button", {
      name: /To nie ta osoba|Zgłoszono złe dopasowanie/,
    }),
  ).toBeVisible();
  // One actions row per seeded card, and the three verdicts in it - this is
  // the whole of what "let me judge a fact where it stands" asked for.
  await expect(section.locator(".extraction-actions")).toHaveCount(2);
  await expect(
    // `exact`, because the role name match is a substring by default and
    // "Niepoprawny fakt" ends in this one.
    cards.first().getByRole("button", { name: "Poprawny fakt", exact: true }),
  ).toBeVisible();

  // The locked state must be gone once there is somebody to show them to.
  await expect(
    section.locator("[data-testid='person-extractions-locked']"),
  ).toHaveCount(0);
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
