import { test, expect } from "@playwright/test";
import { waitForLoginFormHydrated } from "./helpers/login";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { firestoreDatabaseFromEnv } from "../../shared/firebase-env";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

/** The phone queue at /admin/notatki/kategoryzacja: one entry, one tap. What
 * matters end to end is that the tap reaches Firestore and that an entry the
 * queue cannot judge lands in the table view instead of coming round again. */
test.describe("Kategoryzacja notatek", () => {
  test("classifies one entry and hands the next to the table", async ({
    page,
  }) => {
    test.setTimeout(90000); // Seeds, logs in and works through a queue

    const app =
      getApps().length === 0
        ? initializeApp({ projectId: "demo-koryta-pl" })
        : getApp();
    const db = getFirestore(app, firestoreDatabaseFromEnv());

    const stamp = Date.now();
    const personId = `triage-person-${stamp}`;
    const noteId = `${personId}_test-user`;

    await db
      .collection("nodes")
      .doc(personId)
      .set({ name: `Bogdan Kategoria ${stamp}`, type: "person" });

    // The queue is newest first, so the first entry seeded is the second one
    // judged. Both are untyped, which is what puts them in the queue at all.
    await db
      .collection("notes")
      .doc(noteId)
      .set({
        nodeId: personId,
        userUid: "test-user",
        createdAt: new Date(stamp).toISOString(),
        sources: [
          {
            note: `do oceny ${stamp}`,
            kind: "change_request",
            url: "https://example.com/artykul",
          },
          { note: `bez kontekstu ${stamp}`, kind: "missing" },
        ],
      });

    const target = "/admin/notatki/kategoryzacja";
    await page.goto(`/login?redirect=${encodeURIComponent(target)}`);
    await waitForLoginFormHydrated(page);
    await page.locator("input#email").fill("admin@koryta.pl");
    await page.locator("input#password").fill("password123");
    await page.locator('button[type="submit"]').click({ force: true });

    await page.waitForURL("**/admin/notatki/kategoryzacja**", {
      timeout: 15000,
    });

    // Both seeded entries share a note document, so whichever the queue puts
    // first, judging it has to leave the other one behind.
    const card = page.locator(".triage-card");
    await expect(card).toBeVisible({ timeout: 30000 });
    await expect(card).toContainText(`Bogdan Kategoria ${stamp}`);
    const first = await card.locator(".note-text").innerText();

    await page.getByText("Brakujące dane / Błąd").click();

    // The card moves on, and the verdict reaches Firestore rather than living
    // in the page's optimistic state.
    await expect(card.locator(".note-text")).not.toHaveText(first, {
      timeout: 15000,
    });
    await expect
      .poll(
        async () => {
          const sources = (
            await db.collection("notes").doc(noteId).get()
          ).data()?.sources;
          return sources?.find((s: { note: string }) => s.note === first.trim())
            ?.adminType;
        },
        { timeout: 15000 },
      )
      .toBe("missing_data");

    // The escape hatch: what this view cannot classify goes to the table.
    const second = await card.locator(".note-text").innerText();
    await page.getByText("Nie da się ocenić tutaj").click();

    await expect(page.getByText("skategoryzowane")).toBeVisible({
      timeout: 15000,
    });
    await expect
      .poll(
        async () => {
          const sources = (
            await db.collection("notes").doc(noteId).get()
          ).data()?.sources;
          return sources?.find(
            (s: { note: string }) => s.note === second.trim(),
          )?.adminTypeDeferred;
        },
        { timeout: 15000 },
      )
      .toBe(true);

    // A reload starts a fresh queue: neither entry may come back, because one
    // is classified and the other is waiting for the table view.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("skategoryzowane")).toBeVisible({
      timeout: 30000,
    });

    // And the table names the deferral rather than showing it as untriaged.
    await page.goto("/admin/notatki?adminType=deferred", {
      waitUntil: "domcontentloaded",
    });
    const rows = page.locator("tbody tr");
    await expect(rows.first()).toContainText(second.trim(), { timeout: 30000 });
    await expect(rows.first()).toContainText("Do oceny tutaj");
  });
});
