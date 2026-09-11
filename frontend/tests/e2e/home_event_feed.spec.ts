import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore, FieldPath } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

/** That the home page's event feed reaches past its first page, orders on the
 * day a post was taken, and sends a click to the person rather than the
 * institution.
 *
 * Only the employment half of the feed. The anniversaries interleaved into it
 * are computed from a window a month either side of *today*, so a spec that
 * seeded one would be asserting on a date that moves - which is why the
 * ordering checks below name the cards this spec seeded rather than reading
 * whatever is at the top of the feed.
 *
 * It seeds its own people because the emulator fixtures hold two published
 * employments between them - enough to draw the section, nowhere near enough
 * to page it. The dates are recent so the rows land on the first page in a
 * known order; ids carry no dash, because `parseEntityUrlSlug` splits the slug
 * url on the last one and would read half of it as the node id.
 */
const RUN = Date.now();
const COUNT = 25;

/** One more than a page, so the last of these is only reachable by loading a
 * second one. Kept in step with `PAGE_SIZE` in the feed component. */
const PAGE_SIZE = 20;

const personId = (i: number) => `recentemp${RUN}p${String(i).padStart(2, "0")}`;
const personName = (i: number) =>
  `Zatrudniony ${RUN} ${String(i).padStart(2, "0")}`;
const companyId = `recentemp${RUN}co`;

/** Index 0 began most recently, so it is what the top of the feed must show
 * and index COUNT-1 is what only a second page can reach. */
const startDate = (i: number) =>
  `2026-07-${String(COUNT - i).padStart(2, "0")}`;

const db = () =>
  getFirestore(
    getApps().length === 0
      ? initializeApp({ projectId: "demo-koryta-pl" })
      : getApp(),
    "koryta-pl",
  );

const edgeId = (i: number) => `recentemp${RUN}e${String(i).padStart(2, "0")}`;

/** Everything any run of this spec has ever seeded.
 *
 * A run whose assertions fail can leave its `afterAll` unreached, and the
 * emulator outlives a `playwright test` invocation that reused an already
 * listening dev server. Left behind, those rows carry dates in the same window
 * as this run's, the feed interleaves two runs, and what is on top is no longer
 * what this spec put there. Addressed by id prefix, which the automatic
 * single-field index on the document key serves without a composite one.
 */
