import { test, expect } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";
import { badges } from "../../shared/badges";

/** Odznaki on a person's page: who may see which badge, and what a click does.
 *
 * The feature is one rule - `visibleBadges` (shared/badges.ts) - applied to two
 * audiences, and everything that can go wrong with it goes wrong across the
 * boundary between them: a proposal nobody has seconded leaking to a logged out
 * reader, or a badge three people agreed on failing to reach one. A component
 * test cannot see that boundary, because both halves are decided by data that
 * has travelled through `/api/nodes/[id]` - and the two branches of that
 * endpoint (`latest=true` for signed-in readers, the stored document for
 * everybody else) are exactly where `stats.badges` was missing until the
 * foundation change put it on both.
 *
 * Two seeded people, chosen in scripts/seed-emulator.ts for having no
 * employment at all, so neither can turn up in the home feed and put a chip
 * into a visual baseline:
 *
 *   - `piotr-wisniewski-4` - three different uids voted „Społecznik”, the one
 *     badge with `requiresApproval: false`, so it is public: a chip for
 *     everybody, a crawler included.
 *   - `krzysztof-wojcik-5` - one uid voted „Omnibus”, which is the proposal
 *     state: a chip for signed-in readers and nothing whatsoever for anybody
 *     else.
 *
 * Serial, and it matters. All three tests read or write the same two people,
 * and the first writes a vote into `votes/5_<uid>` - under `fullyParallel`
 * Playwright would spread them across workers and the logged out tests could
 * observe the page mid-vote. It also keeps the run repeatable against an
 * emulator that was not re-seeded: the vote is withdrawn again before the file
 * ends, and the first test normalises whatever an earlier run left behind
 * rather than assuming a clean document.
 */

const PROPOSAL_PERSON = "/osoba/krzysztof-wojcik-5";
const PUBLIC_PERSON = "/osoba/piotr-wisniewski-4";

test.describe.configure({ mode: "serial" });

