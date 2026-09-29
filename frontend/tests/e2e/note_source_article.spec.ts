import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect, type Page } from "@playwright/test";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { logIn, USERS } from "./helpers/auth";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

/** A source somebody adds to a note is an article from then on.
 *
 * The first test's url cannot be fetched - `.invalid` never resolves - which
 * is on purpose: a page that will not give up its title is exactly the case
 * where the source must still be kept, under its own address. The second
 * serves its page from the test, to see what title it is stored under.
 */
const COMPANY_KRS = "0000357114";
const COMPANY_VIEW = `/eksploruj/tabela?krs=${COMPANY_KRS}`;

const db = () =>
  getFirestore(
    getApps().length === 0
      ? initializeApp({ projectId: "demo-koryta-pl" })
      : getApp(),
    "koryta-pl",
  );

/** Signs in, and saves `url` as a new source in the company's note. */
async function addSource(
  page: Page,
  user: (typeof USERS)[keyof typeof USERS],
  url: string,
) {
  await logIn(page, user, COMPANY_VIEW);
  await page.waitForURL("**/eksploruj/tabela**", { timeout: 30_000 });

  const companyCard = page.locator(`.v-card:has-text("${COMPANY_KRS}")`);
  await expect(companyCard).toBeVisible({ timeout: 15_000 });
  await companyCard.getByRole("button", { name: "Notatki" }).click();
  await companyCard.getByRole("button", { name: "Dodaj źródło" }).click();

  await companyCard.getByText("Dodaj URL").click();
  await companyCard.getByLabel("URL").fill(url);
  await companyCard.getByRole("button", { name: "Zapisz" }).click();
  await expect(companyCard.getByRole("button", { name: "Zapisz" })).toBeHidden({
    timeout: 15_000,
  });
  return companyCard;
}

test("a source added to a note becomes an article node", async ({ page }) => {
  // Logs in, saves a note and waits for the article to be written.
  test.setTimeout(180_000);

  const url = `https://example.invalid/zrodlo-${Date.now()}`;
  const companyCard = await addSource(page, USERS.admin, url);

  // The promotion runs after the note is stored, so the node arrives a moment
  // later - and only once, however the same url is spelled.
  let articleId = "";
  await expect(async () => {
    const articles = await db()
      .collection("nodes")
      .where("sourceURL", "==", url)
      .get();
    expect(articles.size).toBe(1);
    expect(articles.docs[0]!.data().type).toBe("article");
    // No title to be had, so the article goes in under its address.
    expect(articles.docs[0]!.data().name).toBe(url);
    articleId = articles.docs[0]!.id;
  }).toPass({ timeout: 60_000 });

  // And the note entry now points at the article it became - that one, by id.
  // The card carries a chip per source and keeps them all: `company_notes`
  // leaves one on this same company, and every retry of this test leaves
  // another, so "an Artykuł link" is several links by the time it is asked
  // for.
  await expect(
    companyCard.locator(`a[href="/entity/article/${articleId}"]`),
  ).toBeVisible({ timeout: 30_000 });
});

/** An iswinoujscie.pl article cut down to its head, in the bytes the site
 * sends: ISO-8859-2, said only by the `<meta http-equiv>`, behind a
 * `Content-Type` with no charset. `getPageMeta` read every page as UTF-8 and stored this
 * title with U+FFFD for each Polish letter
 * (https://koryta.pl/admin/opinie#fb-3qIISyfU0iXo0Sus5bgJ). */
const ISO_8859_2_PAGE = Buffer.from(
  "<html><head>\n" +
    '<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-2" />\n' +
    "<title>\xa6winouj\xb6cie - iswinoujscie.pl &raquo; Dariusz Bielski dzi\xeakuje wszystkim wyborcom, kt\xf3rzy oddali na niego sw\xf3j g\xb3os</title>\n" +
    "</head><body></body></html>",
  "latin1",
);

test("a source on a page in ISO-8859-2 keeps its Polish letters", async ({
  page,
}) => {
  test.setTimeout(180_000);

  // Served from the test itself: the functions emulator fetches the page, and
  // it runs on this machine.
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(ISO_8859_2_PAGE);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}/artykuly/${Date.now()}/`;

  try {
    // The other seeded account, since a note is one per person and page: this
    // does not write into the note the test above is saving.
    await addSource(page, USERS.normal, url);

    await expect(async () => {
      const articles = await db()
        .collection("nodes")
        .where("sourceURL", "==", url)
        .get();
      expect(articles.size).toBe(1);
      expect(articles.docs[0]!.data().name).toBe(
        "Świnoujście - iswinoujscie.pl » Dariusz Bielski dziękuje wszystkim wyborcom, którzy oddali na niego swój głos",
      );
    }).toPass({ timeout: 60_000 });
  } finally {
    server.close();
  }
});
