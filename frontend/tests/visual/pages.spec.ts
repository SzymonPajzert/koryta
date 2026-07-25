import { test, expect } from "@playwright/test";

const pages = [
  { name: "home", path: "/" },
  { name: "login", path: "/login" },
  { name: "zrodla", path: "/zrodla" },
  { name: "o-nas", path: "/o-nas" },
  { name: "pomoc", path: "/pomoc" },
];

for (const { name, path } of pages) {
  test(name, async ({ page }) => {
    await page.goto(path);
    await page.locator(".v-main").waitFor();
    // Images below the fold are lazy-loaded, so a fullPage screenshot would
    // otherwise request them mid-capture and keep growing the page height
    // (see /o-nas). Scroll through the page to trigger them, then wait until
    // they have all settled.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
        window.scrollTo(0, y);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      window.scrollTo(0, 0);
    });
    await page.evaluate(() => document.fonts.ready);
    await page
      .waitForFunction(
        () => Array.from(document.images).every((img) => img.complete),
        undefined,
        { timeout: 10_000 },
      )
      // An image that never settles is not worth failing on here —
      // toHaveScreenshot retries until two consecutive captures match.
      .catch(() => {});
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: true,
      timeout: 20_000,
    });
  });
}
