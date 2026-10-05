import { test, expect, type Page } from "@playwright/test";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { logIn, USERS } from "./helpers/auth";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

/** The accounts side of the site end to end: /admin/uzytkownicy taking a
 * nomination and handing it back, a contributor asking for access from /pomoc
 * and an administrator turning it down, the public profile the seed gives the
 * normal user and an administrator hiding it, the once-a-day sign-in ping, and
 * an administrator on trial being kept out.
 *
 * Every write lands on the seeded `test-user`, and each test starts by taking
 * away whatever an earlier run left on that account - a failed run skips its
 * clean-up, and a nomination left pending would put the row in a different
 * section than the next run looks in. What the claims script does with a
 * nomination is the Python tests' job; nothing here runs it.
 */
const UID = "test-user";
const NAME = "Normal User";
const HANDLE = "testowy-uczestnik";

const db = () =>
  getFirestore(
    getApps().length === 0
      ? initializeApp({ projectId: "demo-koryta-pl" })
      : getApp(),
    "koryta-pl",
  );

async function resetAccount() {
  const batch = db().batch();
  batch.delete(db().collection("roleNominations").doc(UID));
  batch.delete(db().collection("accessRequests").doc(UID));
  batch.set(
    db().collection("profiles").doc(UID),
    { hidden: null },
    { merge: true },
  );
  const actions = await db()
    .collection("userActions")
    .where("target", "==", UID)
    .get();
  actions.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

// One after another: every test signs in as, or writes to, the same account,
// and two sign-ins of it at once are two sign-ins in its statistics.
test.describe.configure({ mode: "serial" });
test.beforeEach(resetAccount);
test.afterAll(resetAccount);

/** The open row of the seeded user on /admin/uzytkownicy, opened through the
 * `#u-<uid>` link the page honours. */
async function openUserRow(page: Page) {
  await page.goto(`/admin/uzytkownicy#u-${UID}`);
  const row = page.locator(`#u-${UID}`);
  await expect(row.locator("[data-row-panel]")).toBeVisible({
    timeout: 30_000,
  });
  return row;
}

/** Confirms the reason dialog a row action opens, with `reason` typed in. */
async function confirmDialog(page: Page, confirm: string, reason: string) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill(reason);
  await dialog.getByRole("button", { name: confirm, exact: true }).click();
  await expect(dialog).toBeHidden();
}

test("an administrator nominates somebody and withdraws it again", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await logIn(page, USERS.admin);
  const row = await openUserRow(page);

  const form = row.locator("[data-nomination-form]");
  await form.locator('[data-level="trusted"] input').check();
  await form
    .locator("[data-nomination-reason] textarea")
    .first()
    .fill("Rzetelnie sprawdza osoby z kolejki.");
  await form.locator("[data-nominate]").click();

  await expect(row).toContainText("czeka na skrypt", { timeout: 15_000 });
  const nomination = await db().collection("roleNominations").doc(UID).get();
  expect(nomination.get("desired")).toMatchObject({
    level: "trusted",
    trial: false,
    by: "test-admin",
    reason: "Rzetelnie sprawdza osoby z kolejki.",
  });

  await row.getByRole("button", { name: "Wycofaj nominację" }).first().click();
  await confirmDialog(page, "Wycofaj", "Pomyłka");
  await expect(row).not.toContainText("czeka na skrypt", { timeout: 15_000 });

  const kinds = (
    await db().collection("userActions").where("target", "==", UID).get()
  ).docs.map((doc) => doc.get("kind"));
  expect(kinds.sort()).toEqual(["nominate", "withdraw"]);
});

test("a contributor asks for access and an administrator turns it down", async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  await logIn(page, USERS.normal, "/pomoc");
  await page.getByText("Poproś o dostęp do narzędzi").first().click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Dlaczego chcesz dostęp?")
    .fill("Chcę dodawać artykuły przez rozszerzenie.");
  await dialog.getByRole("button", { name: "Wyślij prośbę" }).click();
  await expect(page.getByText(/Prośba wysłana/).first()).toBeVisible({
    timeout: 15_000,
  });
  expect(
    (await db().collection("accessRequests").doc(UID).get()).get("status"),
  ).toBe("open");

  const admin = await browser.newPage();
  await logIn(admin, USERS.admin);
  const row = await openUserRow(admin);
  await expect(row).toContainText("Chcę dodawać artykuły przez rozszerzenie.");
  await row.getByRole("button", { name: "Odrzuć prośbę" }).first().click();
  await confirmDialog(admin, "Odrzuć", "Najpierw kolejka osób.");

  await expect
    .poll(async () =>
      (await db().collection("accessRequests").doc(UID).get()).get("status"),
    )
    .toBe("dismissed");
  await admin.close();
});

test("the seeded contributor's public profile opens, and hides when an administrator hides it", async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);
  const visitor = await browser.newPage();
  const response = await visitor.goto(`/uczestnik/${HANDLE}`);
  expect(response?.status()).toBe(200);
  await expect(visitor.getByRole("heading", { name: NAME })).toBeVisible();
  // Never the uid, which the ranking and the feed withhold too.
  expect(await visitor.content()).not.toContain(UID);

  await logIn(page, USERS.admin);
  const row = await openUserRow(page);
  await row.getByRole("button", { name: "Ukryj profil" }).click();
  await confirmDialog(page, "Ukryj profil", "Test ukrywania profilu");

  await expect
    .poll(async () =>
      (await db().collection("profiles").doc(UID).get()).get("hidden.reason"),
    )
    .toBe("Test ukrywania profilu");
  // The route answers with a minute of public caching; a fresh query string
  // keeps a cached copy of the visible profile out of the way.
  const hidden = await visitor.request.get(
    `/api/profiles/${HANDLE}?po=${Date.now()}`,
  );
  expect(hidden.status()).toBe(404);
  await visitor.close();
});

test("signing in counts a sign-in and a day", async ({ page }) => {
  await db().collection("userStats").doc(UID).delete();
  await logIn(page, USERS.normal);
  // Other spec files sign in as this account in parallel, so the sign-ins are
  // at least one rather than exactly one; the day is one either way.
  await expect
    .poll(
      async () => {
        const stats = (
          await db().collection("userStats").doc(UID).get()
        ).data();
        return stats
          ? { day: stats.activeDays, signedIn: stats.signIns >= 1 }
          : null;
      },
      { timeout: 20_000 },
    )
    .toEqual({ day: 1, signedIn: true });
});

test("an administrator on trial is kept out of the users page", async ({
  page,
}) => {
  await logIn(page, USERS.newAdmin);
  // Not in the Admin menu, which the trial administrator does get. The menu
  // opens only once Vue has attached its activator, so the click is retried
  // until an entry shows (see toolbar_workflow.spec.ts).
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const admin = page
    .locator(".user-toolbar")
    .first()
    .getByRole("button", { name: /^Admin/ });
  const entries = page.locator(".user-toolbar-menu");
  await expect(async () => {
    if ((await admin.getAttribute("aria-expanded")) !== "true") {
      await admin.click();
    }
    await expect(entries.getByRole("link", { name: "Notatki" })).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
  await expect(entries.getByRole("link", { name: "Użytkownicy" })).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");

  // And turned away at the page. A built site prints no message for a 403,
  // only the code.
  await page.goto("/admin/uzytkownicy");
  await expect(page.getByText("403", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole("heading", { name: "Użytkownicy" })).toHaveCount(
    0,
  );
});