test.describe("Odznaki osób", () => {
  test("a signed-in reader proposes a badge, and takes it back", async ({
    page,
  }) => {
    test.setTimeout(180_000); // Logs in, then writes to firestore twice.

    await logIn(page, USERS.normal, PROPOSAL_PERSON);

    const section = page.locator("[data-testid='person-badges']");
    await expect(section).toBeVisible({ timeout: 30_000 });

    // The whole catalogue, not just the badges somebody has proposed: the
    // section is a menu, and a reader who cannot see „Zmiana barw” cannot be
    // the first to propose it.
    await expect(section.locator("[data-testid^='badge-row-']")).toHaveCount(5);
    await expect(
      section.locator("[data-testid='badge-disclaimer']"),
    ).toContainText("Odznaki to oceny czytelników");

    // The seeded proposal, which is the whole point of a state between „nobody
    // said this” and „the site says this”: one reader proposed „Omnibus” on
    // this person and a signed-in reader gets the chip, outlined rather than
    // filled. The logged out test below checks the other half.
    const omnibusChip = page.locator("[data-testid='badge-chip-omnibus']");
    await expect(omnibusChip).toBeVisible({ timeout: 30_000 });
    await expect(omnibusChip).toHaveClass(/v-chip--variant-outlined/);

    const up = section.locator("[data-testid='badge-vote-up-spolecznik']");
    const status = section.locator("[data-testid='badge-status-spolecznik']");
    const tally = section.locator("[data-testid='badge-tally-spolecznik']");

    // An earlier run of this file on the same emulator would have left the vote
    // standing, and the click below would then withdraw it instead of casting
    // it - the spec would be measuring how many times the emulator has been
    // used. `scripts/seed-emulator.ts` clears `votes`, so this only matters
    // when the suite is re-run without re-seeding, which locally is the normal
    // way to run it.
    await expect(up).toBeEnabled({ timeout: 30_000 });
    if ((await up.getAttribute("aria-pressed")) === "true") {
      await up.click();
      await expect(up).not.toHaveAttribute("aria-pressed", "true", {
        timeout: 30_000,
      });
    }
    await expect(status).toHaveText("Nikt jeszcze nie zgłosił");

    await up.click();

    // The counter moves on the click rather than on the next page load, and
    // that is a deliberate piece of the design rather than an optimisation:
    // `/api/nodes/[id]` is served from a six-hour cache to signed-in readers
    // too (`eventIsAuthenticated` is stubbed to `false`,
    // server/utils/handlers.ts:5-7), so the endpoint cannot report this vote
    // back in time. `BadgePersonSection` adds the reader's own clicks to
    // whatever the endpoint said.
    await expect(up).toHaveAttribute("aria-pressed", "true", {
      timeout: 30_000,
    });
    await expect(tally).toHaveText("1 za / 0 przeciw");
    // Net, and spelled out in people rather than as „1/3”.
    await expect(status).toHaveText("Propozycja — brakuje jeszcze 2 głosów");

    await page.reload();
    await expect(section).toBeVisible({ timeout: 30_000 });

    // The vote survived, and so did the number beside it. The button alone
    // would have been true before the tallies got their own endpoint: the vote
    // document is read live from Firestore by vuefire, so the arrows were
    // always right, while `/api/nodes/[id]` served the counter from a six-hour
    // entry and reported „0 za” to the very reader who had just voted. The
    // optimistic overlay covered that until the page was reloaded, and then
    // the reader watched their own vote disappear.
    //
    // This is the assertion that pins the fix, so it is worth saying what it
    // would take to break it without the arrows noticing: serving the section
    // from the node payload again, or caching `/api/nodes/[id]/badges`.
    await expect(up).toHaveAttribute("aria-pressed", "true", {
      timeout: 30_000,
    });
    await expect(tally).toHaveText("1 za / 0 przeciw");

    // A second click on the same arrow is a withdrawal, not a second vote.
    await expect(up).toBeEnabled({ timeout: 30_000 });
    await up.click();
    await expect(up).not.toHaveAttribute("aria-pressed", "true", {
      timeout: 30_000,
    });
    await expect(status).toHaveText("Nikt jeszcze nie zgłosił");

    // And the withdrawal is stored - an explicit 0 in the document, not a state
    // the page is holding on to. Without this the file would also leave a vote
    // behind for its own next run.
    await page.reload();
    await expect(section).toBeVisible({ timeout: 30_000 });
    await expect(up).not.toHaveAttribute("aria-pressed", "true", {
      timeout: 30_000,
    });
  });

  test("a logged out reader sees neither the section nor a proposal", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await page.goto(PROPOSAL_PERSON);
    // The graph is the last thing this page draws, so waiting for it is what
    // separates „hydrated and the badges are absent” from „not rendered yet”.
    await expect(page.locator("[data-testid='graph-panel']")).toBeVisible({
      timeout: 30_000,
    });

    // No voting section at all. The catalogue characterises a living person -
    // „W czepku urodzony”, „Kot na cztery nogi” - and offering those five
    // sentences to an anonymous visitor is the thing the sign-in gate is for.
    await expect(page.locator("[data-testid='person-badges']")).toHaveCount(0);

    // And no chip for the badge one reader proposed. Checked in the html
    // rather than on screen: a rule that only hides things from view still
    // publishes them to view-source and to a crawler, which for an unseconded
    // claim about a named person is the whole risk.
    //
    // Titles, not ids: the bare `omnibus` key *is* in the payload, because
    // `stats.badges` travels with the document a logged out reader is entitled
    // to (it is what draws a public chip). The tally is public arithmetic; the
    // sentence it stands for is what must not be here.
    //
    // Every title in the catalogue rather than only the proposed one, because
    // the two ways this leaks are not the chip. A template comment quoting a
    // title survives dev SSR (a production build strips it), and a comment
    // before a component's root element is emitted even when the component
    // draws nothing - so the first version of this page published two titles
    // that nobody had proposed, on every person, and an assertion naming one
    // badge went green against `dev:build` while red against `dev:local`.
    await expect(
      page.locator("[data-testid='badge-chip-omnibus']"),
    ).toHaveCount(0);
    const html = await page.content();
    for (const badge of badges) {
      expect(
        html,
        `„${badge.title}” leaked to a logged out page`,
      ).not.toContain(badge.title);
    }
  });

  test("three readers put the chip in front of everybody", async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto(PUBLIC_PERSON);

    const chip = page.locator("[data-testid='badge-chip-spolecznik']");
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await expect(chip).toContainText("Społecznik");
    // Filled rather than outlined: the wash is what separates „the site stands
    // behind this” from „readers are still arguing about it”, and it has to
    // survive on a touch screen, where the tooltip never opens.
    await expect(chip).toHaveClass(/v-chip--variant-flat/);

    // Still no voting section - a public badge is something to read, not an
    // invitation to join in without an account.
    await expect(page.locator("[data-testid='person-badges']")).toHaveCount(0);

    // Badges never reach the metadata. A chip is the opinion of three readers;
    // `<title>` and `og:description` are what the site says about a person in
    // search results and in a link preview, and a reader's vote may not write
    // there (shared/badges.ts, and `useSeoMeta` on this page names neither).
    expect(await page.title()).not.toContain("Społecznik");
    const description = await page
      .locator('meta[property="og:description"]')
      .getAttribute("content");
    expect(description ?? "").not.toContain("Społecznik");
  });
});
