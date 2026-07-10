import { test, expect } from "@playwright/test";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

test("admin can view revisions detail and row count matches total", async ({
  page,
}) => {
  // Initialize firebase admin to seed data
  process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  process.env.GCLOUD_PROJECT = "demo-koryta-pl"; // Or whatever is active

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
      update_time: { _seconds: Math.floor(Date.now() / 1000), _nanoseconds: 0 },
      update_automatic: false,
      update_user: "test_user",
    });

  // 1. Go to login page
  await page.goto("/login");

  // 2. Switch to register mode
  await page
    .locator("text=Nie masz konta? Zarejestruj się")
    .click({ force: true });

  // 3. Fill credentials
  const timestamp = Date.now();
  await page.locator("input#email").fill(`adminuser${timestamp}@example.com`);
  await page.locator("input#password").fill("password123");

  // Handle the alert window that says "Wysłano email weryfikacyjny"
  page.on("dialog", (dialog) => dialog.accept());

  // 4. Submit registration
  await page.locator('button[type="submit"]').click({ force: true });
  await page.waitForTimeout(2000);

  // Navigate to admin revisions
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

  // Click the link in the total column
  await totalCell.locator("a").click();

  // Wait for the details page to load
  await page.waitForURL(/\/admin\/rewizje\/.+/);
  await page.waitForSelector(".v-data-table");

  if (expectedTotal > 0) {
    await page.waitForSelector("tbody tr");
    const detailRows = await page.locator("tbody tr").count();
    expect(detailRows).toBe(expectedTotal);
  } else {
    // If expected total is 0, we should either see "No data" or 0 rows
    const detailRows = await page
      .locator("tbody tr.v-data-table-rows-no-data")
      .count();
    const otherRows = await page.locator("tbody tr").count();
    if (detailRows > 0) {
      expect(detailRows).toBe(1); // One "no data" row
    } else {
      expect(otherRows).toBe(0);
    }
  }
});
