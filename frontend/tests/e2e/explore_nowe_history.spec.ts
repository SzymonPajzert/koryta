import { test, expect, type Page } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";
import { answerForTheSector } from "../visual/fixtures/obronnosc";

/** /eksploruj/nowe keeps the person on screen in its url, so the back button
 * returns to the one before - though the queue has moved on past them - and a
 * reload opens the same one.
 *
 * The queue is drafts nobody has voted on, and the seed has one at most, so the
 * request is answered with a seeded company's people, as
 * tests/visual/nowe-person-page.spec.ts does it. „Następna osoba” steps a
 * random one to five places; Math.random is pinned so the step is one. */

const QUEUE =
  "/eksploruj/nowe?category=obronnosc&currentlyEmployed=selected&minVotes=0";

const shownId = (page: Page) => new URL(page.url()).searchParams.get("osoba");
const rowName = (page: Page) =>
  page.locator(".table-card tbody tr .text-primary").first();
const heading = (page: Page) =>
  page.getByTestId("queue-person-page").locator("h1");

async function expectShowing(page: Page, id: string, name: string) {
  await expect.poll(() => shownId(page), { timeout: 30_000 }).toBe(id);
  await expect(rowName(page)).toHaveText(name, { timeout: 30_000 });
  await expect(heading(page)).toHaveText(name, { timeout: 30_000 });
}

test("the back button returns to the person before", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
  await answerForTheSector(page, { queue: true });
  await logIn(page, USERS.normal, QUEUE);

  // Arriving names whoever the queue opens on, in place of the address: no
  // entry of its own for the back button to walk through.
  await expect.poll(() => shownId(page), { timeout: 30_000 }).toBeTruthy();
  const first = shownId(page)!;
  await expect(rowName(page)).toBeVisible({ timeout: 30_000 });
  const firstName = (await rowName(page).textContent())!.trim();
  await expect(heading(page)).toHaveText(firstName, { timeout: 30_000 });
  const entries = await page.evaluate(() => history.length);
  // The filters stay as they were.
  expect(new URL(page.url()).searchParams.get("category")).toBe("obronnosc");

  // „Następna osoba” is a new entry.
  await page.getByTestId("next-person").click();
  await expect.poll(() => shownId(page), { timeout: 30_000 }).not.toBe(first);
  const second = shownId(page)!;
  await expect(rowName(page)).not.toHaveText(firstName, { timeout: 30_000 });
  const secondName = (await rowName(page).textContent())!.trim();
  await expect(heading(page)).toHaveText(secondName, { timeout: 30_000 });
  expect(await page.evaluate(() => history.length)).toBe(entries + 1);

  // Back is the person before, read on their own.
  await page.goBack();
  await expectShowing(page, first, firstName);

  // A reload keeps them.
  await page.reload();
  await expectShowing(page, first, firstName);

  // And forward is the second person again.
  await page.goForward();
  await expectShowing(page, second, secondName);
});

/** What a volunteer reported on 2026-11-15: they left the queue for the
 * person's page before they were done, and coming back found somebody else.
 * The name is the way to that page, and Back is the way to the same person. */
test("the name opens the person's page, and Back returns to them", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await answerForTheSector(page, { queue: true });
  await logIn(page, USERS.normal, QUEUE);

  await expect.poll(() => shownId(page), { timeout: 30_000 }).toBeTruthy();
  const shown = shownId(page)!;
  await expect(rowName(page)).toBeVisible({ timeout: 30_000 });
  const name = (await rowName(page).textContent())!.trim();

  await rowName(page).click();
  await expect(page).toHaveURL(new RegExp(`/osoba/[^?]*-${shown}$`), {
    timeout: 30_000,
  });
  await expect(page.locator("h1").first()).toHaveText(name, {
    timeout: 30_000,
  });

  await page.goBack();
  await expectShowing(page, shown, name);
});
