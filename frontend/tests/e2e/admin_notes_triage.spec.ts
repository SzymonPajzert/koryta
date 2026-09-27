import { test, expect } from "@playwright/test";
import { waitForLoginFormHydrated } from "./helpers/login";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

/** The phone queue at /admin/notatki/kategoryzacja: one entry, one tap. What
 * matters end to end is that the tap reaches Firestore and that an entry the
 * queue cannot judge lands in the table view instead of coming round again. */
test.describe("Kategoryzacja notatek", () => {
  test("classifies one entry and hands the next to the table", async ({
    page,
  }) => {
    // Seeds, logs in, opens a person's page and works through a queue
    test.setTimeout(120000);

    const app =
      getApps().length === 0
        ? initializeApp({ projectId: "demo-koryta-pl" })
        : getApp();
    const db = getFirestore(app, "koryta-pl");

    const stamp = Date.now();
    // No hyphen: the person's page reads the id off after the last one, and
    // the spec follows the card's link to it.
    const personId = `triageperson${stamp}`;
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

    // The name opens the person's page, in a tab of its own so the queue keeps
    // its place. It once drew as an inert <nuxtlink> tag that went nowhere.
    const [personPage] = await Promise.all([
      page.context().waitForEvent("page"),
      card.getByRole("link", { name: `Bogdan Kategoria ${stamp}` }).click(),
    ]);
    await personPage.waitForURL(
      `**/osoba/bogdan-kategoria-${stamp}-${personId}`,
    );
    await expect(
      personPage.getByRole("heading", { name: `Bogdan Kategoria ${stamp}` }),
    ).toBeVisible({ timeout: 30000 });
    await personPage.close();

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

    // Gone from the queue, rather than the queue being empty. The seed carries
    // a note of its own with three untyped sources - added for the picture the
    // notes section takes - so „Wszystkie notatki skategoryzowane!" is a state
    // this spec can no longer reach, and waiting for it only ever timed out
    // against a queue that was working exactly as intended.
    await expect(page.getByText(second.trim(), { exact: false })).toHaveCount(
      0,
      { timeout: 15000 },
    );
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
    // is classified and the other is waiting for the table view. What is left
    // in the queue is the seed's own notes, so the card is still there - it
    // just must not be showing either of these two again.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(card).toBeVisible({ timeout: 30000 });
    for (const judged of [first, second]) {
      await expect(page.getByText(judged.trim(), { exact: false })).toHaveCount(
        0,
      );
    }

    // And the table names the deferral rather than showing it as untriaged.
    await page.goto("/admin/notatki?adminType=deferred", {
      waitUntil: "domcontentloaded",
    });
    const rows = page.locator("tbody tr");
    await expect(rows.first()).toContainText(second.trim(), { timeout: 30000 });
    await expect(rows.first()).toContainText("Do oceny tutaj");
  });
});
