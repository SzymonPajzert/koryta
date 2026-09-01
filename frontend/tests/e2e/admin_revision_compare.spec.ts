import { test, expect } from "@playwright/test";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { logIn, USERS } from "./helpers/auth";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

/**
 * The side-by-side comparison on /admin/rewizje/[id] when a node has more
 * revisions than fit on a screen.
 *
 * Reported as "nie da się przewinąć w poziomie": the page sits in a
 * `v-container.fill-height`, which is a flex row, and a flex item does not
 * shrink below its content - so the table stretched the page instead of
 * scrolling, and Vuetify's `html { overflow-x: hidden }` then clipped the
 * right-hand columns off with nothing able to reach them.
 */
const RUN = Date.now();
const NODE = `000-porownanie-${RUN}`;
/** Wide enough that the table cannot fit any viewport: 350px per column. */
const AUTOMATIC = 10;
const MANUAL = 2;
const TOTAL = AUTOMATIC + MANUAL;
const APPROVED = `${NODE}-rev-0`;

const db = () =>
  getFirestore(
    getApps().length === 0
      ? initializeApp({ projectId: "demo-koryta-pl" })
      : getApp(),
    "koryta-pl",
  );

const revisionIds = Array.from({ length: TOTAL }, (_, i) => `${NODE}-rev-${i}`);

test.beforeAll(async () => {
  await db()
    .collection("nodes")
    .doc(NODE)
    .set({
      name: NODE,
      type: "person",
      content: "Wersja zatwierdzona.",
      published: true,
      revision_id: db().collection("revisions").doc(APPROVED),
    });

  await Promise.all(
    revisionIds.map((id, index) =>
      db()
        .collection("revisions")
        .doc(id)
        .set({
          node_id: NODE,
          collection: "nodes",
          data: {
            name: NODE,
            type: "person",
            content: `Wersja ${index}.`,
          },
          status: index === 0 ? "approved" : "pending",
          // The first two are the ones a person filed; the rest stand for a
          // pipeline restating itself night after night, which is what makes
          // these tables wide in production.
          update_automatic: index >= MANUAL,
          update_user: "test_user",
          update_time: Timestamp.fromMillis(RUN - index * 60_000),
        }),
    ),
  );
});

test.afterAll(async () => {
  await Promise.all(
    revisionIds.map((id) => db().collection("revisions").doc(id).delete()),
  );
  await db().collection("nodes").doc(NODE).delete();
});

test.describe("Comparing many revisions of one node", () => {
  test("the wide table scrolls sideways instead of being clipped", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await logIn(page, USERS.admin, `/admin/rewizje/${NODE}`);
    await expect(page.locator(".comparison-table")).toBeVisible({
      timeout: 30_000,
    });

    const scroller = page.locator(".comparison-scroll");
    const overflow = await scroller.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeGreaterThan(overflow.clientWidth);

    // The window itself must not be the thing that overflowed: that is the
    // state `html { overflow-x: hidden }` turns into unreachable columns.
    const pageOverflow = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      windowWidth: window.innerWidth,
    }));
    expect(pageOverflow.documentWidth).toBeLessThanOrEqual(
      pageOverflow.windowWidth + 1,
    );

    // And it really moves, all the way to the last revision.
    const scrolledTo = await scroller.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
      return el.scrollLeft;
    });
    expect(scrolledTo).toBeGreaterThan(0);
  });

  test("the filter cuts the pipeline's restatements out of the way", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await logIn(page, USERS.admin, `/admin/rewizje/${NODE}`);
    const headers = page.locator(".comparison-table thead th");
    await expect(headers).toHaveCount(TOTAL, { timeout: 30_000 });

    await page.getByTestId("revision-filter-manual").click();
    await expect(headers).toHaveCount(MANUAL);

    // The approved one is the human revision this node is serving, so asking
    // for what is still waiting leaves the other.
    await page.getByTestId("revision-filter-pending").click();
    await expect(headers).toHaveCount(TOTAL - 1);
  });

  test("a link to one revision shows it whatever the filter says", async ({
    page,
  }) => {
    // Every "podgląd" link and every row of the queue arrives naming a
    // revision; filtering that column away would answer the link with a table
    // the reviewer has to find their own way back out of.
    test.setTimeout(120_000);
    const automatic = `${NODE}-rev-${TOTAL - 1}`;
    await logIn(
      page,
      USERS.admin,
      `/admin/rewizje/${NODE}?revisionId=${automatic}`,
    );
    await expect(page.locator(".comparison-table")).toBeVisible({
      timeout: 30_000,
    });

    await page.getByTestId("revision-filter-manual").click();
    await expect(
      page.locator(`[data-revision-header="${automatic}"]`),
    ).toBeVisible();
    await expect(page.locator(".comparison-table thead th")).toHaveCount(
      MANUAL + 1,
    );
  });
});
