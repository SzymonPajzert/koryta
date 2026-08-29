import { test, expect } from "@playwright/test";
import { waitForLoginFormHydrated } from "./helpers/login";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

test.describe("Admin notes queue", () => {
  test("lists the newest entries, filters them and opens the side panel", async ({
    page,
  }) => {
    test.setTimeout(90000); // Seeds, logs in and loads a paginated table

    const app =
      getApps().length === 0
        ? initializeApp({ projectId: "demo-koryta-pl" })
        : getApp();
    const db = getFirestore(app, "koryta-pl");

    const stamp = Date.now();
    const personId = `notes-person-${stamp}`;
    const companyId = `notes-company-${stamp}`;

    await db
      .collection("nodes")
      .doc(personId)
      .set({ name: `Zenon Notatkowy ${stamp}`, type: "person" });
    await db
      .collection("nodes")
      .doc(companyId)
      .set({ name: `Spółka Notatkowa ${stamp}`, type: "place" });

    // The queue is ordered by `createdAt` - when the note was written, not when
    // an admin last touched it - so the company note is the newer of the two
    // and has to come first. A note seeded without that field is undated and
    // sorts below every dated one, whatever `updatedAt` says.
    await db
      .collection("notes")
      .doc(`${personId}_test-user`)
      .set({
        nodeId: personId,
        userUid: "test-user",
        createdAt: new Date(stamp - 60_000).toISOString(),
        sources: [
          { note: `stara notatka ${stamp}`, kind: "source" },
          {
            note: `rozwiązana notatka ${stamp}`,
            kind: "change_request",
            adminStatus: "resolved",
          },
        ],
      });
    await db
      .collection("notes")
      .doc(`${companyId}_test-user`)
      .set({
        nodeId: companyId,
        userUid: "test-user",
        createdAt: new Date(stamp).toISOString(),
        sources: [{ note: `nowa notatka ${stamp}`, kind: "missing" }],
      });

    // Every view is narrowed to this run's stamp. The emulator is shared with
    // whatever else seeded notes, so "the newest note" is not this spec's to
    // claim - but "the newest of the two carrying this stamp" is.
    const queue = `/admin/notatki?q=${stamp}`;
    await page.goto(`/login?redirect=${encodeURIComponent(queue)}`);
    await waitForLoginFormHydrated(page);
    await page.locator("input#email").fill("admin@koryta.pl");
    await page.locator("input#password").fill("password123");
    await page.locator('button[type="submit"]').click({ force: true });

    await page.waitForURL("**/admin/notatki**", { timeout: 15000 });

    const rows = page.locator("tbody tr");
    await expect(rows.first()).toContainText(`nowa notatka ${stamp}`, {
      timeout: 30000,
    });
    // Newest first, so the company note outranks the older person note.
    await expect(rows.first()).toContainText(`Spółka Notatkowa ${stamp}`);
    // The author is resolved by name rather than left as a raw uid.
    await expect(rows.first()).toContainText("Normal User");

    // Narrowing to one node type drops the person's entries. The field is
    // opened by clicking the whole .v-select rather than the input inside it,
    // because vuetify lays a .v-field__input over that input which swallows
    // the click - and not via getByLabel either, since a clearable field gives
    // its clear button the same label.
    const typeSelect = page.locator('.v-select:has-text("Typ węzła")');
    await typeSelect.click();
    // The option is taken by role and clicked unforced: forcing lands the
    // click wherever the box sits mid-animation, which closes the menu without
    // choosing anything and leaves no trace that the filter never applied.
    const option = page.getByRole("option", { name: "Instytucja" });
    await expect(option).toBeVisible({ timeout: 5000 });
    await option.click();
    // Asserted before the url, so a click that misses reads as "nothing was
    // selected" rather than as a broken filter.
    await expect(typeSelect).toContainText("Instytucja");
    await expect(page).toHaveURL(/nodeType=place/);
    // Asserted on the content, not just the count - an empty table renders a
    // single "Brak notatek" row, so toHaveCount(1) alone would also pass on a
    // filter that wrongly matched nothing.
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(`nowa notatka ${stamp}`);

    // Filters survive a reload, so a queue can be shared or come back to.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(rows.first()).toContainText(`nowa notatka ${stamp}`, {
      timeout: 30000,
    });
    await expect(rows).toHaveCount(1);

    // The date is the entry's permalink, so one row can be handed to somebody
    // else to resolve. It carries nothing but the entry, dropping the node
    // type filter that was narrowing the queue around it.
    await rows.first().getByTitle("Link do tej notatki").click();
    await expect(page).toHaveURL(/note=/);
    await expect(page).not.toHaveURL(/nodeType=/);
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText(`nowa notatka ${stamp}`);
    await expect(page.locator(".v-alert")).toContainText("Pojedyncza notatka");

    // And it survives being pasted somewhere and opened cold, which is the
    // only way it is ever going to be used.
    const permalink = page.url();
    await page.goto(permalink, { waitUntil: "domcontentloaded" });
    await expect(rows.first()).toContainText(`nowa notatka ${stamp}`, {
      timeout: 30000,
    });
    await expect(rows).toHaveCount(1);

    // Clearing the type filter and asking for what is still open hides the
    // entry an admin already signed off.
    await page.goto(`${queue}&status=unresolved`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("tbody")).not.toContainText(
      `rozwiązana notatka ${stamp}`,
      { timeout: 30000 },
    );

    // The node name opens the same side panel as /eksploruj/tabela.
    await page.goto(queue, { waitUntil: "domcontentloaded" });
    await expect(rows.first()).toContainText(`Spółka Notatkowa ${stamp}`, {
      timeout: 30000,
    });
    await page.getByText(`Spółka Notatkowa ${stamp}`).first().click();

    const drawer = page.locator(".v-navigation-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(`Spółka Notatkowa ${stamp}`, {
      timeout: 30000,
    });
    await expect(drawer).toContainText("Notatki");
    // Plain text, which it had not been: NoteSourceCard used to render a note
    // into a readonly v-textarea, so its content was the control's value and
    // toContainText looked straight past it. A note is a card now, like every
    // other entry on the page, and the field only appears for its author.
    await expect(drawer).toContainText(`nowa notatka ${stamp}`);
  });
});
