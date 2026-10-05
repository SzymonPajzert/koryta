import { test, expect, type Page } from "@playwright/test";
import { waitForLoginFormHydrated } from "./helpers/login";

/** The logged in toolbar (Rewizje, Aktywność, the "Zespół" menu, ...) does not
 * fit on a phone. Vuetify clips `.v-toolbar__content`, which used to leave the
 * trailing buttons unreachable - no scrolling, no overflow menu. The layout now
 * lets that strip scroll sideways, so the test asserts both halves of the fix:
 * the content really does overflow, and it can be scrolled to the last
 * button. */

// Narrow enough that the toolbar overflows even for a non admin, who only sees
// the three always-on buttons.
const PHONE = { width: 320, height: 700 };

async function registerAndLogIn(page: Page) {
  await page.goto("/login");
  await waitForLoginFormHydrated(page);

  await page.locator("text=Nie masz konta? Zarejestruj się").click();
  await expect(page.locator('button:has-text("Stwórz konto")')).toBeVisible();

  await page.locator("input#email").fill(`toolbar${Date.now()}@example.com`);
  await page.locator("input#password").fill("password123");

  // "Wysłano email weryfikacyjny" confirmation.
  page.on("dialog", (dialog) => dialog.accept());
  await page.locator('button:has-text("Stwórz konto")').click();

  await page.waitForURL((url) => !url.pathname.includes("/login"), {
    timeout: 15_000,
  });
}

test.describe("Logged in toolbar on a phone", () => {
  test.use({ viewport: PHONE });

  test("overflowing buttons can be scrolled into view", async ({ page }) => {
    await registerAndLogIn(page);

    const content = page.locator(".user-toolbar .v-toolbar__content");
    await expect(content).toBeVisible();

    // Without overflow the rest of the test would pass vacuously.
    const { scrollWidth, clientWidth } = await content.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(scrollWidth).toBeGreaterThan(clientWidth);

    await expect(content).toHaveCSS("overflow-x", /auto|scroll/);

    // The last button starts off screen and becomes reachable after scrolling.
    //
    // Scroll and measure in one retried block, so a measurement taken while the
    // strip is still settling after the redirect is simply taken again.
    await expect(async () => {
      const lastButton = page.locator(".user-toolbar .v-btn").last();
      await lastButton.scrollIntoViewIfNeeded();

      const scrolled = await content.evaluate((el) => el.scrollLeft);
      expect(scrolled).toBeGreaterThan(0);

      const box = await lastButton.boundingBox();
      const contentBox = await content.boundingBox();
      expect(box).not.toBeNull();
      expect(contentBox).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(contentBox!.x - 1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(
        contentBox!.x + contentBox!.width + 1,
      );
    }).toPass({ timeout: 20_000 });

    // The strip must not have grown a vertical scrollbar or spilled over the
    // page - the fix is horizontal only.
    await expect(content).toHaveCSS("overflow-y", "hidden");

    // The last button is the "Zespół" menu. Its list is drawn outside the
    // strip, so the strip's overflow does not clip it, and it opens inside the
    // window even from the right-hand end of a phone.
    const team = page.locator(".user-toolbar .v-btn").last();
    await expect(team).toHaveText(/Zespół/);
    await team.click();
    const github = page
      .locator(".user-toolbar-menu")
      .getByRole("link", { name: "Nowy bug w GitHubie" });
    await expect(github).toBeVisible();
    const entry = (await github.boundingBox())!;
    expect(entry.x).toBeGreaterThanOrEqual(0);
    expect(entry.x + entry.width).toBeLessThanOrEqual(PHONE.width);
    expect(entry.y + entry.height).toBeLessThanOrEqual(PHONE.height);
    // Neither of those sees clipping - a box is the same size whether an
    // ancestor's overflow cuts it off or not. A trial click does: it checks the
    // entry is what is actually under the pointer, without leaving for GitHub.
    await github.click({ trial: true });
  });
});
