import { test, expect } from "./test";
import { logIn, USERS } from "../e2e/helpers/auth";
import { readyForFullPage } from "./fullPage";
import { expectFitsThePhone } from "./phoneWidth";

/** The page an /admin page shows on a fresh load when the reader's ID token
 * needs a refresh and Firebase cannot be reached: „Brak połączenia z siecią”
 * under a 408, with „Odśwież stronę” first (app/error.vue,
 * `abortWithoutNetwork` in app/utils/tokenRefresh.ts).
 *
 * Reproduced rather than mocked. Signed in as the seed's admin, the token
 * Firebase keeps in IndexedDB is made an hour stale, as on a laptop opened
 * after a night, and every refresh of it gets no answer while the browser
 * says it is online.
 *
 * No `@page:` tag: the error page is not a page under app/pages, and the
 * router never gets to /admin. */

type StoredUser = {
  fbase_key: string;
  value: { stsTokenManager: { expirationTime: number } };
};

/** Moves the expiry of the token Firebase keeps for the signed in reader an
 * hour into the past. Resolves to how many it moved. */
function makeTokenStale(): Promise<number> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("firebaseLocalStorageDb");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction("firebaseLocalStorage", "readwrite");
      const store = tx.objectStore("firebaseLocalStorage");
      let moved = 0;
      const rows = store.getAll();
      rows.onsuccess = () => {
        for (const row of rows.result as StoredUser[]) {
          if (!row.fbase_key.startsWith("firebase:authUser:")) continue;
          row.value.stsTokenManager.expirationTime = Date.now() - 3_600_000;
          store.put(row);
          moved++;
        }
      };
      tx.oncomplete = () => resolve(moved);
      tx.onerror = () => reject(tx.error);
    };
  });
}

test("brak-polaczenia", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await logIn(page, USERS.admin, "/admin");
  await expect(page).toHaveURL(/\/admin/);

  // Away from the app, so nothing writes the token back while it changes.
  await page.goto("/robots.txt");
  expect(await page.evaluate(makeTokenStale)).toBe(1);

  await page.route("**/securetoken.googleapis.com/**", (route) =>
    route.abort("internetdisconnected"),
  );
  await page.goto("/admin", { waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("heading", { name: "Brak połączenia z siecią" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("408", { exact: true })).toBeVisible();

  // Off the buttons: the sign in left the pointer where one of them is now.
  await page.mouse.move(0, 0);
  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("brak-polaczenia.png", {
    fullPage: true,
  });

  await expectFitsThePhone(page, testInfo);
});
