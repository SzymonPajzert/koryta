import { test, expect } from "@playwright/test";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { logIn, USERS } from "./helpers/auth";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

const app =
  getApps().length === 0
    ? initializeApp({ projectId: "demo-koryta-pl" })
    : getApp();
const db = getFirestore(app, "koryta-pl");

/** "Artykuł bez krawędzi" (node 8) in scripts/nodes.json, which the seed gives
 * no facts. */
const ARTICLE = {
  path: "/artykul/artykul-bez-krawedzi-8",
  url: "http://lone-article.com",
};

/** Seeded with `humanVoted: true`, so the queue never deals it: on screen, it
 * can only have come through the link. */
const REVIEWED = {
  id: "seed-reviewed-employment",
  quote: "Fakt oceniony wczesniej przez innego recenzenta.",
};

const QUOTE = "Fakt widoczny takze po wczytaniu strony od nowa.";
const factId = `e2e-full-load-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// One unreviewed fact of this spec's own, on the article above, so the queue
// has a card to deal whatever the other specs have judged. Older than every
// seeded fact, so the queue deals it last and extraction_person_match still
// opens on its own card.
test.beforeAll(async () => {
  await db
    .collection("extractions")
    .doc(factId)
    .set({
      url: ARTICLE.url,
      articleUrl: ARTICLE.url,
      articleDomain: "lone-article.com",
      fact_type: "employment",
      person: "Ewa Wczytana",
      organization: "Spolka Od Nowa",
      role: "prezes zarzadu",
      justification: QUOTE,
      tag: "e2e",
      createdAt: new Date("2026-01-01T10:00:00.000Z"),
      stats: { votes: { interesting: 0, quality: 0, humanVoted: false } },
    });
});

test.afterAll(async () => {
  await db.collection("extractions").doc(factId).delete();
});

/** Facts reach a signed in reader who loads the page from scratch: a reload, a
 * bookmark, a link opened in a new tab.
 *
 * That load is rendered on the server first, and the server render has no
 * token to send. /api/extractions answers a caller without one with the count
 * alone, and hydration used to keep that answer rather than ask again, so the
 * categorisation queue said „Brak faktów do kategoryzacji.” right under
 * „Pozostało do oceny: 28395”.
 *
 * Every other extraction spec signs in through /login?redirect=, which reaches
 * its page by client-side navigation, with the token there from the start - so
 * none of them could see it. Each test here signs in and then loads the page
 * again with `goto`.
 */
test.describe("Fakty po wczytaniu strony od nowa", () => {
  test("the categorisation queue deals a card", async ({ page }) => {
    // The dev server compiles a route the first time it is asked for.
    test.setTimeout(120_000);

    await logIn(page, USERS.normal, "/ekstrakcje/kategoryzacja");
    await page.goto("/ekstrakcje/kategoryzacja", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.locator(".swipe-card .extraction-quote")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("a shared link opens its card", async ({ page }) => {
    test.setTimeout(120_000);

    const target = `/ekstrakcje/kategoryzacja?fact=${REVIEWED.id}`;
    await logIn(page, USERS.normal, target);
    await page.goto(target, { waitUntil: "domcontentloaded" });

    await expect(page.getByText(REVIEWED.quote)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page).toHaveURL(new RegExp(`fact=${REVIEWED.id}`));
  });

  test("/ekstrakcje lists the articles", async ({ page }) => {
    test.setTimeout(120_000);

    await logIn(page, USERS.normal, "/ekstrakcje");
    await page.goto("/ekstrakcje", { waitUntil: "domcontentloaded" });

    // A seeded article: the list holds every fact, judged or not.
    await expect(page.getByText("/do-oceny-partia")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("an article page counts its facts and opens them", async ({ page }) => {
    test.setTimeout(120_000);

    await logIn(page, USERS.normal, ARTICLE.path);
    await page.goto(ARTICLE.path, { waitUntil: "domcontentloaded" });

    // This spec's fact, and any other a spec adds there - but never a zero.
    await expect(page.getByTestId("article-facts-count")).toHaveText(/[1-9]/, {
      timeout: 30_000,
    });
    await page.getByTestId("article-facts-header").click();
    await expect(page.getByText(QUOTE)).toBeVisible({ timeout: 30_000 });
  });
});
