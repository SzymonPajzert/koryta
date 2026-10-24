import { test, expect } from "./test";
import { freezeClock } from "./clock";
import { personTeaser } from "./fixtures/personTeaser";
import { readyForFullPage } from "./fullPage";
import { openInApp } from "./openInApp";
import { pageTag } from "./pageTags";
import { expectFitsThePhone } from "./phoneWidth";

/** A person nobody has published, as a logged out reader finds them: the name,
 * the latest post as the first row of „Historia powiązań”, and under it the
 * notice with „Zaloguj się” and „Rejestracja”, in place of „Dostęp
 * zastrzeżony".
 *
 * Reached by a client-side navigation, so the teaser is fetched in the browser
 * where the route handler can answer it - see ./fixtures/personTeaser.ts for
 * why it has to be. The page itself is the real one: /api/nodes answers the
 * seeded draft with the 404 a logged out reader gets. */

const SLUG = { tag: pageTag("[seoType]/[slug]") };
const PATH = "/osoba/jan-przykladowy-h1";

test("osoba-niezweryfikowana", SLUG, async ({ page }, testInfo) => {
  await freezeClock(page);
  await page.route("**/api/nodes/h1/teaser", (route) =>
    route.fulfill({ json: personTeaser }),
  );
  await openInApp(page, PATH);

  // What only the fixture says, so a run that drew the wall instead fails
  // here rather than banking it.
  const teaser = page.getByTestId("person-teaser");
  await expect(teaser).toBeVisible({ timeout: 30_000 });
  await expect(teaser).toContainText("Członek Rady Nadzorczej");
  await expect(teaser).toContainText("wszystkie 4 stanowiska");
  await expect(teaser.getByTestId("login-banner-signup")).toBeVisible();

  // Both buttons inside the banner, on a phone too. The banner clips what runs
  // over it rather than widening the page, so `expectFitsThePhone` cannot see
  // a button cut in half - which is how „Zarejestruj się” first shipped.
  const banner = await teaser.locator(".v-alert").boundingBox();
  // The banner lines up with the history row above it, on both sides.
  const row = await teaser.locator(".history-row").first().boundingBox();
  expect(Math.abs(banner!.x - row!.x)).toBeLessThan(1);
  expect(
    Math.abs(banner!.x + banner!.width - (row!.x + row!.width)),
  ).toBeLessThan(1);
  for (const testid of ["login-banner-login", "login-banner-signup"]) {
    const button = await teaser.getByTestId(testid).boundingBox();
    expect(button!.x + button!.width, testid).toBeLessThanOrEqual(
      banner!.x + banner!.width,
    );
    // Nor is either label cut inside its button.
    expect(
      await teaser
        .getByTestId(testid)
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
      testid,
    ).toBe(true);
  }
  // Side by side, on a phone too: one line, two halves.
  const login = await teaser.getByTestId("login-banner-login").boundingBox();
  const signup = await teaser.getByTestId("login-banner-signup").boundingBox();
  expect(Math.abs(login!.y - signup!.y)).toBeLessThan(1);
  expect(Math.abs(login!.width - signup!.width)).toBeLessThan(1);
  // On a phone the alert's icon column is gone, so the text runs on under the
  // icon instead of leaving a strip of empty banner below it.
  if (testInfo.project.name === "visual-mobile") {
    await expect(teaser.locator(".v-alert__prepend")).toBeHidden();
    await expect(teaser.locator(".login-banner__icon")).toBeVisible();
  }

  await readyForFullPage(page);
  await expect(page).toHaveScreenshot("osoba-niezweryfikowana.png", {
    fullPage: true,
  });

  await expectFitsThePhone(page, testInfo);
});
