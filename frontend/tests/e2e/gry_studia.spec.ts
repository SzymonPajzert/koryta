import { test, expect } from "@playwright/test";

/** "Po jakich studiach?" against the seeded emulator.
 *
 * The seed carries exactly two people the game can ask about - Ewa Dyplomowana
 * ("magister prawa") and Jerzy Budowlany ("tech.budowlany", which only resolves
 * because of the abbreviation folding in `educationNormalizedKey`) - each with
 * three CV entries, which is the minimum the pool requires. Which of the two is
 * today's puzzle depends on the date, so nothing here assumes one of them.
 *
 * WHY THE GUESSING IS TESTED THROUGH THE API. The board is checked in the
 * browser and the ranking is not. Driving the Vuetify autocomplete from
 * Playwright against the dev server is not reliable here: the field is server
 * rendered, so it is clickable before Vue attaches, and when vite fails to
 * serve `nuxt/dist/app/entry.js` mid-run - which it does intermittently, and
 * logs - the page never hydrates at all and the menu simply never opens. A
 * spec that fights that tests the dev server, not the game. The two requests
 * below are the whole contract a player exercises: what the board may show,
 * and what a guess comes back as.
 */
const ANSWERS = ["magister prawa", "technik budowlany"];
const HIDDEN = ["Ewa Dyplomowana", "Jerzy Budowlany", "Wodociągi Testowe"];

test.describe("Po jakich studiach?", () => {
  test("shows an anonymous CV with no name on it", async ({ page }) => {
    await page.goto("/gry/studia", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Anonimowe CV")).toBeVisible({
      timeout: 30_000,
    });
    await expect
      .poll(() => page.locator(".v-timeline-item").count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(3);

    // The whole game rests on the CV being anonymous until it is won: not the
    // person, and not the employer either - a company name is one search away
    // from the person, and the person's page prints the answer.
    const body = await page.locator("body").innerText();
    for (const secret of HIDDEN) expect(body).not.toContain(secret);
  });

  test("is listed as playable on the hub", async ({ page }) => {
    await page.goto("/gry", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("game-card-studia");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toHaveAttribute("href", "/gry/studia");
    await expect(card).not.toContainText("wkrótce");
  });

  test("serves a board that gives the answer away nowhere", async ({
    request,
  }) => {
    const puzzle = await (await request.get("/api/games/studia")).json();
    expect(puzzle.cv.length).toBeGreaterThanOrEqual(3);
    expect(puzzle.terms.length).toBeGreaterThan(600);
    expect(puzzle.vocabularySize).toBe(puzzle.terms.length);

    const payload = JSON.stringify(puzzle);
    for (const secret of HIDDEN) expect(payload).not.toContain(secret);
    // The terms are shipped; their ORDER against the target is the answer, so
    // the list has to be sorted by name and not by closeness.
    expect(puzzle.terms).toEqual(
      [...puzzle.terms].sort((a: string, b: string) =>
        a.localeCompare(b, "pl"),
      ),
    );
  });

  test("answers a guess with a rank, and names the person only on a win", async ({
    request,
  }) => {
    const guess = async (term: string) =>
      (
        await request.get("/api/games/studia/guess", { params: { term } })
      ).json();

    const cold = await guess("ksiądz katolicki");
    expect(cold.rank).toBeGreaterThan(1);
    expect(cold.rank).toBeLessThanOrEqual(cold.total);
    expect(cold.solved).toBe(false);
    // Until it is won, the response says nothing about who this is.
    expect(cold.personName).toBeUndefined();
    expect(cold.temperature).toBeTruthy();

    const won = [];
    for (const answer of ANSWERS) {
      const result = await guess(answer);
      if (result.solved) won.push(result);
    }
    expect(won).toHaveLength(1);
    expect(won[0].rank).toBe(1);
    expect(won[0].temperature).toBe("trafione");
    // Named exactly once the day is over, with the id the reveal links to.
    expect(HIDDEN).toContain(won[0].personName);
    expect(won[0].personId).toBeTruthy();
  });

  test("ranks a near miss above a wrong field", async ({ request }) => {
    const rank = async (term: string) =>
      (
        await (
          await request.get("/api/games/studia/guess", { params: { term } })
        ).json()
      ).rank as number;

    // Whichever of the two people today is, one of these pairs is the near
    // miss and the other the wrong field - so the assertion holds either way.
    const [law, build, priest] = await Promise.all([
      rank("radca prawny"),
      rank("technik drogowy"),
      rank("imam"),
    ]);
    expect(Math.min(law, build)).toBeLessThan(priest);
  });
});
