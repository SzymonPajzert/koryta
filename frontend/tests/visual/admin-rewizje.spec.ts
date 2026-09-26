import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import { readyForFullPage } from "./fullPage";
import {
  pendingEdgeRevisions,
  revisedNodes,
  revisionQueue,
} from "./fixtures/revisionHub";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** /admin/rewizje - the review queue, the pending edge changes and the entries
 * with a history, on one page - and one entry's history, as an admin works
 * through them.
 *
 * Both pages are rendered in the browser only (`ssr: false` on /admin/**), so
 * every request they make can be answered from a fixture and every „N dni
 * temu” is counted from the frozen clock. The hub is answered from
 * ./fixtures/revisionHub.ts in full; the entry page reads the seed, whose
 * Krzysztof Wójcik (node 5) has one approved revision and one pending, and
 * which nothing else in this suite edits. */

const HUB = { tag: pageTag("admin/rewizje/index") };
const ENTRY = { tag: pageTag("admin/rewizje/[id]") };

async function answerHub(page: Page) {
  await page.route("**/api/revisions/queue**", (route) =>
    route.fulfill({ json: revisionQueue }),
  );
  await page.route("**/api/revisions/pendingEdges**", (route) =>
    route.fulfill({
      json: {
        revisions: pendingEdgeRevisions,
        total: pendingEdgeRevisions.length,
      },
    }),
  );
  await page.route("**/api/nodes/revisions**", (route) =>
    route.fulfill({
      json: {
        nodes: Object.fromEntries(revisedNodes.map((node) => [node.id, node])),
        total: revisedNodes.length,
      },
    }),
  );
}

test("rewizje", HUB, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await freezeClock(page);
  await answerHub(page);
  await logIn(page, USERS.admin, "/admin/rewizje");

  // Every list at its fixture's length before anything is opened: a row count
  // only the fixtures produce, so a shot of the seed's empty queue fails here.
  await expect(page.locator("[data-proposal-row]")).toHaveCount(4, {
    timeout: 30_000,
  });
  await expect(page.locator("[data-edge-row]")).toHaveCount(2);
  await expect(page.getByText("Anna Przykładowa").first()).toBeVisible();

  // One proposal open, which is what the row is for: who, when, the change
  // itself and the decision on it.
  const first = page.locator('[data-proposal-id="wizrew1"]');
  await first.locator("[data-row-toggle]").click();
  await expect(first.locator("[data-row-panel]")).toBeVisible();

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("rewizje.png", { fullPage: true });

  await expectFitsThePhone(page, testInfo);
});

test("rewizje-wpis", ENTRY, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await freezeClock(page);
  await logIn(page, USERS.admin, "/admin/rewizje/5");

  await expect(
    page.getByRole("heading", { name: /Krzysztof Wójcik/ }),
  ).toBeVisible({ timeout: 30_000 });
  // The history and the side-by-side comparison under it are two requests;
  // the comparison's second card is the later of the two to arrive.
  await expect(page.getByText("ID: rev5")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("ID: rev6")).toBeVisible();

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("rewizje-wpis.png", { fullPage: true });

  await expectFitsThePhone(page, testInfo);
});
