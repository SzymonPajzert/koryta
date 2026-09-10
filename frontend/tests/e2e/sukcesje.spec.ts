import { test, expect } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";

/** Danuta Obejmująca, who took a supervisory-board seat on 2024-04-12.
 *
 * The id is the last dash-separated segment of the slug (`parseEntityUrlSlug`),
 * which is why every seeded id in this suite is one hyphen-free word - a
 * fixture called `chain-danuta` would be read as the person `danuta`.
 */
const CHAIN = "/eksploruj/sukcesje/danuta-obejmujaca-sukdanuta";

/** Jan Kowalski, whose one employment edge carries no role at all.
 *
 * The pairing drops a spell with no seat, so "Zmiany na stanowisku" finds
 * nothing, withholds nothing, and renders nothing - which is the case the
 * standalone entry point exists for.
 */
const UNMATCHED = "/osoba/jan-kowalski-1";

test.describe("Łańcuch następstw", () => {
  test("names every candidate the dates allow, not just one", async ({
    page,
  }) => {
    test.setTimeout(120_000); // logs in, then loads the chain

    await logIn(page, USERS.admin, CHAIN);
    await expect(page).toHaveURL(new RegExp(`${CHAIN}$`), { timeout: 30_000 });

    const chain = page.locator('[data-testid="succession-chain"]');
    await expect(chain).toBeVisible({ timeout: 30_000 });
    await expect(chain).toContainText("Łańcuch następstw: Danuta Obejmująca", {
      timeout: 30_000,
    });

    // The whole feature, in one assertion. Adam and Barbara both left this
    // seat on 2024-04-12 and Cezary and Danuta both took one the same day; the
    // one-to-one pairing behind "Zmiany na stanowisku" spends each departure
    // on a single arrival and so names exactly one of the two on Danuta's
    // page. Here both are candidates, because the register does not say which
    // chair she took.
    const predecessors = chain.locator(
      '[data-testid="chain-candidate"][data-direction="predecessor"]',
    );
    await expect(predecessors).toHaveCount(2, { timeout: 30_000 });
    await expect(
      predecessors.filter({ hasText: "Adam Ustępujący" }),
    ).toHaveCount(1);
    await expect(
      predecessors.filter({ hasText: "Barbara Ustępująca" }),
    ).toHaveCount(1);

    // ...and said out loud, rather than left for the reader to infer from two
    // names where they expected one: the register filed one decision about a
    // whole board, not two separate handovers.
    await expect(
      chain.locator('[data-testid="chain-batch-note"]').first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("grows a step at a time, in the picture as well as in the columns", async ({
    page,
  }) => {
    test.setTimeout(120_000); // logs in, loads the chain, then expands it

    await logIn(page, USERS.admin, CHAIN);

    const chain = page.locator('[data-testid="succession-chain"]');
    await expect(chain).toBeVisible({ timeout: 30_000 });

    // The picture draws what has been EXPLORED, so before anything is opened
    // it is one circle and no arrow at all - Danuta alone. Both candidate
    // lists are already on screen underneath at this point, which is the
    // difference the graph is here to make visible.
    const dots = chain.locator('[data-testid="chain-graph-node"]');
    const arrows = chain.locator('[data-testid="chain-graph-edge"]');
    await expect(dots).toHaveCount(1, { timeout: 30_000 });
    await expect(arrows).toHaveCount(0);

    const adam = chain
      .locator('[data-testid="chain-candidate"]', {
        hasText: "Adam Ustępujący",
      })
      .first();
    await expect(adam).toBeVisible({ timeout: 30_000 });
    await adam.locator('[data-testid="chain-expand"]').click();

    // Adam's own side of 2024-04-12: the two people who took a seat as he left
    // it. Danuta is one of them and is already the person in the middle, so
    // she is printed as "już w łańcuchu" rather than expanded again - Cezary
    // is what the second step actually adds.
    await expect(chain).toContainText("Cezary Obejmujący", { timeout: 30_000 });

    await expect(chain).toContainText("Danuta Obejmująca");
    await expect(chain).toContainText("Adam Ustępujący");
    await expect(chain).toContainText("Cezary Obejmujący");

    // ...and the same expansion grew the picture, from the same state: Adam,
    // Cezary and whoever else that step opened, plus one arrow per hop. No
    // exact count, because the fixture's fan-out is the seed's business and
    // this test is about the graph following the columns.
    await expect(dots).not.toHaveCount(1, { timeout: 30_000 });
    await expect(arrows).not.toHaveCount(0);

    // The direction, which is the one thing the picture says that the columns
    // do not. Adam is a predecessor, so his arrow points INTO the person in
    // the middle: the seat moved from him to her. Keyed by the chain's own
    // path key - "root" is the focus and a predecessor hop off it is
    // "root>p:<id>" - so this survives the seed's ids changing.
    await expect(
      chain.locator(
        '[data-testid="chain-graph-edge"][data-to="root"][data-from^="root>p:"]',
      ),
    ).not.toHaveCount(0);
    // Nothing points out of the middle to a predecessor - that would be the
    // page claiming the seat moved backwards in time.
    await expect(
      chain.locator(
        '[data-testid="chain-graph-edge"][data-from="root"][data-to^="root>p:"]',
      ),
    ).toHaveCount(0);
  });

  test("is not shown to a reader who is not signed in", async ({ page }) => {
    test.setTimeout(120_000);

    // `app/middleware/auth.ts` returns early on the server, so the route is
    // rendered in full for an anonymous visitor and only the browser sends
    // them away - the redirect is a client-side one and has to be waited for.
    await page.goto(CHAIN, { waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  });

  test("offers the explorer on a person the pairing could not match", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    // Jan Kowalski's one employment carries no role, so the pairing has
    // nothing to work with: "Zmiany na stanowisku" hides itself whole, taking
    // the "Zobacz łańcuch" button in its heading with it. That is exactly the
    // person the explorer is most use to, so the page offers it separately.
    await page.goto(UNMATCHED, { waitUntil: "domcontentloaded" });
    await expect(page.locator(".v-main")).toContainText("Jan Kowalski", {
      timeout: 30_000,
    });

    const fallback = page.locator(
      '[data-testid="person-successions-explore-empty"]',
    );
    await expect(fallback).toBeVisible({ timeout: 30_000 });
    await expect(fallback).toHaveAttribute(
      "href",
      "/eksploruj/sukcesje/jan-kowalski-1",
    );

    // Never both: the standalone offer exists only where the section it would
    // otherwise live in is absent.
    await expect(
      page.locator('[data-testid="person-successions"]'),
    ).toHaveCount(0);
    await expect(
      page.locator('[data-testid="person-successions-explore"]'),
    ).toHaveCount(0);
  });

  /** The one thing about this page a unit test cannot reach.
   *
   * The columns strip grows sideways without bound, so the whole page will
   * scroll with it unless the overflow is scoped to the strip's own box -
   * which `app/pages/eksploruj/nowe.vue` records somebody getting wrong once
   * already. `tests/visual/phoneWidth.ts` catches that class of bug, but only
   * for the fixed list of pages it photographs, and only in CI. Asserted on
   * the property itself rather than on a screenshot, so there is no baseline
   * to drift and the failure names the element that stuck out.
   */
  test("does not scroll the whole page sideways on a phone", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await page.setViewportSize({ width: 375, height: 812 });
    await logIn(page, USERS.admin, CHAIN);

    const chain = page.locator('[data-testid="succession-chain"]');
    await expect(chain).toBeVisible({ timeout: 30_000 });
    await expect(chain).toContainText("Danuta Obejmująca", { timeout: 30_000 });

    // Expanded first: an unexpanded chain is three columns wide and would pass
    // this whatever the overflow rules said.
    await chain.locator('[data-testid="chain-expand"]').first().click();
    await expect(chain).toContainText("Cezary Obejmujący", { timeout: 30_000 });

    const { doc, viewport, culprits } = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      const over = (el: Element) => {
        const r = el.getBoundingClientRect();
        return (
          r.width > 0 && r.height > 0 && r.right + window.scrollX > viewport + 1
        );
      };
      return {
        doc: document.documentElement.scrollWidth,
        viewport,
        culprits: Array.from(document.querySelectorAll("body *"))
          .filter((el) => over(el) && !Array.from(el.children).some(over))
          .slice(0, 5)
          .map((el) => {
            const cls = (el.getAttribute("class") ?? "")
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 3)
              .join(".");
            return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""} (${Math.round(el.getBoundingClientRect().width)}px)`;
          }),
      };
    });

    expect(
      doc,
      `page is ${doc}px wide in a ${viewport}px viewport; sticking out: ${culprits.join(", ") || "nothing identified"}`,
    ).toBeLessThanOrEqual(viewport + 1);
  });
});
