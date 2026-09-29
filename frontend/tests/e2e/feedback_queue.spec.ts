import { test, expect, type Page } from "@playwright/test";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { logIn, USERS } from "./helpers/auth";
import { FEEDBACK_ID_PATTERN } from "../../shared/feedbackFixes";
import type { Feedback } from "../../shared/model";
import { QA_ITEMS } from "../../shared/qa";
import { REPORT_FIXES } from "../../shared/reportFixes";
import { reportUrl } from "../../shared/reportTasks";
import { OPS_DATABASE, TASKS_COLLECTION } from "../../shared/tasks";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";

const app = () =>
  getApps().length === 0
    ? initializeApp({ projectId: "demo-koryta-pl" })
    : getApp();

const db = () => getFirestore(app(), "koryta-pl");

/** The owner's task list, in a database of its own - which the emulator
 * makes on the first write, and the seed leaves empty. */
const tasksDb = () => getFirestore(app(), OPS_DATABASE);

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

/** A changelog entry that says it fixes a report, if any does yet. The list is
 * code, so the spec cannot make one up - it borrows a real claim and seeds the
 * report it names. */
const CLAIM = QA_ITEMS.find((item) =>
  item.fixes?.some((id) => FEEDBACK_ID_PATTERN.test(id)),
);

/** A change with no QA entry that says it fixes a report, borrowed the same
 * way. */