async function clearPreviousRuns() {
  for (const collection of ["nodes", "edges"]) {
    const stale = await db()
      .collection(collection)
      .where(FieldPath.documentId(), ">=", "recentemp")
      .where(FieldPath.documentId(), "<", "recentemp￿")
      .get();
    if (stale.empty) continue;
    const batch = db().batch();
    stale.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

test.beforeAll(async () => {
  await clearPreviousRuns();
  const batch = db().batch();
  batch.set(db().collection("nodes").doc(companyId), {
    name: `Instytucja ${RUN}`,
    type: "place",
    published: true,
    isPublic: true,
    stats: { nodeGroupSize: 1, isApproved: true },
  });
  for (let i = 0; i < COUNT; i++) {
    batch.set(db().collection("nodes").doc(personId(i)), {
      name: personName(i),
      type: "person",
      published: true,
      stats: { nodeGroupSize: 1, isApproved: true },
    });
    batch.set(db().collection("edges").doc(edgeId(i)), {
      source: personId(i),
      target: companyId,
      type: "employed",
      name: "Prezes zarządu",
      published: true,
      start_date: startDate(i),
    });
  }
  await batch.commit();
});

test.afterAll(async () => {
  const batch = db().batch();
  batch.delete(db().collection("nodes").doc(companyId));
  for (let i = 0; i < COUNT; i++) {
    batch.delete(db().collection("nodes").doc(personId(i)));
    batch.delete(db().collection("edges").doc(edgeId(i)));
  }
  await batch.commit();
});

/** Clicks „Pokaż więcej” until `testId` is in the document.
 *
 * The feed never loads a page by itself - it is a button from the first one, so
 * that the page has a bottom and the footer can be reached - so scrolling alone
 * never gets there. The scroll is still here to bring the button into view: the
 * last card already rendered is what gets scrolled to rather than a blind wheel
 * from wherever the mouse happens to be, since the button sits directly below
 * it whatever the feed's height has grown to.
 */
async function loadUntil(page: Page, testId: string) {
  const loadMore = page.getByRole("button", {
    name: "Pokaż więcej",
  });
  await expect(async () => {
    await page
      .locator('[data-testid^="recent-employment-"]')
      .last()
      .scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 2000);
    if (await loadMore.isVisible()) await loadMore.click();
    await expect(page.getByTestId(testId)).toHaveCount(1, { timeout: 2000 });
  }).toPass({ timeout: 60_000 });
}

/** This spec's own cards, in the order the feed drew them. */
function seededCards(page: Page) {
  return page.locator(`[data-testid^="recent-employment-recentemp${RUN}e"]`);
}

// Serial, and it matters. Under `fullyParallel` Playwright spreads a file's
// tests across workers, and each worker is a fresh module - so `RUN` differs
// and `beforeAll` seeds another 25 people per worker. The feed would then hold
// several interleaved runs and neither the ordering nor the page boundary
// would be the one this spec set up.
test.describe.configure({ mode: "serial" });

test.describe("Home - kanał wydarzeń", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    // Two caches sit in front of this page and `latest` only clears one of
    // them. It bypasses the endpoint's own fifteen minute response cache
    // (`wantsLatest` takes any value but "false"), while `/` is additionally
    // `swr: 3600` in nuxt.config, and that one is keyed on the whole url and
    // kept on disk under .nuxt/cache/nitro - so it outlives the dev server and
    // would re-serve a render from before this spec seeded anything. Carrying
    // the run in the value makes the url unique, so neither layer can answer
    // for a previous run.
    await page.goto(`/?latest=${RUN}`, { waitUntil: "domcontentloaded" });
  });

  test("puts the most recently begun spell on top", async ({ page }) => {
    const feed = page.getByTestId("home-event-feed");
    await expect(feed).toBeVisible({ timeout: 30_000 });

    // These carry the newest start dates in the database, so index 0 is the
    // first employment in the feed. Not the first card in it: an anniversary
    // dated after the newest employment sorts above every one of them, and
    // whether there is one today is a property of the fixtures' dates against
    // the calendar rather than of anything this spec controls.
    await expect(
      page.locator('[data-testid^="recent-employment-"]').first(),
    ).toContainText(personName(0));

    // And among themselves they descend by start date rather than arriving in
    // whatever order Firestore happened to return.
    const first5 = await seededCards(page).evaluateAll((els) =>
      els.slice(0, 5).map((el) => el.getAttribute("data-testid")),
    );
    expect(first5).toEqual(
      [0, 1, 2, 3, 4].map((i) => `recent-employment-${edgeId(i)}`),
    );
  });

  test("a card leads to the person, not the institution", async ({ page }) => {
    const card = page.getByTestId(`recent-employment-${edgeId(0)}`);
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toHaveAttribute(
      "href",
      new RegExp(`/osoba/.*${personId(0)}$`),
    );

    await expect(async () => {
      await card.click();
      await page.waitForURL(new RegExp(`/osoba/.*${personId(0)}`), {
        timeout: 2000,
      });
    }).toPass({ timeout: 30_000 });

    await expect(
      page.getByRole("heading", { name: personName(0) }),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("scrolling reaches a spell that the first page did not carry", async ({
    page,
  }) => {
    const feed = page.getByTestId("home-event-feed");
    await expect(feed).toBeVisible({ timeout: 30_000 });

    // Seeded past a page on purpose: with fewer rows than this the paged
    // version and a broken one that only ever fetches the first page look
    // exactly the same.
    expect(COUNT).toBeGreaterThan(PAGE_SIZE);
    await expect(
      page.getByTestId(`recent-employment-${edgeId(COUNT - 1)}`),
    ).toHaveCount(0);

    await loadUntil(page, `recent-employment-${edgeId(COUNT - 1)}`);
    await expect(seededCards(page)).toHaveCount(COUNT);
  });

  test("never shows an employment nobody published", async ({ page }) => {
    // Anna Nowak's spell at Orlen is seeded with `revision_id: null` and the
    // newest start date in the fixtures, so a feed that forgot to filter on
    // `published` would put her first rather than not at all.
    const feed = page.getByTestId("home-event-feed");
    await expect(feed).toBeVisible({ timeout: 30_000 });

    await loadUntil(page, `recent-employment-${edgeId(COUNT - 1)}`);

    await expect(feed.getByText("Anna Nowak")).toHaveCount(0);
  });
});
