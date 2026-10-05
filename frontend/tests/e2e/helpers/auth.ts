import { expect, type Page } from "@playwright/test";
import { waitForLoginFormHydrated } from "./login";

/** The accounts scripts/seed-emulator.ts creates: an established
 * administrator (who is also the owner), a contributor with no role, and an
 * administrator on trial. */
export const USERS = {
  admin: { email: "admin@koryta.pl", password: "password123" },
  normal: { email: "user@koryta.pl", password: "password123" },
  newAdmin: { email: "newadmin@koryta.pl", password: "password123" },
} as const;

type User = (typeof USERS)[keyof typeof USERS];

/** Sign in through the form and wait until the app agrees we are signed in.
 *
 * `redirect` is passed to /login as a query parameter, so the app lands
 * straight on the page under test instead of bouncing through the home page -
 * one navigation fewer for a spec to race against.
 *
 * The Cypress `cy.login` this replaces registered the account when the sign in
 * did not take. That branch never ran against the emulator, which is seeded
 * with both users before the server starts, and it hid real auth failures as
 * "well, we registered instead". A missing account is a broken seed and should
 * fail here. */
export async function logIn(
  page: Page,
  user: User = USERS.normal,
  redirect?: string,
) {
  const target = redirect
    ? `/login?redirect=${encodeURIComponent(redirect)}`
    : "/login";
  await page.goto(target, { waitUntil: "domcontentloaded" });

  await waitForLoginFormHydrated(page);

  await page.locator("input#email").fill(user.email);
  await page.locator("input#password").fill(user.password);
  await page.locator('button[type="submit"]').click({ force: true });

  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 30_000,
  });

  // The redirect fires before onAuthStateChanged has repainted the header, and
  // the toolbar is what the specs go on to click.
  await expect(
    page.locator('a[href="/profil"], button[to="/profil"], .v-avatar').first(),
  ).toBeVisible({ timeout: 30_000 });
}
