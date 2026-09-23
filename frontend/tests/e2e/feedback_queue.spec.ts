import { test, expect, type Page } from "@playwright/test";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { logIn, USERS } from "./helpers/auth";
import type { Feedback } from "../../shared/model";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const db = () =>
  getFirestore(
    getApps().length === 0
      ? initializeApp({ projectId: "demo-koryta-pl" })
      : getApp(),
    "koryta-pl",
  );

/** A report as `feedback/create` would have written it, dated `minutesAgo`
 * before `stamp` so the seeded ones keep a known age order. */
const report = (
  stamp: number,
  label: string,
  minutesAgo: number,
  extra: Partial<Feedback> = {},
): Feedback => ({
  kind: "bug",
  message: `kolejka ${stamp} ${label}`,
  context: { route: "/", pageTitle: "Koryta.pl" },
  createdAt: new Date(stamp - minutesAgo * 60_000).toISOString(),
  adminStatus: "new",
  slack: { state: "sent" },
  ...extra,
});

/** The ids of this spec's own rows, in the order the page shows them. Other
 * specs write reports into the same emulator, so only the relative order of
 * ours is ours to assert. */
async function orderOf(page: Page, ids: string[]) {
  const shown = await page
    .locator("[data-queue-row]")
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-feedback-id")),
    );
  return shown.filter((id): id is string => !!id && ids.includes(id));
}

const rankOf = async (id: string) =>
  (await db().collection("feedback").doc(id).get()).data()?.queueRank as
    number | undefined;

test.describe("Kolejka zgłoszeń", () => {
  test("admin układa zgłoszenia w kolejkę, a kolejność zostaje po odświeżeniu", async ({
    page,
  }) => {
    test.setTimeout(180_000); // Seeds, logs in, then writes and reloads

    const stamp = Date.now();
    // No hyphens in the ids: other specs' seeds parse the last dash segment.
    const [a, b, c, d] = ["a", "b", "c", "d"].map((x) => `kolejka${stamp}${x}`);
    const ours = [a!, b!, c!, d!];
    const batch = db().batch();
    batch.set(
      db().collection("feedback").doc(a!),
      report(stamp, "A", 4, { queueRank: 1024 }),
    );
    batch.set(
      db().collection("feedback").doc(b!),
      report(stamp, "B", 3, { queueRank: 2048 }),
    );
    batch.set(
      db().collection("feedback").doc(c!),
      report(stamp, "C", 2, { queueRank: 3072 }),
    );
    batch.set(db().collection("feedback").doc(d!), report(stamp, "D", 1));
    await batch.commit();

    await logIn(page, USERS.admin, "/admin/opinie");
    await expect(page.locator(`[data-feedback-id="${d}"]`)).toBeVisible({
      timeout: 60_000,
    });

    await page.getByRole("button", { name: "Ułóż kolejkę" }).click();
    const rowC = page.locator(`[data-queue-row][data-feedback-id="${c}"]`);
    await expect(rowC).toBeVisible({ timeout: 30_000 });
    // Ordering is not answering: nothing to reply or triage with here.
    await expect(page.getByLabel("Notatka")).toHaveCount(0);
    await expect(page.getByLabel("Status")).toHaveCount(0);

    // C to the very top, D from outside the queue onto its end.
    await rowC.getByRole("button", { name: "Więcej" }).click();
    // The menu is teleported out of the row, to the overlay container.
    await page
      .locator(".v-overlay--active .v-list-item-title", {
        hasText: /^Na początek$/,
      })
      .click();
    await page
      .locator(`[data-inbox-row][data-feedback-id="${d}"]`)
      .getByRole("button", { name: "Dodaj na koniec kolejki" })
      .click();

    await expect.poll(() => orderOf(page, ours)).toEqual([c, a, b, d]);
    await page.getByRole("button", { name: "Gotowe" }).click();

    // What the page showed reached Firestore, rather than living in its
    // optimistic state.
    await expect
      .poll(async () => {
        const [ra, rb, rc, rd] = await Promise.all(ours.map(rankOf));
        return rc! < ra! && ra! < rb! && rb! < rd!;
      })
      .toBe(true);

    await page.reload();
    await expect(page.locator(`[data-feedback-id="${a}"]`)).toBeVisible({
      timeout: 60_000,
    });
    await expect(
      page.locator(`[data-feedback-id="${c}"] [data-queue-position]`),
    ).toBeVisible();
    await page.getByRole("button", { name: "Ułóż kolejkę" }).click();
    await expect.poll(() => orderOf(page, ours)).toEqual([c, a, b, d]);

    // And by dragging: B onto the upper half of C puts it first.
    await page
      .locator(`[data-queue-row][data-feedback-id="${b}"]`)
      .dragTo(rowC, { targetPosition: { x: 40, y: 4 } });
    await expect.poll(() => orderOf(page, ours)).toEqual([b, c, a, d]);
    await expect
      .poll(async () => (await rankOf(b!))! < (await rankOf(c!))!)
      .toBe(true);
  });

  test("link do zamkniętego zgłoszenia rozwija zamknięte i pokazuje je", async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const stamp = Date.now();
    const id = `kolejka${stamp}stary`;
    // Older than anything else, so only `include` brings it into the list.
    await db()
      .collection("feedback")
      .doc(id)
      .set({
        ...report(stamp, "stary", 0),
        createdAt: "2020-01-01T10:00:00.000Z",
        adminStatus: "resolved",
      });

    await logIn(page, USERS.admin, "/admin");
    // What Slack's "Otwórz w panelu" button opens.
    await page.goto(`/admin/opinie#fb-${id}`);

    const card = page.locator(`#fb-${id}`);
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(card).toContainText(`kolejka ${stamp} stary`);
    await expect(card).toBeInViewport();
    await expect(page.locator("[data-toggle-closed]")).toContainText(
      "Ukryj zamknięte",
    );
  });
});
