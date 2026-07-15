import { test, expect } from "@playwright/test";
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
        ? initializeApp({ projectId: "koryta-pl" })
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
    await page.waitForTimeout(1500);

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

    // Wait for the table to load
    await page.waitForSelector(".v-data-table");

    // Wait for items to be present
    await page.waitForSelector("tbody tr:first-child");

    // Read the total from the first row and click it
    const firstRow = page.locator("tbody tr").first();
    const totalCell = firstRow.locator("td").nth(2); // "Rewizje łącznie" is the 3rd column
    const text = await totalCell.innerText();
    const expectedTotal = parseInt(text.trim(), 10) || 0;

    console.log("expectedTotal parsed as:", expectedTotal, "from text:", text);

    // Check href before click
    const href = await totalCell.locator("a").getAttribute("href");
    console.log("Clicking link with href:", href);

    // Click the link in the total column
    await totalCell.locator("a").click();

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
