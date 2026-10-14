import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { waitForLoginFormHydrated } from "./login";

/** The two accounts scripts/seed-emulator.ts creates. */
export const USERS = {
  admin: { email: "admin@koryta.pl", password: "password123" },
  normal: { email: "user@koryta.pl", password: "password123" },
} as const;

type User = (typeof USERS)[keyof typeof USERS];

/** The `Authorization` header a signed in reader's browser sends, for a spec
 * that asks the api directly. Straight from the auth emulator, which the
 * server verifies tokens against: `latest` alone is no sign of anybody, and
 * the server answers it with what it gives the public. */
export async function authorizationFor(
  request: APIRequestContext,
  user: User = USERS.normal,
): Promise<Record<string, string>> {
  const response = await request.post(
    "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key",
    {
      data: {
        email: user.email,
        password: user.password,
        returnSecureToken: true,
      },
    },
  );
  expect(response.ok()).toBe(true);
  const { idToken } = (await response.json()) as { idToken: string };
  return { Authorization: `Bearer ${idToken}` };
}

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
