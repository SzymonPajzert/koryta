import { test, expect, type Page } from "@playwright/test";
import { initializeApp, getApps, getApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { logIn, USERS } from "./helpers/auth";
import { sniffImage } from "../../shared/feedbackScreenshots";
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

/** A PNG drawn by the page itself: two halves, so a scaled copy still shows
 * which way round it is. */
async function drawPng(page: Page, width: number, height: number) {
  const dataUrl = await page.evaluate(
    ([w, h]) => {
      const canvas = document.createElement("canvas");
      canvas.width = w!;
      canvas.height = h!;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#c62828";
      context.fillRect(0, 0, w! / 2, h!);
      context.fillStyle = "#1565c0";
      context.fillRect(w! / 2, 0, w! / 2, h!);
      return canvas.toDataURL("image/png");
    },
    [width, height],
  );
  return Buffer.from(dataUrl.split(",")[1]!, "base64");
}

/** A paste of `png` into `selector`, as the browser builds one when a
 * screenshot tool has put an image on the clipboard. */
async function pasteImage(page: Page, selector: string, png: Buffer) {
  await page.evaluate(
    ([target, base64]) => {
      const bytes = Uint8Array.from(atob(base64!), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], "image.png", { type: "image/png" }));
      document.querySelector(target!)!.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    },
    [selector, png.toString("base64")],
  );
}

test.describe("Zrzut ekranu w zgłoszeniu", () => {
  test("wysłany anonimowo zrzut trafia do panelu, bez niczego poza obrazem", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const message = `Zgłoszenie ze zrzutem ${Date.now()}`;

    await page.goto("/o-nas");
    // The button is in the markup before Vue listens to it.
    const dialog = page.locator('.v-dialog:has-text("Powiedz nam")');
    await expect(async () => {
      if (await dialog.isVisible()) return;
      await page.getByRole("button", { name: "Zgłoś błąd lub pomysł" }).click();
      await expect(dialog).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 30_000 });

    await dialog.locator("textarea:not([aria-hidden])").fill(message);

    // One picked from disk, one pasted straight into the message.
    await dialog.locator("[data-screenshot-input]").setInputFiles({
      name: "strona.png",
      mimeType: "image/png",
      buffer: await drawPng(page, 1600, 900),
    });
    await pasteImage(
      page,
      ".v-dialog textarea:not([aria-hidden])",
      await drawPng(page, 390, 844),
    );
    await expect(dialog.locator("[data-screenshot-preview] img")).toHaveCount(
      2,
      { timeout: 15_000 },
    );

    await dialog.getByRole("button", { name: "Wyślij" }).click();
    await expect(
      page.getByText("Dzięki! Zgłoszenie do nas dotarło."),
    ).toBeVisible({ timeout: 30_000 });

    // Stored as the report plus a document per image, in the order added.
    const found = await db()
      .collection("feedback")
      .where("message", "==", message)
      .get();
    expect(found.size).toBe(1);
    const reportDoc = found.docs[0]!;
    const report = reportDoc.data() as Feedback;
    expect(report).not.toHaveProperty("userUid");
    expect(
      report.screenshots?.map(({ width, height }) => [width, height]),
    ).toEqual([
      [1600, 900],
      [390, 844],
    ]);
    for (const [index, listed] of report.screenshots!.entries()) {
      const image = await reportDoc.ref
        .collection("screenshots")
        .doc(String(index))
        .get();
      const data = image.get("data") as Buffer;
      // What left the browser is what the canvas wrote - pixels, re-encoded -
      // not the file that was picked.
      expect(sniffImage(data)).toEqual({
        contentType: listed.contentType,
        width: listed.width,
        height: listed.height,
      });
      expect(data.length).toBe(listed.bytes);
    }

    // The admin sees them on the report: marked on its line, loaded when the
    // row opens, and whole on a click.
    await logIn(page, USERS.admin, `/admin/opinie#fb-${reportDoc.id}`);
    const row = page.locator(`[data-feedback-id="${reportDoc.id}"]`);
    await expect(row.locator("[data-screenshots-icon]")).toBeVisible({
      timeout: 60_000,
    });
    const thumbs = row.locator("[data-report-screenshot] img");
    await expect(thumbs).toHaveCount(2, { timeout: 30_000 });
    await expect
      .poll(() =>
        thumbs.first().evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBe(1600);

    await thumbs.first().click();
    const full = page.locator(".v-overlay--active .fb-shots__full");
    await expect(full).toBeVisible();
    await expect
      .poll(() => full.evaluate((img: HTMLImageElement) => img.naturalHeight))
      .toBe(900);
  });

  // Refused before anything is read, so not even whether the report has an
  // image gets out. A signed-in reader who is not an admin is refused the same
  // way - see tests/server/api/feedback-screenshot.test.ts.
  test("bez logowania zrzutu nie da się pobrać", async ({ request }) => {
    const anonymous = await request.get("/api/feedback/screenshot?id=x&n=0");
    expect(anonymous.status()).toBe(401);
  });
});
