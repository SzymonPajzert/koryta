import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import { readyForFullPage } from "./fullPage";
import {
  pendingEdgeRevisions,
  queueProposals,
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

/** How long the three lists are. The fixtures' own lengths by default; the
 * production ones for the test that is about how long they are. */
type Totals = { queue?: number; edges?: number; nodes?: number };

async function answerHub(page: Page, totals: Totals = {}) {
  await page.route("**/api/revisions/queue**", (route) =>
    route.fulfill({
      json: { ...revisionQueue, total: totals.queue ?? revisionQueue.total },
    }),
  );
  await page.route("**/api/revisions/pendingEdges**", (route) =>
    route.fulfill({
      json: {
        revisions: pendingEdgeRevisions,
        total: totals.edges ?? pendingEdgeRevisions.length,
      },
    }),
  );
  await page.route("**/api/nodes/revisions**", (route) =>
    route.fulfill({
      json: {
        nodes: Object.fromEntries(revisedNodes.map((node) => [node.id, node])),
        total: totals.nodes ?? revisedNodes.length,
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

/** No picture: what this guards is a width, and a full-page shot of it would
 * be a hundred thousand pixels wide - which is how it went unseen. With the
 * lists as long as production's, `v-pagination` sized by its own buttons drew
 * one per page, and the router scrolled the window sideways to the section on
 * every filter change. */
test("rewizje-dlugie-listy", async ({ page }) => {
  test.setTimeout(120_000);
  await freezeClock(page);
  // Production's on 2026-10-06: the pipeline's pending proposals and the
  // entries with a history.
  await answerHub(page, { queue: 20_523, edges: 15_951, nodes: 18_275 });
  await logIn(page, USERS.admin, "/admin/rewizje");
  await expect(page.locator("[data-proposal-row]")).toHaveCount(
    queueProposals.length,
    { timeout: 30_000 },
  );

  // The pagers size themselves over a run of frames, so the page is measured
  // once they have stopped: early on, a runaway one still looks fine.
  const sideways = () =>
    page.evaluate(
      () =>
        new Promise<{ overflow: number; scrollX: number; buttons: number }>(
          (resolve) => {
            const buttons = () =>
              Math.max(
                0,
                ...Array.from(document.querySelectorAll(".v-pagination")).map(
                  (pager) =>
                    pager.querySelectorAll(".v-pagination__item").length,
                ),
              );
            let last = -1;
            let still = 0;
            let frames = 0;
            const tick = () => {
              const now = buttons();
              still = now === last ? still + 1 : 0;
              last = now;
              if (still < 20 && ++frames < 600) {
                requestAnimationFrame(tick);
                return;
              }
              const doc = document.documentElement;
              resolve({
                overflow: doc.scrollWidth - doc.clientWidth,
                scrollX: window.scrollX,
                buttons: now,
              });
            };
            requestAnimationFrame(tick);
          },
        ),
    );

  const loaded = await sideways();
  expect(loaded.buttons).toBeLessThan(40);
  expect(loaded).toMatchObject({ overflow: 0, scrollX: 0 });

  // A filter's url names its section, and the router scrolls there - which
  // has to stay a scroll down the page.
  await page.locator('[data-filter="automatic"]').click();
  await page.getByRole("option", { name: "Z pipeline'u" }).click();
  await expect(page).toHaveURL(/automatic=true/);
  expect(await sideways()).toMatchObject({ overflow: 0, scrollX: 0 });
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
