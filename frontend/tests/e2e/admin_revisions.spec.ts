import { test, expect } from "@playwright/test";
import { waitForLoginFormHydrated } from "./helpers/login";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Ensure emulator is used for admin SDK
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

test.describe("Admin Revisions View", () => {
  test("admin can view revisions detail and row count matches total", async ({
    page,
  }) => {
    const app =
      getApps().length === 0
        ? initializeApp({ projectId: "demo-koryta-pl" })
        : getApp();
    const db = getFirestore(app, "koryta-pl");
    const testNodeId = "000000-test-node-" + Date.now();

    // Seed a test node
    await db
      .collection("nodes")
      .doc(testNodeId)
      .set({
        name: "000 Test Node with Revisions",
        type: "person",
        revisions: {
          total: 2,
          latest_time: {
            _seconds: Math.floor(Date.now() / 1000),
            _nanoseconds: 0,
          },
          has_unapproved: true,
        },
      });
    // Seed 2 revisions
    await db
      .collection("revisions")
      .doc(`rev1-${testNodeId}`)
      .set({
        node_id: testNodeId,
        nodeId: testNodeId,
        update_time: {
          _seconds: Math.floor(Date.now() / 1000) - 100,
          _nanoseconds: 0,
        },
        update_automatic: false,
        update_user: "test_user",
      });
    await db
      .collection("revisions")
      .doc(`rev2-${testNodeId}`)
      .set({
        node_id: testNodeId,
        nodeId: testNodeId,
        update_time: {
          _seconds: Math.floor(Date.now() / 1000),
          _nanoseconds: 0,
        },
        update_automatic: false,
        update_user: "test_user",
      });

    // 1. Go to login page
    await page.goto("/login");

    // Wait for Vue hydration to complete before interacting
    await waitForLoginFormHydrated(page);

    // 2. Switch to register mode
    await page.locator("text=Nie masz konta? Zarejestruj się").click();
    await expect(page.locator('button:has-text("Stwórz konto")')).toBeVisible();

    // 3. Fill credentials
    const timestamp = Date.now();
    await page.locator("input#email").fill(`adminuser${timestamp}@example.com`);
    await page.locator("input#password").fill("password123");

    // Handle the alert window that says "Wysłano email weryfikacyjny"
    page.on("dialog", (dialog) => dialog.accept());

    // 4. Submit registration
    await page.locator('button:has-text("Stwórz konto")').click();

    // Check for errors (optional, helps debugging)

    // Wait for the redirect from login page to home
    await page.waitForURL((url) => !url.pathname.includes("/login"), {
      timeout: 15000,
    });

    // Wait for the user avatar to appear, confirming auth state is fully loaded
    await page.waitForSelector(
      'a[href="/profil"], button[to="/profil"], .v-avatar',
      { timeout: 15000 },
    );

    // Now that auth is ready and cookie is likely set, navigate to admin revisions
    await page.goto("/admin/rewizje");

    // The entry list is the one section a reader who is not an admin gets, and
    // the seeded node is found by its id rather than by being the first row.
    // It is on the first page anyway: its `latest_time` is a map, which
    // Firestore sorts above every timestamp under the default newest-first.
    const row = page.locator(`#wpisy [data-node-id="${testNodeId}"]`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#kolejka")).toHaveCount(0);

    // The line says how many revisions there are - "2 rewizje".
    const text = await row.locator("[data-revision-count]").innerText();
    const expectedTotal = parseInt(text.trim(), 10) || 0;

    console.log("expectedTotal parsed as:", expectedTotal, "from text:", text);

    // The line opens in place rather than navigating.
    await row.locator("[data-row-toggle]").click();
    await expect(row.locator("[data-row-panel]")).toBeVisible();

    // The side-by-side view is the icon at the end of the line.
    await row.getByRole("link", { name: "Porównanie obok siebie" }).click();

    // Wait for navigation to complete - Match EXACTLY a path parameter, not a query param
    await page.waitForURL(/\/admin\/rewizje\/[a-zA-Z0-9_-]+(?:\?.*)?$/);

    try {
      await page.waitForSelector("h1:has-text('Szczegóły')", { timeout: 5000 });
    } catch (e) {
      console.error("Timeout waiting for h1. Page content:");
      const content = await page.content();
      console.error(content.substring(0, 1000) + "...");
      await page.screenshot({
        path: "test-timeout-screenshot.png",
        fullPage: true,
      });
      throw e;
    }

    // Wait for the detail page table to load and spinner to disappear
    await page.waitForSelector(".v-progress-circular", { state: "hidden" });
    await page.waitForSelector(".comparison-table");

    // Give Vue a moment to render rows
    await page.waitForTimeout(500);

    if (expectedTotal > 0) {
      // Count columns (th) in the header to get number of revisions
      const revisionColumns = await page
        .locator(".comparison-table thead th")
        .count();
      if (revisionColumns !== expectedTotal) {
        console.error(
          `Mismatch! Expected ${expectedTotal} columns, found ${revisionColumns}`,
        );
      }
      expect(revisionColumns).toBe(expectedTotal);
    } else {
      // If expected total is 0, we should see the "Brak rewizji" card
      await expect(
        page.locator("text=Brak rewizji dla tego węzła."),
      ).toBeVisible();
    }
  });
});
