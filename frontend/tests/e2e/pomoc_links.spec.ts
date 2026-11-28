import { test, expect } from "@playwright/test";
import { SLACK_INVITE_URL } from "../../shared/contact";

/** /pomoc, where the Slack invite is, was linked from the home page, the
 * call-to-action cards and the foot of /oswiadczenia only. The footer and,
 * below md, the app bar's menu lead there now (decision on 2026-11-28). */
test.describe("Ways to /pomoc", () => {
  test("the footer links /pomoc and the Slack invite", async ({ page }) => {
    await page.goto("/o-nas");
    const footer = page.locator("footer");
    await expect(
      footer.getByRole("link", { name: "Slack zespołu" }),
    ).toHaveAttribute("href", SLACK_INVITE_URL);
    await footer.getByRole("link", { name: "Jak możesz pomóc" }).click();
    await expect(page).toHaveURL(/\/pomoc$/);
    await expect(page.locator("h1")).toHaveText("Jak możesz pomóc");
  });

  test("on a phone the app bar's menu leads to /pomoc", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/o-nas");
    const menu = page.getByTestId("app-bar-menu");
    // Hydrated: the menu opens only once Vue owns the button.
    await expect(async () => {
      await menu.click();
      await expect(page.getByTestId("app-bar-menu-list")).toBeVisible({
        timeout: 1_000,
      });
    }).toPass({ timeout: 30_000 });
    await page
      .getByTestId("app-bar-menu-list")
      .getByRole("link", { name: "Jak możesz pomóc" })
      .click();
    await expect(page).toHaveURL(/\/pomoc$/);
  });
});
