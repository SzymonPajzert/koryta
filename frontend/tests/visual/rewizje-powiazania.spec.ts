import type { Page } from "@playwright/test";
import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { freezeClock } from "./clock";
import { readyForFullPage } from "./fullPage";
import {
  ENTRY_ID,
  entryRelations,
  settledRelations,
} from "./fixtures/entryRelations";
import type { NodeRelationHistory } from "../../server/api/revisions/relations.get";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** An entry's relations on /admin/rewizje/[id]: the „Powiązania” section, each
 * relation with the history of its own revisions, and the signal at the top
 * of the page when any of them waits.
 *
 * The section's data is ./fixtures/entryRelations.ts, answered by a route
 * handler: /admin/** is rendered in the browser, so the request is the
 * browser's own. The rest of the page - the entry's history and the
 * side-by-side comparison under the section - is the seed's Krzysztof Wójcik
 * (node 5), as in admin-rewizje.spec.ts's „rewizje-wpis”, which shows the
 * section for a page with no relations at all. */

const ENTRY = { tag: pageTag("admin/rewizje/[id]") };

async function openEntry(page: Page, answer: NodeRelationHistory) {
  await freezeClock(page);
  await page.route("**/api/revisions/relations**", (route) =>
    route.fulfill({ json: answer }),
  );
  await logIn(page, USERS.admin, `/admin/rewizje/${ENTRY_ID}`);
  await expect(
    page.getByRole("heading", { name: /Krzysztof Wójcik/ }),
  ).toBeVisible({ timeout: 30_000 });
}

test("rewizje-wpis-powiazania", ENTRY, async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await openEntry(page, entryRelations);

  // The signal and the rows only the fixture produces, so a run that drew
  // the seed's empty section fails here rather than banking it.
  await expect(page.getByTestId("relation-signal")).toContainText(
    "2 propozycje zmian i 2 nieopublikowane powiązania.",
    { timeout: 30_000 },
  );
  const rows = page.locator("[data-relation-row]");
  await expect(rows).toHaveCount(3);
  // The first relation that waits opens on arrival, with both proposals in
  // its history.
  const first = page.locator('[data-relation-row="visrel-2018"]');
  await expect(first.locator("[data-row-panel]")).toBeVisible();
  await expect(first.locator("[data-relation-revision]")).toHaveCount(3);
  // The comparison under the section is the later of the page's requests.
  await expect(page.getByText("ID: rev6")).toBeVisible({ timeout: 30_000 });

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("rewizje-wpis-powiazania.png", {
    fullPage: true,
  });

  await expectFitsThePhone(page, testInfo);
});

test("rewizje-wpis-powiazania-nic-nie-czeka", ENTRY, async ({ page }) => {
  test.setTimeout(120_000);
  await openEntry(page, settledRelations);

  // Nothing waits, so no signal, and the filter stays on „Czekają”: one line
  // instead of every relation above the comparison.
  const section = page.locator("#powiazania");
  await expect(
    section.getByText("Żadne powiązanie nie czeka na decyzję."),
  ).toBeVisible({ timeout: 30_000 });
  await expect(section.getByTestId("relation-filter-waiting")).toContainText(
    "Czekają (0)",
  );
  await expect(section.getByTestId("relation-filter-all")).toContainText(
    "Wszystkie (3)",
  );
  await expect(page.getByTestId("relation-signal")).toHaveCount(0);

  await expect(section).toHaveScreenshot(
    "rewizje-wpis-powiazania-nic-nie-czeka.png",
  );
});
