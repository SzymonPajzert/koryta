import { test, expect, type Page } from "@playwright/test";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { logIn, USERS } from "./helpers/auth";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

/** The "Stan" filter over the entry list on /admin/rewizje (`#wpisy`), which is
 * how the entries are worked through: everything the list is for is in the
 * rows tagged "czeka".
 *
 * `latest_time` is a real Timestamp here rather than the `{_seconds}` map
 * admin_revisions.spec.ts writes. Firestore sorts a map above a timestamp, so
 * the map-valued node that spec seeds keeps the first row it reads while these
 * two sit below it - the two specs share a table and a default sort.
 */
const RUN = Date.now();
const WAITING = `000-oczekuje-${RUN}`;
const SETTLED = `000-zatwierdzony-${RUN}`;

const db = () =>
  getFirestore(
    getApps().length === 0
      ? initializeApp({ projectId: "demo-koryta-pl" })
      : getApp(),
    "koryta-pl",
  );

const node = (name: string, hasUnapproved: boolean) => ({
  name,
  type: "person",
  published: true,
  revisions: {
    total: 1,
    latest_time: Timestamp.now(),
    has_unapproved: hasUnapproved,
  },
});

test.beforeAll(async () => {
  await db().collection("nodes").doc(WAITING).set(node(WAITING, true));
  await db().collection("nodes").doc(SETTLED).set(node(SETTLED, false));
});

test.afterAll(async () => {
  await db().collection("nodes").doc(WAITING).delete();
  await db().collection("nodes").doc(SETTLED).delete();
});

/** Pick a value from the entry list's "Stan" select. By its data attribute:
 * an admin's page has the queue's selects above it, and a rows-per-page one
 * below. */
async function chooseStatus(page: Page, of: string) {
  await page.locator('#wpisy [data-filter="nodeStatus"]').click();
  await page.getByRole("option", { name: of }).click();
}

const entryRows = (page: Page) => page.locator("#wpisy [data-node-row]");

test("the status filter narrows the list to what is still waiting", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await logIn(page, USERS.admin, "/admin/rewizje");
  await page.waitForURL(/\/admin\/rewizje/, { timeout: 30_000 });
  const entries = page.locator("#wpisy");
  await expect(entries.getByText(WAITING).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(entries.getByText(SETTLED).first()).toBeVisible();

  await chooseStatus(page, "Oczekujące na akceptację");

  // Its own name in the url: on this page `status` belongs to the queue.
  await expect(page).toHaveURL(/nodeStatus=unapproved/, { timeout: 30_000 });
  await expect(entries.getByText(WAITING).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(entries.getByText(SETTLED)).toHaveCount(0);

  // Every row on the page, not only the seeded one: the filter is a query the
  // server answers, so a row it let through without the tag would mean the
  // line and the filter disagree about the same field.
  const rows = entryRows(page);
  expect(await rows.count()).toBeGreaterThan(0);
  for (const row of await rows.all()) {
    await expect(row.locator("[data-waiting]")).toHaveText("czeka");
  }

  await chooseStatus(page, "W pełni zaakceptowane");

  await expect(page).toHaveURL(/nodeStatus=approved/, { timeout: 30_000 });
  await expect(entries.getByText(SETTLED).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(entries.getByText(WAITING)).toHaveCount(0);
  await expect(entryRows(page).locator("[data-waiting]")).toHaveCount(0);
});