const CODE_CLAIM = REPORT_FIXES.find((fix) =>
  fix.fixes.some((id) => FEEDBACK_ID_PATTERN.test(id)),
);

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

    // The page opens on the queue.
    await logIn(page, USERS.admin, "/admin/opinie");
    await expect(
      page.locator(`[data-inbox-row][data-feedback-id="${d}"]`),
    ).toBeVisible({ timeout: 60_000 });
    const rowC = page.locator(`[data-queue-row][data-feedback-id="${c}"]`);
    await expect(rowC).toBeVisible();
    // One line each: the note and the status are in a row once it is opened.
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

  test("admin rozwija zgłoszenie w kolejce, odpowiada notatką i zamyka je", async ({
    page,
  }) => {
    test.setTimeout(180_000); // Seeds, logs in, then writes twice

    const stamp = Date.now();
    const [first, second] = ["x", "y"].map((x) => `kolejka${stamp}${x}`);
    // Ranked past anything another spec leaves in the queue, next to each
    // other, so "Niżej" on the first swaps the two.
    const rank = 1e12 + stamp;
    const batch = db().batch();
    batch.set(
      db().collection("feedback").doc(first!),
      report(stamp, "X", 2, { queueRank: rank }),
    );
    batch.set(
      db().collection("feedback").doc(second!),
      report(stamp, "Y", 1, { queueRank: rank + 1 }),
    );
    await batch.commit();

    await logIn(page, USERS.admin, "/admin/opinie");
    const row = page.locator(`[data-queue-row][data-feedback-id="${first}"]`);
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.locator("[data-row-toggle]").click();
    await expect(row.locator("[data-row-panel]")).toBeVisible();

    // The answer is the note: saved when the field is left.
    const note = row.getByLabel("Notatka");
    await note.fill(`odpowiedź ${stamp}`);
    await note.blur();
    await expect
      .poll(
        async () =>
          (await db().collection("feedback").doc(first!).get()).data()
            ?.adminNote,
        { timeout: 30_000 },
      )
      .toBe(`odpowiedź ${stamp}`);

    // Done: closed from the same row. Opened by clicking the whole field -
    // see admin_notes.spec for why not the input.
    await row.locator(".v-select").click();
    const option = page.getByRole("option", { name: "Załatwione" });
    await expect(option).toBeVisible({ timeout: 5000 });
    await option.click();
    await expect
      .poll(
        async () =>
          (await db().collection("feedback").doc(first!).get()).data()
            ?.adminStatus,
        { timeout: 30_000 },
      )
      .toBe("resolved");
    // Greyed where it was until the next load, not whisked away.
    await expect(row).toHaveClass(/arow--dimmed/);

    // Still in its place in the queue, and still moved by its line while
    // open.
    await row.getByRole("button", { name: "Niżej" }).click();
    await expect
      .poll(() => orderOf(page, [first!, second!]))
      .toEqual([second, first]);
    await expect(row.locator("[data-row-panel]")).toBeVisible();
  });

  test("admin wyjmuje zgłoszenie z kolejki z jego linii i może to cofnąć", async ({
    page,
  }) => {
    test.setTimeout(180_000); // Seeds, logs in, then writes four times

    const stamp = Date.now();
    const ours = ["p", "q", "r"].map((x) => `kolejka${stamp}${x}`);
    const [first, second, third] = ours as [string, string, string];
    // Ranked past anything another spec leaves in the queue, next to each
    // other, so the three keep their order among themselves.
    const rank = 2e12 + stamp;
    const batch = db().batch();
    ours.forEach((id, index) =>
      batch.set(
        db().collection("feedback").doc(id),
        report(stamp, `W${index}`, 3 - index, { queueRank: rank + index }),
      ),
    );
    await batch.commit();

    await logIn(page, USERS.admin, "/admin/opinie");
    const middle = page.locator(
      `[data-queue-row][data-feedback-id="${second}"]`,
    );
    await expect(middle).toBeVisible({ timeout: 60_000 });

    // Out in one click on its line, to the reports under the queue.
    await middle.getByRole("button", { name: "Wyjmij z kolejki" }).click();
    await expect(
      page.locator(`[data-inbox-row][data-feedback-id="${second}"]`),
    ).toBeVisible();
    await expect.poll(() => orderOf(page, ours)).toEqual([first, third]);
    await expect.poll(() => rankOf(second)).toBeUndefined();

    // And back in the place it left rather than at the end.
    await page.getByRole("button", { name: "Cofnij" }).click();
    await expect
      .poll(() => orderOf(page, ours))
      .toEqual([first, second, third]);
    await expect
      .poll(async () => {
        const [a, b, c] = await Promise.all(ours.map(rankOf));
        return a! < b! && b! < c!;
      })
      .toBe(true);

    // The full list has the same button on a queued report's line.
    await page.getByRole("button", { name: "Pełna lista" }).click();
    const listed = page.locator(`#fb-${third}`);
    await listed.getByRole("button", { name: "Wyjmij z kolejki" }).click();
    await expect(
      listed.getByRole("button", { name: "Do kolejki" }),
    ).toBeVisible();
    await expect(listed.locator("[data-queue-position]")).toHaveCount(0);
    await expect.poll(() => rankOf(third)).toBeUndefined();
  });

  test("właściciel dodaje zgłoszenie do swoich zadań, a zgłoszenie zostaje w kolejce", async ({
    page,
  }) => {
    test.setTimeout(180_000); // Seeds, logs in, writes, reloads, then leaves

    const stamp = Date.now();
    const id = `kolejka${stamp}zadanie`;
    // Past anything another spec leaves in the queue.
    const rank = 3e12 + stamp;
    await db()
      .collection("feedback")
      .doc(id)
      .set(
        report(stamp, "zadanie", 1, {
          kind: "idea",
          message: `Pomysł ${stamp}: filtr po województwie w tabeli osób. Po powiecie też.`,
          queueRank: rank,
        }),
      );

    // The seeded admin carries the `owner` claim, which the list asks for.
    await logIn(page, USERS.admin, "/admin/opinie");
    const row = page.locator(`[data-queue-row][data-feedback-id="${id}"]`);
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.locator("[data-row-toggle]").click();

    await row.getByRole("button", { name: "Dodaj do zadań" }).click();
    const dialog = page.locator("[data-task-dialog]");
    await expect(dialog.locator("[data-task-title] input")).toHaveValue(
      `Pomysł ${stamp}: filtr po województwie w tabeli osób`,
    );
    await dialog.locator("[data-task-save]").click();
    await expect(dialog).toBeHidden();

    // The report shows its task, still open on the list.
    const chip = row.locator("[data-report-task]");
    await expect(chip).toHaveText("Zadanie: otwarte");
    const taskId = (await chip.getAttribute("data-report-task"))!;

    // Written to the task list's own database, with the report in it...
    const task = (
      await tasksDb().collection(TASKS_COLLECTION).doc(taskId).get()
    ).data();
    expect(task).toMatchObject({
      title: `Pomysł ${stamp}: filtr po województwie w tabeli osób`,
      kind: "idea",
      who: "owner",
      status: "open",
      links: [reportUrl(id)],
      source: `zgłoszenie ${id}`,
      createdBy: "owner",
    });
    expect(task!.body).toContain(`Zgłoszenie: ${reportUrl(id)}`);
    // ...and nothing written on the report: its place and status are its own.
    expect(
      (await db().collection("feedback").doc(id).get()).data(),
    ).toMatchObject({ queueRank: rank, adminStatus: "new" });

    // Read back off the list, not remembered by the page.
    await page.reload();
    const reloaded = page.locator(`[data-queue-row][data-feedback-id="${id}"]`);
    await expect(reloaded.locator("[data-report-task-icon]")).toBeVisible({
      timeout: 60_000,
    });

    // The chip leads to the task on the list, open, with the report in it.
    await reloaded.locator("[data-row-toggle]").click();
    await reloaded.locator(`[data-report-task="${taskId}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/admin/zadania#t-${taskId}$`));
    const listed = page.locator(`#t-${taskId}`);
    await expect(listed.locator("[data-row-panel]")).toBeVisible({
      timeout: 60_000,
    });
    await expect(listed).toContainText(`zgłoszenie ${id}`);
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

    const row = page.locator(`#fb-${id}`);
    await expect(row).toBeVisible({ timeout: 60_000 });
    await expect(row).toContainText(`kolejka ${stamp} stary`);
    // The queue has no closed reports, so the link takes the full list.
    await expect(page).toHaveURL(/[?&]widok=lista.*#fb-/);
    await expect(row).toBeInViewport();
    // Marked among the rest, and opened, since the link was followed to read
    // it.
    await expect(row).toHaveClass(/arow--target/);
    await expect(row.locator("[data-row-panel]")).toBeVisible();
    await expect(page.locator("[data-toggle-closed]")).toContainText(
      "Ukryj zamknięte",
    );
  });

  test("zgłoszenie pokazuje wpis QA, który je poprawia, i co napisali sprawdzający", async ({
    page,
  }) => {
    test.skip(
      !CLAIM,
      "Żaden wpis w shared/qa.ts nie wskazuje jeszcze zgłoszenia.",
    );
    test.setTimeout(120_000);

    const entry = CLAIM!;
    const id = entry.fixes!.find((fix) => FEEDBACK_ID_PATTERN.test(fix))!;
    const stamp = Date.now();
    const checker = `e2echecker${stamp}`;

    await db()
      .collection("feedback")
      .doc(id)
      .set(report(stamp, "poprawiane", 0));
    // Somebody else's verdict on the entry. Only its words are asserted:
    // qa.spec writes verdicts on the newest entries in parallel, so the colour
    // of the chip is not this spec's to know.
    await db()
      .collection("qaChecks")
      .doc(`${entry.id}_${checker}`)
      .set({
        itemId: entry.id,
        userUid: checker,
        status: "ok",
        feedback: `sprawdzone ${stamp}`,
        updatedAt: new Date(stamp).toISOString(),
      });

    await logIn(page, USERS.admin, "/admin/opinie");
    const row = page.locator(`#fb-${id}`);
    await expect(row).toBeVisible({ timeout: 60_000 });
    // The chip is in the open row; the line has only its icon.
    await row.locator("[data-row-toggle]").click();

    const chip = row.locator("[data-fix-state]");
    await expect(chip).not.toHaveAttribute("data-fix-state", "loading", {
      timeout: 30_000,
    });
    await chip.click();
    const details = page.locator("[data-fix-details]");
    await expect(details).toContainText(entry.title);
    await expect(details).toContainText(`sprawdzone ${stamp}`);
  });

  test("zgłoszenie poprawione bez wpisu QA czeka na /qa na zamknięcie", async ({
    page,
  }) => {
    test.skip(
      !CODE_CLAIM,
      "Nic w shared/reportFixes.ts nie wskazuje jeszcze zgłoszenia.",
    );
    test.setTimeout(120_000);

    const claim = CODE_CLAIM!;
    const id = claim.fixes.find((fix) => FEEDBACK_ID_PATTERN.test(fix))!;
    await db()
      .collection("feedback")
      .doc(id)
      .set(report(Date.now(), "poprawione w kodzie", 0));

    await logIn(page, USERS.admin, "/qa");
    const row = page.locator(`[data-section="fixed-reports"] ~ * #fb-${id}`);
    await expect(row).toBeVisible({ timeout: 60_000 });
    await row.locator("[data-row-toggle]").click();
    await expect(row.locator("[data-fix-change]").first()).toContainText(
      claim.change,
    );

    await row.getByRole("button", { name: "Zamknij jako załatwione" }).click();
    await expect
      .poll(
        async () =>
          (await db().collection("feedback").doc(id).get()).data()?.adminStatus,
        { timeout: 30_000 },
      )
      .toBe("resolved");
  });
});
