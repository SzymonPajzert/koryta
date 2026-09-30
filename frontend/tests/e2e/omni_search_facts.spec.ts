import { test, expect } from "@playwright/test";
import { logIn, USERS } from "./helpers/auth";
import { omniSearchFor } from "./helpers/omniSearch";

/** People the article facts name who have no page of their own - „Dobrze
 * jakby dało się również wyszukiwać po osobach z tych faktów nawet jeśli nie
 * mają koryta id. Na przykład Piotr Ferster”.
 *
 * Seeded in scripts/extractions.json, neither with a node:
 * `seed-relation-mentioned` names Żaneta Wspomniana as the sister of Krzysztof
 * Wójcik (5), the other person in a relation on his page - the report's own
 * shape - and `seed-unmatched-mentioned` names Łukasz Nieprzypisany in an
 * article whose people matched nobody in the graph.
 */

const ZANETA = "Żaneta Wspomniana";

test("a signed in reader finds somebody only a fact names, and lands on it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await logIn(page, USERS.normal, "/");

  const row = page
    .getByTestId("omni-search-fact-name")
    .filter({ hasText: ZANETA });
  // Typed without its diacritics, as most people type a name.
  await omniSearchFor(page, "zaneta wsp", row);

  // Under a heading of its own, saying where the name was found.
  await expect(page.getByTestId("omni-search-fact-names")).toHaveText(
    "Wspomniani w faktach",
  );
  await expect(row).toContainText("W fakcie o: Krzysztof Wójcik");

  await row.click();
  await expect(page).toHaveURL(/\/osoba\/krzysztof-wojcik-5\?fakty=/);

  // His page, at the facts that name her and no others.
  const mention = page.getByTestId("person-extractions-mention");
  await expect(mention).toContainText(ZANETA, { timeout: 30_000 });
  const section = page.getByTestId("person-extractions");
  await expect(section.locator(".extraction-card")).toHaveCount(1);
  await expect(section).toContainText("siostra");
  await expect(mention).toBeInViewport();
});

test("a link built from an old name still lands on the facts", async ({
  page,
}) => {
  test.setTimeout(120_000);
  // The slug in the link comes from the name the fact stored; a page renamed
  // since heals it, and that redirect must keep `?fakty=` and `#fakty`.
  await logIn(
    page,
    USERS.normal,
    `/osoba/stare-nazwisko-5?fakty=${encodeURIComponent(ZANETA)}#fakty`,
  );

  await expect(page).toHaveURL(/\/osoba\/krzysztof-wojcik-5\?fakty=.*#fakty$/);
  await expect(page.getByTestId("person-extractions-mention")).toContainText(
    ZANETA,
    { timeout: 30_000 },
  );
});

test("a fact that matched nobody leads to its article's facts", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await logIn(page, USERS.normal, "/");

  const row = page
    .getByTestId("omni-search-fact-name")
    .filter({ hasText: "Łukasz Nieprzypisany" });
  await omniSearchFor(page, "nieprzypisany", row);
  await expect(row).toContainText("W fakcie z artykułu: example.com");

  await row.click();
  await expect(page).toHaveURL(/\/ekstrakcje\?article=/);
  await expect(page.locator("body")).toContainText("Fundacja Bez Stron", {
    timeout: 30_000,
  });
});

test("a name somebody has a page under is the people search's alone", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await logIn(page, USERS.normal, "/");

  // `seed-reviewed-employment` names Jan Kowalski and was matched to nobody,
  // but node 1 is Jan Kowalski: the facts must not offer him a second time.
  const answer = page.waitForResponse(
    (response) =>
      response.url().includes("/api/search/facts") &&
      response.url().includes("kowalski"),
  );
  await omniSearchFor(
    page,
    "jan kowalski",
    page.locator(".v-list-item", { hasText: "Jan Kowalski" }).first(),
  );

  const { names } = (await (await answer).json()) as {
    names: { name: string }[];
  };
  expect(names.map((hit) => hit.name)).not.toContain("Jan Kowalski");
  await expect(page.getByTestId("omni-search-fact-names")).toHaveCount(0);
});

test("a reader who is not signed in is not offered them", async ({ page }) => {
  test.setTimeout(120_000);
  // The facts are shown to signed in readers only, and so are the names in
  // them: not in the menu, and not asked of the server at all.
  const asked: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/search/facts")) asked.push(request.url());
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  // The offer to add the typed name appears once the results have settled.
  await omniSearchFor(
    page,
    "zaneta wsp",
    page.getByTestId("omni-search-add-person"),
  );

  await expect(page.getByTestId("omni-search-fact-names")).toHaveCount(0);
  await expect(page.getByTestId("omni-search-fact-name")).toHaveCount(0);
  expect(asked).toEqual([]);

  // And the endpoint says no to a caller who asks anyway.
  const response = await page.request.get("/api/search/facts?q=zaneta");
  expect(response.status()).toBe(401);
});
